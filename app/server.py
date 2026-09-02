#!/usr/bin/env python3
"""modbus-ui - Modbus register browser with guarded writes.

Stdlib only. Serwuje statyczny frontend i JSON API:
    GET  /api/devices              lista urzadzen + definicje rejestrow
    GET  /api/read?device=ID       odczyt wszystkich rejestrow urzadzenia
    POST /api/write                zapis pojedynczego rejestru
    GET  /api/diag?device=ID       liczniki diagnostyczne interfejsu
    GET  /api/audit                ostatnie zapisy
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modbus import ModbusClient, ModbusError, TXLOG  # noqa: E402
from devices import toshiba  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
CONFIG_FILE = os.environ.get("CONFIG_FILE", "/etc/modbus-ui/config.json")
AUDIT_FILE = os.environ.get("AUDIT_FILE", "/var/lib/modbus-ui/audit.jsonl")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8080"))

FUNC = {"coil": 0x01, "discrete": 0x02, "holding": 0x03, "input": 0x04}
BITSPACES = ("coil", "discrete")


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


# --------------------------------------------------------------------------- konfiguracja

def load_config() -> dict:
    with open(CONFIG_FILE) as f:
        cfg = json.load(f)
    for dev in cfg["devices"]:
        builder = dev.get("map")
        if builder == "toshiba":
            dev["registers"] = toshiba.build(dev["units"])
        else:
            raise ValueError(f"Nieznana mapa rejestrow: {builder}")
        dev["client"] = ModbusClient(dev["host"], dev["port"],
                                     dev.get("framing", "rtuovertcp"),
                                     float(dev.get("timeout", 2.5)),
                                     tag=dev["id"])
        dev["bykey"] = {r["key"]: r for r in dev["registers"]}
    cfg["byid"] = {d["id"]: d for d in cfg["devices"]}
    return cfg


CFG = load_config()


# --------------------------------------------------------------------------- odczyt

def _spans(regs: list[dict], limit: int, gap: int) -> list[tuple[int, int]]:
    """Scala rejestry w ciagle zakresy, zeby nie strzelac ramka na rejestr."""
    if not regs:
        return []
    items = sorted((r["addr"], r["addr"] + r["count"] - 1) for r in regs)
    spans = []
    lo, hi = items[0]
    for a, b in items[1:]:
        if a - hi - 1 <= gap and (b - lo + 1) <= limit:
            hi = max(hi, b)
        else:
            spans.append((lo, hi))
            lo, hi = a, b
    spans.append((lo, hi))
    return spans


def decode(reg: dict, words: list[int]) -> dict:
    t = reg.get("type", "uint16")
    out: dict = {"raw": words[0] if len(words) == 1 else words}
    if t == "bool":
        out["value"] = bool(words[0])
        out["text"] = "ON" if words[0] else "OFF"
    elif t == "string":
        b = b"".join(w.to_bytes(2, "big") for w in words)
        s = b.decode("ascii", "replace").replace("\x00", "").strip()
        out["value"] = s
        out["text"] = s if s else "(puste - brak jednostki)"
        out["absent"] = not s
    elif t == "hex16":
        out["value"] = words[0]
        out["text"] = f"0x{words[0]:04X}" + (" - brak bledu" if words[0] == 0 else "")
    elif t == "bits":
        names = reg.get("bits", [])
        on = [n for i, n in enumerate(names) if words[0] >> i & 1]
        out["value"] = words[0]
        out["text"] = ", ".join(on) if on else "-"
        out["flags"] = {n: bool(words[0] >> i & 1) for i, n in enumerate(names)}
    else:
        v = words[0]
        if t == "int16" and v >= 0x8000:
            v -= 0x10000
        if reg.get("scale"):
            v = round(v * reg["scale"], 2)
        out["value"] = v
        if reg.get("enum"):
            out["text"] = reg["enum"].get(words[0], f"? ({words[0]})")
        else:
            out["text"] = f"{v}{(' ' + reg['unit']) if reg.get('unit') else ''}"
    return out


def read_device(dev: dict) -> dict:
    client: ModbusClient = dev["client"]
    unit = dev["slave"]
    values: dict = {}
    errors: dict = {}
    t0 = time.monotonic()
    frames = 0
    TXLOG.note(dev["id"], f"odczyt {len(dev['registers'])} rejestrow — start")

    for space in ("coil", "discrete", "input", "holding"):
        regs = [r for r in dev["registers"] if r["space"] == space]
        if not regs:
            continue
        bits = space in BITSPACES
        limit, gap = (800, 32) if bits else (100, 8)
        for lo, hi in _spans(regs, limit, gap):
            count = hi - lo + 1
            try:
                if bits:
                    data = client.read_bits(unit, FUNC[space], lo, count)
                else:
                    data = client.read_regs(unit, FUNC[space], lo, count)
                frames += 1
            except (ModbusError, OSError) as exc:
                for r in regs:
                    if lo <= r["addr"] <= hi:
                        errors[r["key"]] = str(exc)
                continue
            for r in regs:
                if lo <= r["addr"] and r["addr"] + r["count"] - 1 <= hi:
                    off = r["addr"] - lo
                    values[r["key"]] = decode(r, data[off:off + r["count"]])

    TXLOG.note(dev["id"],
               f"odczyt zakonczony: {frames} ramek, {len(errors)} bledow, "
               f"{int((time.monotonic() - t0) * 1000)} ms",
               "err" if errors else "ok")
    return {
        "values": values,
        "errors": errors,
        "frames": frames,
        "took_ms": int((time.monotonic() - t0) * 1000),
        "ts": time.time(),
    }


# --------------------------------------------------------------------------- zapis

def encode_write(reg: dict, value) -> int:
    t = reg.get("type", "uint16")
    if t == "bool":
        if isinstance(value, str):
            value = value.lower() in ("1", "true", "on", "tak")
        return 1 if value else 0
    v = float(value)
    if reg.get("scale"):
        v = v / reg["scale"]
    iv = int(round(v))
    if t == "int16":
        if not -32768 <= iv <= 32767:
            raise ValueError("wartosc poza zakresem int16")
        return iv & 0xFFFF
    if not 0 <= iv <= 65535:
        raise ValueError("wartosc poza zakresem uint16")
    return iv


def audit(entry: dict) -> None:
    os.makedirs(os.path.dirname(AUDIT_FILE), exist_ok=True)
    with open(AUDIT_FILE, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def write_register(dev: dict, key: str, value) -> dict:
    reg = dev["bykey"].get(key)
    if reg is None:
        raise ValueError(f"Nieznany rejestr: {key}")
    if not reg.get("writable"):
        raise PermissionError(f"Rejestr {key} nie jest zapisywalny")

    raw = encode_write(reg, value)
    if reg.get("enum") and raw not in reg["enum"]:
        raise ValueError(f"Wartosc {raw} spoza dozwolonych dla {key}")
    if reg.get("wmin") is not None and float(value) < reg["wmin"]:
        raise ValueError(f"Ponizej minimum {reg['wmin']}")
    if reg.get("wmax") is not None and float(value) > reg["wmax"]:
        raise ValueError(f"Powyzej maksimum {reg['wmax']}")

    client: ModbusClient = dev["client"]
    unit = dev["slave"]
    if reg["space"] == "coil":
        frame = client.write_coil(unit, reg["addr"], bool(raw))
    elif reg["space"] == "holding":
        frame = client.write_register(unit, reg["addr"], raw)
    else:
        raise PermissionError(f"Przestrzen {reg['space']} jest tylko do odczytu")

    entry = {"ts": time.time(), "device": dev["id"], "key": key,
             "name": reg["name"], "number": reg["number"], "addr": reg["addr"],
             "space": reg["space"], "value": value, "raw": raw, "frame": frame}
    audit(entry)
    TXLOG.note(dev["id"], f"ZAPIS {reg['name']} ({reg['number']}) = {value}", "warn")
    log(f"ZAPIS {dev['id']}.{key} = {value} (raw {raw}) ramka {frame}")
    return entry


def preview_write(dev: dict, key: str, value) -> dict:
    """Ta sama walidacja co zapis, ale bez wyslania — zasila dialog potwierdzenia."""
    reg = dev["bykey"].get(key)
    if reg is None:
        raise ValueError(f"Nieznany rejestr: {key}")
    if not reg.get("writable"):
        raise PermissionError(f"Rejestr {key} nie jest zapisywalny")
    raw = encode_write(reg, value)
    client: ModbusClient = dev["client"]
    func = 0x05 if reg["space"] == "coil" else 0x06
    payload = raw
    if reg["space"] == "coil":
        payload = 0xFF00 if raw else 0x0000
    import struct
    pdu = struct.pack(">BHH", func, reg["addr"], payload)
    return {"frame": client.describe(dev["slave"], pdu), "raw": raw,
            "func": func, "addr": reg["addr"], "number": reg["number"],
            "space": reg["space"], "name": reg["name"]}


# --------------------------------------------------------------------------- diagnostyka

def _tcp_probe(host: str, port: int, timeout: float = 3.0):
    import socket as _s
    t0 = time.monotonic()
    try:
        c = _s.create_connection((host, port), timeout=timeout)
        c.close()
        return True, round((time.monotonic() - t0) * 1000, 1), None
    except OSError as exc:
        return False, round((time.monotonic() - t0) * 1000, 1), str(exc)


def _frames_since(mark: int) -> list[dict]:
    out = []
    for e in TXLOG.since(mark):
        if e.get("kind") != "tx":
            continue
        out.append({"tx": e["tx"], "rx": e.get("rx"), "ms": e.get("ms"),
                    "ok": e.get("ok"), "err": e.get("err"),
                    "fname": e.get("fname"), "unit": e.get("unit")})
    return out


def trace_steps(dev: dict):
    """Generator krokow diagnostyki. Kazdy krok emitowany dwa razy:
    najpierw ze stanem 'run', potem z wynikiem i ramkami, ktore poszly na magistrale."""
    client: ModbusClient = dev["client"]
    slave = dev["slave"]
    TXLOG.note(dev["id"], "diagnostyka lancucha — start")

    plan = [
        ("app", "Aplikacja modbus-ui"),
        ("net", f"Bramka {dev['host']}:{dev['port']}"),
        ("iface", f"Interfejs Modbus (slave {slave})"),
        ("rs485", "Magistrala RS-485"),
        ("uh", "Magistrala Uh (TU2C-LINK)"),
    ]
    yield {"type": "plan", "steps": [{"id": i, "name": n} for i, n in plan]}

    def start(sid):
        yield_ = {"type": "step", "id": sid, "state": "run"}
        return yield_

    # 1 — aplikacja
    yield start("app")
    yield {"type": "step", "id": "app", "state": "ok",
           "detail": f"{len(dev['registers'])} rejestrow w mapie", "frames": []}

    # 2 — siec do bramki
    yield start("net")
    ok, ms, err = _tcp_probe(dev["host"], dev["port"])
    yield {"type": "step", "id": "net", "state": "ok" if ok else "fail", "ms": ms,
           "detail": f"TCP nawiazane w {ms} ms" if ok else err, "frames": [],
           "hint": None if ok else "Sprawdz zasilanie i WiFi bramki oraz jej adres IP."}

    if not ok:
        for sid in ("iface", "rs485", "uh"):
            yield {"type": "step", "id": sid, "state": "skip",
                   "detail": "pominiete — brak polaczenia z bramka", "frames": []}
        yield {"type": "done"}
        return

    # 3 — interfejs Modbus, echo na trzech adresach slave
    yield start("iface")
    mark = TXLOG.last_seq()
    alive = []
    for s_addr in (slave, slave + 1, slave + 2):
        try:
            client.diagnostics(s_addr, 0x00, 0x1234)
            alive.append(s_addr)
        except (ModbusError, OSError):
            pass
    frames = _frames_since(mark)
    ms = next((f["ms"] for f in frames if f["ok"]), None)
    yield {"type": "step", "id": "iface", "state": "ok" if slave in alive else "fail",
           "ms": ms, "frames": frames,
           "detail": "odpowiada na echo 0x08/0x00 pod adresami: "
                     + (", ".join(map(str, alive)) or "brak"),
           "hint": None if alive else
           "SW1 musi byc w zakresie 1-F (przy 0 modul milczy). Po zmianie wcisnij SW7. "
           "Sprawdz predkosc SW3 i parzystosc EVEN na bramce."}

    if not alive:
        for sid in ("rs485", "uh"):
            yield {"type": "step", "id": sid, "state": "skip",
                   "detail": "pominiete — interfejs nie odpowiada", "frames": []}
        yield {"type": "done"}
        return

    # 4 — liczniki magistrali RS-485
    yield start("rs485")
    mark = TXLOG.last_seq()
    counters = {}
    for label, sub in (("ramki", 0x0B), ("bledy_crc", 0x0C), ("do_slave", 0x0E)):
        try:
            counters[label] = client.diagnostics(slave, sub)
        except (ModbusError, OSError):
            counters[label] = None
    crc = counters.get("bledy_crc")
    yield {"type": "step", "id": "rs485", "state": "ok" if crc == 0 else "warn",
           "frames": _frames_since(mark),
           "detail": f"ramek {counters.get('ramki')}, bledow CRC {crc}, "
                     f"do tego slave {counters.get('do_slave')}",
           "hint": None if crc == 0 else
           "Bledy CRC oznaczaja problem warstwy fizycznej: terminacja SW5, ekran, dlugosc linii."}

    # 5 — magistrala Uh, jednostka po jednostce
    yield start("uh")
    units_out = []
    idents = [r for r in dev["registers"] if r.get("card") == "ident"]
    mark_all = TXLOG.last_seq()
    for r in idents:
        mark = TXLOG.last_seq()
        try:
            words = client.read_regs(slave, FUNC[r["space"]], r["addr"], r["count"])
            dec = decode(r, words)
            present = not dec.get("absent")
            u = {"iu": r.get("iu"), "label": r.get("iu_label"), "present": present,
                 "model": dec["value"] if present else None}
        except (ModbusError, OSError) as exc:
            u = {"iu": r.get("iu"), "label": r.get("iu_label"),
                 "present": False, "error": str(exc)}
        u["frames"] = _frames_since(mark)
        units_out.append(u)
        yield {"type": "unit", "unit": u}

    n_present = sum(1 for u in units_out if u["present"])
    yield {"type": "step", "id": "uh", "state": "ok" if n_present else "warn",
           "frames": _frames_since(mark_all),
           "detail": f"{n_present} z {len(units_out)} jednostek odpowiada",
           "hint": None if n_present else
           "Zaden RAC interface nie odpowiada. Jesli nie sa jeszcze zamontowane — to stan oczekiwany. "
           "Jesli sa: sprawdz SW62 Bit3 = ON, SW61 Bit3 = ON oraz Central controller ID = old controller."}
    TXLOG.note(dev["id"], "diagnostyka lancucha — koniec", "ok")
    yield {"type": "done"}


def trace_device(dev: dict) -> dict:
    """Wersja bez strumienia — zbiera to samo, co trace_steps."""
    steps, units = [], []
    for ev in trace_steps(dev):
        if ev["type"] == "step" and ev.get("state") != "run":
            steps.append(ev)
        elif ev["type"] == "unit":
            units.append(ev["unit"])
    return {"steps": steps, "units": units, "ts": time.time()}

# --------------------------------------------------------------------------- HTTP

def public_device(dev: dict) -> dict:
    return {k: v for k, v in dev.items() if k not in ("client", "bykey")}


class Handler(BaseHTTPRequestHandler):
    server_version = "modbus-ui"

    def log_message(self, fmt, *args):  # cisza w journalu poza bledami
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _static(self, path: str) -> None:
        name = os.path.basename(path) or "index.html"
        full = os.path.join(STATIC, name)
        if not os.path.isfile(full):
            self._send(404, b"not found", "text/plain")
            return
        ctype = {"html": "text/html; charset=utf-8", "js": "application/javascript; charset=utf-8",
                 "css": "text/css; charset=utf-8", "svg": "image/svg+xml"}.get(name.rsplit(".", 1)[-1],
                                                                               "application/octet-stream")
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path == "/api/devices":
                self._json(200, {"devices": [public_device(d) for d in CFG["devices"]]})
            elif u.path == "/api/read":
                dev = CFG["byid"].get(q.get("device", [""])[0])
                if not dev:
                    self._json(404, {"error": "nieznane urzadzenie"})
                    return
                self._json(200, read_device(dev))
            elif u.path == "/api/diag":
                dev = CFG["byid"].get(q.get("device", [""])[0])
                if not dev:
                    self._json(404, {"error": "nieznane urzadzenie"})
                    return
                c: ModbusClient = dev["client"]
                out = {}
                for label, sub in (("bus_message_count", 0x0B), ("bus_comm_error_count", 0x0C),
                                   ("slave_message_count", 0x0E)):
                    try:
                        out[label] = c.diagnostics(dev["slave"], sub)
                    except (ModbusError, OSError) as exc:
                        out[label] = f"blad: {exc}"
                self._json(200, out)
            elif u.path == "/api/trace/stream":
                dev = CFG["byid"].get(q.get("device", [""])[0])
                if not dev:
                    self._json(404, {"error": "nieznane urzadzenie"})
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                try:
                    for ev in trace_steps(dev):
                        payload = json.dumps(ev, ensure_ascii=False)
                        self.wfile.write(f"data: {payload}\n\n".encode())
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as exc:  # noqa: BLE001
                    try:
                        self.wfile.write(
                            f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n".encode())
                        self.wfile.flush()
                    except OSError:
                        pass
            elif u.path == "/api/trace":
                dev = CFG["byid"].get(q.get("device", [""])[0])
                if not dev:
                    self._json(404, {"error": "nieznane urzadzenie"})
                    return
                self._json(200, trace_device(dev))
            elif u.path == "/api/log":
                since = int(q.get("since", ["0"])[0])
                self._json(200, {"entries": TXLOG.since(since), "last": TXLOG.last_seq()})
            elif u.path == "/api/audit":
                rows = []
                if os.path.isfile(AUDIT_FILE):
                    with open(AUDIT_FILE) as f:
                        rows = [json.loads(x) for x in f.readlines()[-100:]]
                self._json(200, {"rows": list(reversed(rows))})
            elif u.path in ("/", "/index.html"):
                self._static("index.html")
            elif u.path.startswith("/static/"):
                self._static(u.path)
            else:
                self._send(404, b"not found", "text/plain")
        except Exception as exc:  # noqa: BLE001
            log("GET " + u.path + " -> " + traceback.format_exc())
            self._json(500, {"error": str(exc)})

    def do_POST(self):
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n) or b"{}")
            dev = CFG["byid"].get(body.get("device", ""))
            if not dev:
                self._json(404, {"error": "nieznane urzadzenie"})
                return
            if u.path == "/api/preview":
                self._json(200, preview_write(dev, body["key"], body["value"]))
            elif u.path == "/api/write":
                if not dev.get("write_enabled", False):
                    self._json(403, {"error": "zapis wylaczony dla tego urzadzenia"})
                    return
                self._json(200, write_register(dev, body["key"], body["value"]))
            else:
                self._send(404, b"not found", "text/plain")
        except PermissionError as exc:
            self._json(403, {"error": str(exc)})
        except (ValueError, KeyError) as exc:
            self._json(400, {"error": str(exc)})
        except (ModbusError, OSError) as exc:
            self._json(502, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            log("POST " + u.path + " -> " + traceback.format_exc())
            self._json(500, {"error": str(exc)})


def main():
    log(f"start, port {LISTEN_PORT}, urzadzen: {len(CFG['devices'])}")
    for d in CFG["devices"]:
        log(f"  {d['id']}: {d['host']}:{d['port']} framing={d.get('framing')} "
            f"slave={d['slave']} rejestrow={len(d['registers'])} "
            f"zapis={'TAK' if d.get('write_enabled') else 'NIE'}")
    ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
