"""Konfiguracja adapterow RAC I/F Toshiba TCB-SSRL011UUP-E.

Jeden adapter siedzi w kazdej jednostce wewnetrznej (zlacze CN50) i wystawia ja
na magistrale Uh. To nie sa rejestry Modbus - to fizyczne przelaczniki na plytce,
ktorych aplikacja nie moze ani odczytac, ani ustawic. Panel sluzy do policzenia
wartosci docelowej z adresow w config.json i do zapisania tego, co faktycznie
zastano na sprzecie.

Zrodla, wszystko dosownie z dokumentacji, nic zgadywanego:
  [OM]  Owner's Manual TCB-SSRL011UUP-E, "Setup of P.C. Board Switch" (str. 2-3)
        oraz "LED Status" (str. 1).
  [SM]  Service Manual BMS-IFMB1280U-E, FILE No. A10-2103-7 rev. 7 (05.2024):
        rozdz. 7 - procedura Central controller ID, tabela "Old controller"
        (zakres adresu centralnego 1-64, str. 33), rozdz. 8-3 (str. 32) - SW7
        po zmianie adresu, tabela troubleshootingu (str. 35).
"""

# Zakres adresu centralnego przy Central controller ID = "old controller" [SM str. 33].
# Tak wlasnie musi byc ustawiony BMS-IFMB, kiedy za nim stoja adaptery RAC.
ADDR_MIN = 1
ADDR_MAX = 64

# --------------------------------------------------------------------------- opis plytki

SW21_TERM = {
    (False, False): "brak",
    (True, False): "100 Ω",
    (False, True): "51 Ω (Spare)",
    (True, True): "34 Ω (Spare)",
}

LEDS = [
    ("POWER", "swieci przy zasilaniu, gasnie bez zasilania"),
    ("UART", "lacze do jednostki wewnetrznej (CN50): <b>miga</b> w trakcie transmisji, "
             "nie swieci przy braku transmisji, <b>swieci ciagle</b> gdy adapter nie dostal "
             "odpowiedzi od klimatyzatora trzy razy z rzedu"),
    ("BUS", "lacze do sterownika centralnego: <b>miga</b> w trakcie transmisji, "
            "<b>swieci ciagle</b> gdy przez 20 minut nie bylo odpowiedzi"),
    ("PROTOCOL", "<b>swieci ciagle = TU2C-LINK</b> (tak ma byc), "
                 "<b>miga = TCC-LINK</b>, czyli SW61 Bit3 nie zadzialal"),
]


