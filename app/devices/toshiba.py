"""Mapa rejestrow Toshiba BMS-IFMB1280U-E (Modbus interface).

Zrodlo: Service/Specifications Manual FILE No. A10-2103-7, Revision 7 (05.2024),
rozdzial 7 "Address assignment table" + 3-7 "List of functions for Room Air
Conditioner TU2C-LINK Interface (RAC)".

Adresy na drucie liczone wg manuala:
    coil     = numer - 1
    discrete = numer - 10001
    input    = numer - 30001
    holding  = numer - 40001

Skok miedzy jednostkami: 152 dla coils/discrete, 156 dla input/holding.
Slave N obsluguje jednostki o adresie centralnym 1-64, slave N+1 obsluguje 65-128.
"""

OP_MODE_READ = {0: "invalid", 1: "grzanie", 2: "chłodzenie", 3: "osuszanie",
                4: "wentylator", 5: "auto grzanie", 6: "auto chłodzenie", 7: "unfix"}
OP_MODE_WRITE = {0: "unfix", 1: "grzanie", 2: "chłodzenie", 3: "osuszanie",
                 4: "wentylator", 5: "auto"}
FAN = {0: "invalid", 1: "stop", 2: "auto", 3: "high", 4: "medium", 5: "low",
       7: "high+", 8: "low+"}
LOUVER = {0: "invalid", 1: "swing", 2: "F1", 3: "F2", 4: "F3", 5: "F4", 6: "F5", 7: "stop"}
SAVE = {0: "100% (bez ograniczenia)", 1: "XX% (100-50)", 2: "50%",
        3: "100% Save — niedostępne dla RAC"}

RC_BITS = ["pilot: on/off", "pilot: tryb", "pilot: setpoint",
           "pilot: żaluzja", "pilot: wentylator", "pilot: wentylacja"]
FUNC_BITS = ["Pure Filter", "Hi-Power", "ECO", "Quiet FCU", "Silence CDU"]


def _reg(**kw):
    kw.setdefault("writable", False)
    kw.setdefault("count", 1)
    kw.setdefault("type", "uint16")
    return kw


