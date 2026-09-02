"""Minimalny klient Modbus na stdlib.

Obsluguje dwa sposoby ramkowania:
  - "rtuovertcp": surowe ramki Modbus RTU (z CRC) w tunelu TCP.
    Tak dziala bramka w trybie transparentnym (Elfin EW11, Waveshare tryb 0).
  - "tcp": Modbus TCP z naglowkiem MBAP.
    Tak dziala Waveshare w trybie 5 (Modbus TCP <=> Modbus RTU).
"""

from __future__ import annotations

import collections
import socket
import struct
import threading
import time

EXCEPTIONS = {
    0x01: "Illegal function",
    0x02: "Illegal data address",
    0x03: "Illegal data value",
    0x04: "Slave device failure",
    0x05: "ACK - trwa pobieranie danych po starcie",
    0x06: "Slave device busy",
    0x07: "Jednostka wewnetrzna nie odpowiada",
}

# Limity dobrane pod uwage z manuala Toshiby: zadanie > 249 oktetow
# zwraca wyjatek 0x02, wiec trzymamy sie bezpiecznie nizej.
MAX_REGS = 100
MAX_BITS = 800

FUNC_NAMES = {
    0x01: "Read Coils", 0x02: "Read Discrete", 0x03: "Read Holding",
    0x04: "Read Input", 0x05: "Write Coil", 0x06: "Write Register",
    0x08: "Diagnostics", 0x0B: "Comm Event Counter", 0x0C: "Comm Event Log",
    0x0F: "Write Coils", 0x10: "Write Registers",
}


_CTX = threading.local()


class TxLog:
    """Pierscieniowy bufor transakcji — zasila terminal na zywo w UI.

    Kazdy wpis niesie `ctx` — etykiete watku, ktory go wygenerowal. Bez tego
    diagnostyka lapalaby ramki z rownoleglego auto-odswiezania i przypisywala
    je do swoich krokow."""

    def __init__(self, size: int = 600):
        self._buf = collections.deque(maxlen=size)
        self._lock = threading.Lock()
        self._seq = 0

    @staticmethod
    def set_ctx(value) -> None:
        _CTX.v = value

    @staticmethod
    def ctx():
        return getattr(_CTX, "v", None)

    def add(self, **kw) -> None:
        with self._lock:
            self._seq += 1
            kw["seq"] = self._seq
            kw["ts"] = time.time()
            kw.setdefault("ctx", self.ctx())
            self._buf.append(kw)

    def since(self, seq: int, limit: int = 400) -> list[dict]:
        with self._lock:
            return [e for e in self._buf if e["seq"] > seq][-limit:]

    def last_seq(self) -> int:
        with self._lock:
            return self._seq

    def note(self, device: str, text: str, level: str = "info") -> None:
        self.add(kind="note", device=device, text=text, level=level)


TXLOG = TxLog()


class ModbusError(RuntimeError):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