def board(n: int, terminator: bool) -> list[dict]:
    """Opis plytki jednego adaptera z wartosciami docelowymi dla adresu n.

    terminator = czy ten adapter ma zamknac magistrale Uh rezystorem.
    """
    hundreds = n >= 100
    return [
        {
            "id": "sw21",
            "kind": "dip",
            "name": "SW21",
            "title": "Option Switch — terminator magistrali Uh",
            "src": "OM str. 2",
            "bits": [
                {"i": 1, "target": terminator,
                 "desc": "razem z Bit2 wybiera rezystor terminujacy"},
                {"i": 2, "target": False,
                 "desc": "kombinacje z Bit2 = ON sa oznaczone w instrukcji jako <i>Spare</i>"},
            ],
            "note": "Rezystor ustawia sie <b>tylko na adapterze przy jednostce o najnizszym "
                    "adresie</b>. Dwa rezystory na jednej magistrali to blad okablowania, "
                    "nie ustawien.",
            "table": [["Bit1", "Bit2", "Rezystor", "Uwagi z instrukcji"],
                      ["OFF", "OFF", "brak", "stan fabryczny"],
                      ["ON", "OFF", "100 Ω", "sterowanie centralne wylacznie RAC / Indoor Multi Split"],
                      ["OFF", "ON", "51 Ω", "Spare"],
                      ["ON", "ON", "34 Ω", "Spare"]],
        },
        {
            "id": "sw61",
            "kind": "dip",
            "name": "SW61",
            "title": "Setting Switch — setki adresu i wybor protokolu",
            "src": "OM str. 3",
            "bits": [
                {"i": 1, "target": hundreds,
                 "desc": "setki adresu wewnetrznego: <span class='mono'>ON = 1xx</span>, "
                         "<span class='mono'>OFF = 0xx</span>"},
                {"i": 2, "target": True,
                 "desc": "wybor protokolu: <span class='mono'>ON = Manual</span> (decyduje Bit3), "
                         "<span class='mono'>OFF = Automatic</span>"},
                {"i": 3, "target": True,
                 "desc": "<span class='mono'>ON = TU2C-LINK</span> (Residential A/C), "
                         "<span class='mono'>OFF = TCC-LINK</span> (Light commercial)"},
                {"i": 4, "target": False,
                 "desc": "instrukcja: <i>Set switch OFF</i>. Przy ON adapter nie komunikuje sie "
                         "ze sterownikiem centralnym."},
            ],
            "note": "Instrukcja: jesli sterownik centralny obsluguje RAC I/F, wybierz TU2C-LINK. "
                    "BMS-IFMB1280U-E obsluguje.",
        },
        {
            "id": "sw62",
            "kind": "dip",
            "name": "SW62",
            "title": "Setting Switch — adres centralny",
            "src": "OM str. 3",
            "bits": [
                {"i": 1, "target": False, "desc": "instrukcja: <i>Set switch OFF</i>, ON jest <span class='mono'>N/A</span>"},
                {"i": 2, "target": False, "desc": "instrukcja: <i>Set switch OFF</i>, ON jest <span class='mono'>N/A</span>"},
                {"i": 3, "target": True,
                 "desc": "<span class='mono'>ON: Central Address = Indoor Address</span>, "
                         "<span class='mono'>OFF: No set Central Address</span>"},
                {"i": 4, "target": False, "desc": "instrukcja: <i>Set switch OFF</i>, ON jest <span class='mono'>N/A</span>"},
            ],
            "note": "Bez Bit3 adapter nie ustawia adresu centralnego, wiec Modbus interface "
                    "nie ma czego zaadresowac i jednostka nie pojawi sie na magistrali.",
        },
        {
            "id": "sw64",
            "kind": "rotary",
            "name": "SW64",
            "title": "Rotary Switch — dziesiatki adresu",
            "src": "OM str. 3",
            "target": (n // 10) % 10,
            "note": "Pokretlo skokowe 0-9. Ustawia jednoczesnie Indoor Address i Central Address.",
        },
        {
            "id": "sw63",
            "kind": "rotary",
            "name": "SW63",
            "title": "Rotary Switch — jednosci adresu",
            "src": "OM str. 3",
            "target": n % 10,
            "note": "Pokretlo skokowe 0-9. Setki bierze sie z SW61 Bit1, nie stad.",
        },
        {
            "id": "sw65",
            "kind": "push",
            "name": "SW65",
            "title": "Push Switch — reset fabryczny",
            "src": "OM str. 2",
            "note": "Przytrzymanie 4 s przywraca ustawienia fabryczne i kasuje kod bledu, "
                    "wyswietlacz pokazuje <span class='mono'>CLr</span>. "
                    "Nie ustawia sie go na stale, dlatego nie ma go w tabeli roznic.",
        },
    ]


def blank_state() -> dict:
    """Stan fabryczny adaptera prosto z pudelka [OM str. 2: 'Shipping status from factory']."""
    return {"sw21": [False, False], "sw61": [False] * 4, "sw62": [False] * 4,
            "sw63": 0, "sw64": 0, "note": ""}


def normalize(raw) -> dict:
    """Przycina cokolwiek przyszlo z zewnatrz do ksztaltu stanu adaptera."""
    st = blank_state()
    if not isinstance(raw, dict):
        return st
    for sw, width in (("sw21", 2), ("sw61", 4), ("sw62", 4)):
        v = raw.get(sw)
        if isinstance(v, list):
            st[sw] = [bool(v[i]) if i < len(v) else False for i in range(width)]
    for sw in ("sw63", "sw64"):
        try:
            d = int(raw.get(sw, 0))
        except (TypeError, ValueError):
            d = 0
        st[sw] = d if 0 <= d <= 9 else 0
    note = raw.get("note", "")
    st["note"] = str(note)[:200] if isinstance(note, str) else ""
    return st


# --------------------------------------------------------------------------- reguly

def _label(sw: str, bit: int, on: bool) -> str:
    return f"{sw.upper()} Bit{bit} → {'ON' if on else 'OFF'}"


def diff(state: dict, brd: list[dict]) -> list[dict]:
    """Lista fizycznych ruchow prowadzacych ze stanu zastanego do docelowego."""
    out = []
    for sw in brd:
        if sw["kind"] == "dip":
            cur = state[sw["id"]]
            for b in sw["bits"]:
                have = cur[b["i"] - 1]
                if have != b["target"]:
                    out.append({"what": _label(sw["id"], b["i"], b["target"]),
                                "from": "ON" if have else "OFF",
                                "to": "ON" if b["target"] else "OFF"})
        elif sw["kind"] == "rotary":
            have = state[sw["id"]]
            if have != sw["target"]:
                out.append({"what": f"{sw['name']} → {sw['target']}",
                            "from": str(have), "to": str(sw["target"])})
    return out


def address_of(state: dict) -> int:
    """Adres, ktory adapter faktycznie zglosi przy obecnym ustawieniu przelacznikow."""
    return (100 if state["sw61"][0] else 0) + state["sw64"] * 10 + state["sw63"]


def check(units: list[dict], states: dict) -> list[dict]:
    """Bledy wynikajace z ustawien, liczone regulami z instrukcji. Zero modelu."""
    out = []
    seen: dict[int, list[str]] = {}
    terminators = []

    for u in units:
        n = u["n"]
        name = u.get("label") or f"Jednostka {n}"
        st = states[str(n)]
        addr = address_of(st)

        seen.setdefault(addr, []).append(name)
        if st["sw21"][0]:
            terminators.append(name)

        if addr == 0:
            out.append({"level": "bad", "who": name,
                        "text": "adres ustawiony na <span class='mono'>0</span>, a przy "
                                "Central controller ID = <i>old controller</i> dopuszczalny "
                                "zakres to <span class='mono'>1-64</span> [SM str. 33]. "
                                "Jednostka nie zostanie zaadresowana."})
        elif not ADDR_MIN <= addr <= ADDR_MAX:
            out.append({"level": "bad", "who": name,
                        "text": f"adres <span class='mono'>{addr}</span> poza zakresem "
                                f"<span class='mono'>{ADDR_MIN}-{ADDR_MAX}</span> [SM str. 33]."})
        elif addr != n:
            out.append({"level": "warn", "who": name,
                        "text": f"przelaczniki daja adres <span class='mono'>{addr}</span>, "
                                f"a w <span class='mono'>config.json</span> jednostka ma numer "
                                f"<span class='mono'>{n}</span>. Rejestry beda czytane z zlego miejsca."})

        if st["sw61"][3]:
            out.append({"level": "bad", "who": name,
                        "text": "SW61 Bit4 = ON. Instrukcja: <i>If set “ON” can't communicate "
                                "with Central Controller</i> [OM str. 3]."})
        if not st["sw61"][1]:
            out.append({"level": "warn", "who": name,
                        "text": "SW61 Bit2 = OFF, czyli wybor protokolu automatyczny — Bit3 nie ma "
                                "wtedy znaczenia i nie masz gwarancji TU2C-LINK."})
        elif not st["sw61"][2]:
            out.append({"level": "warn", "who": name,
                        "text": "SW61 Bit3 = OFF przy Bit2 = ON, czyli wymuszony TCC-LINK. "
                                "Funkcje specjalne RAC (Hi-Power, ECO, Quiet, Silence) beda niedostepne "
                                "[SM str. 35]."})
        if not st["sw62"][2]:
            out.append({"level": "bad", "who": name,
                        "text": "SW62 Bit3 = OFF, czyli <i>No set Central Address</i> [OM str. 3]. "
                                "Modbus interface nie zaadresuje tej jednostki."})
        for i in (0, 1, 3):
            if st["sw62"][i]:
                out.append({"level": "warn", "who": name,
                            "text": f"SW62 Bit{i + 1} = ON, a instrukcja opisuje ten stan jako "
                                    "<span class='mono'>N/A</span> [OM str. 3]."})
        if st["sw21"][1]:
            out.append({"level": "warn", "who": name,
                        "text": "SW21 Bit2 = ON daje rezystor z pozycji oznaczonej w instrukcji "
                                "jako <i>Spare</i> ("
                                + SW21_TERM[(st["sw21"][0], True)] + ")."})

    for addr, who in seen.items():
        if len(who) > 1:
            out.append({"level": "bad", "who": ", ".join(who),
                        "text": f"ten sam adres <span class='mono'>{addr}</span> na kilku adapterach. "
                                "SM str. 32: <i>Set the indoor unit central control address so that it "
                                "does not match any other indoor unit addresses</i>."})

    if len(terminators) > 1:
        out.append({"level": "bad", "who": ", ".join(terminators),
                    "text": "wiecej niz jeden terminator na magistrali Uh. Instrukcja dopuszcza "
                            "go tylko na adapterze przy jednostce o najnizszym adresie [OM str. 2]."})
    elif not terminators:
        out.append({"level": "warn", "who": "magistrala Uh",
                    "text": "zaden adapter nie ma wlaczonego terminatora. Instrukcja wymaga go "
                            "na adapterze o najnizszym adresie [OM str. 2]."})
    return out


AFTER = [
    "Po zmianie ustawien adaptera zrestartuj Modbus interface — <i>If you have changed the RAC "
    "interface settings, restart the Modbus interface</i> [SM str. 35, tabela troubleshootingu].",
    "Po zmianie adresu centralnego, adresu linii albo adresu jednostki wcisnij <span class='mono'>SW7</span> "
    "na BMS-IFMB — [SM str. 32, przed procedura 8-3].",
    "Sprawdz diode <span class='mono'>PROTOCOL</span> na adapterze: ciagle swiatlo to TU2C-LINK, "
    "miganie to TCC-LINK, czyli SW61 Bit3 nie zadzialal [OM str. 1].",
]


def build(units: list[dict], states: dict) -> dict:
    """Pelny obraz dla panelu: plytki, wartosci docelowe, roznice, bledy."""
    lowest = min((u["n"] for u in units), default=0)
    mods = []
    for u in units:
        n = u["n"]
        st = states[str(n)]
        brd = board(n, terminator=(n == lowest))
        mods.append({
            "n": n,
            "label": u.get("label") or f"Jednostka {n}",
            "terminator": n == lowest,
            "board": brd,
            "state": st,
            "address": address_of(st),
            "diff": diff(st, brd),
        })
    return {"modules": mods, "checks": check(units, states), "leds": LEDS, "after": AFTER,
            "addr_range": [ADDR_MIN, ADDR_MAX]}