def registers_for_unit(n: int, label: str) -> list[dict]:
    """n = adres centralny jednostki wewnetrznej (1-64 w obrebie jednego slave)."""
    c = 152 * (n - 1)          # baza coils / discrete
    r = 156 * (n - 1)          # baza input / holding
    g = label or f"Jednostka {n}"
    p = f"u{n}"
    # UWAGA: nie uzywac klucza "unit" — jest zajety przez jednostke miary (°C, kW, h)
    meta = {"iu": n, "iu_label": g}

    out = [
        # --- sterowanie (zapisywalne) --------------------------------------
        _reg(key=f"{p}.onoff", group=g, name="Zasilanie", space="coil",
             number=c + 1, addr=c, type="bool", writable=True,
             note="1 = włączone", cat="control", card="power", status_key=f"{p}.onoff_st"),
        _reg(key=f"{p}.setpoint", group=g, name="Temperatura zadana", space="holding",
             number=40001 + r, addr=r, type="int16", scale=0.1, unit="°C",
             writable=True, wmin=17.0, wmax=30.0, wstep=0.5,
             cat="control", card="metric-edit", card_order=2),
        _reg(key=f"{p}.mode_set", group=g, name="Tryb pracy", space="holding",
             number=40007 + r, addr=r + 6, enum=OP_MODE_WRITE, writable=True,
             cat="control", card="select", card_order=1, status_key=f"{p}.mode_st"),
        _reg(key=f"{p}.fan_set", group=g, name="Wentylator", space="holding",
             number=40008 + r, addr=r + 7, enum=FAN, writable=True,
             cat="control", card="select", card_order=2, status_key=f"{p}.fan_st"),
        _reg(key=f"{p}.louver_set", group=g, name="Żaluzja", space="holding",
             number=40009 + r, addr=r + 8, enum=LOUVER, writable=True,
             note="dla RAC działa tylko swing / stop",
             cat="control", card="select", card_order=3, status_key=f"{p}.louver_st"),
        _reg(key=f"{p}.rc_lock", group=g, name="Blokada pilota", space="holding",
             number=40010 + r, addr=r + 9, type="bits", bits=RC_BITS, writable=True,
             note="1 = zabronione", cat="control"),
        _reg(key=f"{p}.save", group=g, name="Moc", space="holding",
             number=40011 + r, addr=r + 10, enum=SAVE, writable=True,
             cat="control", card="select", card_order=4),
        _reg(key=f"{p}.filter_reset", group=g, name="Kasowanie sygnalizacji filtra",
             space="coil", number=c + 2, addr=c + 1, type="bool", writable=True,
             note="1 = kasuj", cat="control"),

        # --- funkcje specjalne RAC (zapisywalne) ---------------------------
        _reg(key=f"{p}.hipower", group=g, name="Hi-Power", space="coil",
             number=c + 58, addr=c + 57, type="bool", writable=True,
             cat="special", card="chip", status_key=f"{p}.st_hipower"),
        _reg(key=f"{p}.eco", group=g, name="ECO", space="coil",
             number=c + 59, addr=c + 58, type="bool", writable=True,
             cat="special", card="chip", status_key=f"{p}.st_eco"),
        _reg(key=f"{p}.quiet", group=g, name="Quiet FCU", space="coil",
             number=c + 60, addr=c + 59, type="bool", writable=True,
             cat="special", card="chip", status_key=f"{p}.st_quiet"),
        _reg(key=f"{p}.silence", group=g, name="Silence CDU", space="coil",
             number=c + 61, addr=c + 60, type="bool", writable=True,
             cat="special", card="chip", status_key=f"{p}.st_silence"),

        # --- odczyt ---------------------------------------------------------
        _reg(key=f"{p}.room_temp", group=g, name="Temperatura pomieszczenia",
             space="input", number=30001 + r, addr=r, type="int16", scale=0.1,
             unit="°C", cat="state", card="metric", card_order=1),
        _reg(key=f"{p}.setpoint_st", group=g, name="Temperatura zadana (status)",
             space="input", number=30002 + r, addr=r + 1, type="int16", scale=0.1,
             unit="°C", cat="state"),
        _reg(key=f"{p}.check_code", group=g, name="Kod błędu", space="input",
             number=30003 + r, addr=r + 2, type="hex16",
             note="0x0000 = brak błędu", cat="diag"),
        _reg(key=f"{p}.model", group=g, name="Nazwa modelu", space="input",
             number=30007 + r, addr=r + 6, count=8, type="string",
             note="same zera = brak jednostki na magistrali", cat="ident", card="ident"),
        _reg(key=f"{p}.serial", group=g, name="Numer seryjny", space="input",
             number=30015 + r, addr=r + 14, count=8, type="string", cat="ident"),
        _reg(key=f"{p}.capacity", group=g, name="Wydajność", space="input",
             number=30023 + r, addr=r + 22, scale=0.1, unit="kW", cat="ident"),
        _reg(key=f"{p}.mode_st", group=g, name="Tryb pracy (status)", space="input",
             number=30036 + r, addr=r + 35, enum=OP_MODE_READ, cat="state"),
        _reg(key=f"{p}.fan_st", group=g, name="Wentylator (status)", space="input",
             number=30037 + r, addr=r + 36, enum=FAN, cat="state"),
        _reg(key=f"{p}.louver_st", group=g, name="Żaluzja (status)", space="input",
             number=30038 + r, addr=r + 37, enum=LOUVER, cat="state"),
        _reg(key=f"{p}.func_status", group=g, name="Obslugiwane funkcje RAC",
             space="input", number=30059 + r, addr=r + 58, type="bits", bits=FUNC_BITS, cat="special"),
        _reg(key=f"{p}.hours", group=g, name="Godziny pracy", space="holding",
             number=40002 + r, addr=r + 1, unit="h", cat="diag"),
        _reg(key=f"{p}.onoff_st", group=g, name="Zasilanie (status)", space="discrete",
             number=10001 + c, addr=c, type="bool", cat="state"),
        _reg(key=f"{p}.filter_sign", group=g, name="Filtr",
             space="discrete", number=10002 + c, addr=c + 1, type="bool", cat="state", card="flag", flag_kind="warn"),
        _reg(key=f"{p}.alarm", group=g, name="Alarm", space="discrete",
             number=10003 + c, addr=c + 2, type="bool", cat="state", card="flag", flag_kind="bad"),
        _reg(key=f"{p}.thermo", group=g, name="Sprężarka",
             space="discrete", number=10004 + c, addr=c + 3, type="bool", cat="state", card="flag", flag_kind="ok"),
        _reg(key=f"{p}.st_purefilter", group=g, name="Pure Filter (status)",
             space="discrete", number=10081 + c, addr=c + 80, type="bool", cat="special"),
        _reg(key=f"{p}.st_hipower", group=g, name="Hi-Power (status)",
             space="discrete", number=10082 + c, addr=c + 81, type="bool", cat="special"),
        _reg(key=f"{p}.st_eco", group=g, name="ECO (status)",
             space="discrete", number=10083 + c, addr=c + 82, type="bool", cat="special"),
        _reg(key=f"{p}.st_quiet", group=g, name="Quiet FCU (status)",
             space="discrete", number=10084 + c, addr=c + 83, type="bool", cat="special"),
        _reg(key=f"{p}.st_silence", group=g, name="Silence CDU (status)",
             space="discrete", number=10085 + c, addr=c + 84, type="bool", cat="special"),
    ]
    for x in out:
        x.update(meta)
        x.setdefault("cat", "diag")
    return out


def build(units: list[dict]) -> list[dict]:
    regs = []
    for u in units:
        regs.extend(registers_for_unit(u["n"], u.get("label", "")))
    return regs