def crc16(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


class ModbusClient:
    """Jedno polaczenie na transakcje. Bramki szeregowe nie lubia
    wielu rownoleglych sesji, wiec kazdy klient ma wlasna blokade."""

    def __init__(self, host: str, port: int, framing: str = "rtuovertcp",
                 timeout: float = 2.5, gap: float = 0.05, tag: str = ""):
        self.tag = tag
        self.host = host
        self.port = port
        self.framing = framing
        self.timeout = timeout
        self.gap = gap
        self._lock = threading.Lock()
        self._tid = 0

    # --- warstwa transportu -------------------------------------------------

    def _txn(self, unit: int, pdu: bytes, expect_min: int) -> bytes:
        t_start = time.monotonic()
        tx_hex = self.describe(unit, pdu)
        func = pdu[0]
        addr = count = None
        if len(pdu) >= 5 and func in (0x01, 0x02, 0x03, 0x04, 0x05, 0x06):
            addr, count = struct.unpack(">HH", pdu[1:5])
        try:
            resp = self._txn_raw(unit, pdu, expect_min)
        except Exception as exc:
            TXLOG.add(kind="tx", device=self.tag, unit=unit, func=func,
                      fname=FUNC_NAMES.get(func, f"0x{func:02X}"),
                      addr=addr, count=count, tx=tx_hex, rx=None,
                      ms=round((time.monotonic() - t_start) * 1000, 1),
                      ok=False, err=str(exc),
                      code=getattr(exc, "code", None))
            raise
        TXLOG.add(kind="tx", device=self.tag, unit=unit, func=func,
                  fname=FUNC_NAMES.get(func, f"0x{func:02X}"),
                  addr=addr, count=count, tx=tx_hex,
                  rx=(bytes([unit]) + resp).hex(),
                  ms=round((time.monotonic() - t_start) * 1000, 1),
                  ok=True, err=None, code=None)
        return resp

    def _txn_raw(self, unit: int, pdu: bytes, expect_min: int) -> bytes:
        """Wysyla PDU, zwraca PDU odpowiedzi (bez adresu i bez CRC/MBAP)."""
        with self._lock:
            sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
            try:
                sock.settimeout(self.timeout)
                if self.framing == "tcp":
                    self._tid = (self._tid + 1) & 0xFFFF
                    head = struct.pack(">HHHB", self._tid, 0, len(pdu) + 1, unit)
                    sock.sendall(head + pdu)
                    raw = self._recv_exact(sock, 8)
                    length = struct.unpack(">H", raw[4:6])[0]
                    body = raw[8:] + self._recv_exact(sock, max(0, length - 2 - len(raw[8:])))
                    resp = raw[7:8] + body
                else:
                    frame = bytes([unit]) + pdu
                    crc = crc16(frame)
                    sock.sendall(frame + bytes([crc & 0xFF, (crc >> 8) & 0xFF]))
                    time.sleep(self.gap)
                    raw = self._recv_frame(sock)
                    if crc16(raw) != 0:
                        raise ModbusError(f"Bledne CRC w odpowiedzi: {raw.hex()}")
                    if raw[0] != unit:
                        raise ModbusError(f"Odpowiedz od innego slave ({raw[0]}, oczekiwano {unit})")
                    resp = raw[1:-2]
            finally:
                sock.close()

        if not resp:
            raise ModbusError("Pusta odpowiedz")
        if resp[0] & 0x80:
            code = resp[1] if len(resp) > 1 else 0
            raise ModbusError(EXCEPTIONS.get(code, f"Nieznany wyjatek {code:#04x}"), code)
        if len(resp) < expect_min:
            raise ModbusError(f"Odpowiedz za krotka: {resp.hex()}")
        return resp

    @staticmethod
    def _recv_exact(sock: socket.socket, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                raise ModbusError("Polaczenie zamkniete w trakcie odbioru")
            buf += chunk
        return buf

    def _recv_frame(self, sock: socket.socket) -> bytes:
        """RTU nie ma znacznika dlugosci — czytamy do ciszy na linii."""
        buf = b""
        deadline = time.monotonic() + self.timeout
        sock.settimeout(0.35)
        while time.monotonic() < deadline:
            try:
                chunk = sock.recv(512)
            except socket.timeout:
                if buf:
                    break
                continue
            if not chunk:
                break
            buf += chunk
            if len(buf) >= 5 and crc16(buf) == 0:
                break
        if not buf:
            raise ModbusError("Brak odpowiedzi (timeout)")
        return buf

    # --- funkcje Modbus -----------------------------------------------------

    def read_bits(self, unit: int, func: int, addr: int, count: int) -> list[int]:
        if not 1 <= count <= MAX_BITS:
            raise ValueError("count poza zakresem")
        pdu = struct.pack(">BHH", func, addr, count)
        resp = self._txn(unit, pdu, 2)
        nbytes = resp[1]
        data = resp[2:2 + nbytes]
        out = []
        for i in range(count):
            out.append((data[i // 8] >> (i % 8)) & 1)
        return out

    def read_regs(self, unit: int, func: int, addr: int, count: int) -> list[int]:
        if not 1 <= count <= MAX_REGS:
            raise ValueError("count poza zakresem")
        pdu = struct.pack(">BHH", func, addr, count)
        resp = self._txn(unit, pdu, 2)
        nbytes = resp[1]
        data = resp[2:2 + nbytes]
        return [struct.unpack(">H", data[i:i + 2])[0] for i in range(0, len(data), 2)]

    def write_coil(self, unit: int, addr: int, value: bool) -> str:
        pdu = struct.pack(">BHH", 0x05, addr, 0xFF00 if value else 0x0000)
        self._txn(unit, pdu, 5)
        return self.describe(unit, pdu)

    def write_register(self, unit: int, addr: int, value: int) -> str:
        pdu = struct.pack(">BHH", 0x06, addr, value & 0xFFFF)
        self._txn(unit, pdu, 5)
        return self.describe(unit, pdu)

    def diagnostics(self, unit: int, sub: int, data: int = 0) -> int:
        pdu = struct.pack(">BHH", 0x08, sub, data)
        resp = self._txn(unit, pdu, 5)
        return struct.unpack(">H", resp[3:5])[0]

    def describe(self, unit: int, pdu: bytes) -> str:
        """Ramka w postaci hex — do dialogu potwierdzenia i do audytu."""
        frame = bytes([unit]) + pdu
        if self.framing == "tcp":
            return frame.hex()
        crc = crc16(frame)
        return (frame + bytes([crc & 0xFF, (crc >> 8) & 0xFF])).hex()
