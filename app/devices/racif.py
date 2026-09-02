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

# --------------------------------------------------------------------------- interfejs Modbus (modul glowny)

# BMS-IFMB1280U-E to modul, do ktorego wpieta jest bramka RS-485. To on narzuca
# adapterom zakres adresow i to, kto zamyka magistrale Uh - dlatego ustawienia
# adapterow liczy sie od niego, a nie od jednego z nich.
#
# Zrodla: [SM] Service Manual A10-2103-7 rev. 7 - rozdz. 7 "Switches for setting"
# (str. 28-29), tabela zakresow adresow (str. 6-7), procedura Central controller ID
# (str. 30-31), NOTE do rozdz. 3-7 (str. 16), sekcja 9-7 (str. 38).

# SW3 Bit3/Bit4 -> predkosc RS-485 [SM str. 28]. ON+ON daje to samo, co ON+OFF.
BAUD_BY_BITS = {(False, False): 9600, (True, False): 19200,
                (False, True): 38400, (True, True): 19200}

# Adresy slave dla kolejnych interfejsow na jednej szynie RS-485 [SM str. 7 i 28].
# Skok wynosi 3, bo jeden interfejs zajmuje trzy adresy.
IFACE_SLOTS = [1, 4, 7, 10, 13]

CCID = {"old": "old controller (SW1 = F)", "id20": "central controller ID20 (fabryczne)"}


def iface_board() -> list[dict]:
    return [
        {"id": "sw1", "kind": "hex", "name": "SW1", "src": "SM str. 28",
         "title": "Modbus interface address — adres slave",
         "note": "Zakres <span class='mono'>1-F</span>. Jeden interfejs zajmuje <b>trzy</b> adresy: "
                 "<span class='mono'>N</span> obsluguje jednostki o adresie centralnym 1-64, "
                 "<span class='mono'>N+1</span> jednostki 65-128, <span class='mono'>N+2</span> "
                 "linie jednostek zewnetrznych 1-28. Przy kilku interfejsach na jednej szynie: "
                 "<span class='mono'>1, 4, 7, 10, 13</span>. "
                 "<b>Przy 0 interfejs nie dziala.</b> Po zmianie wcisnij <span class='mono'>SW7</span>."},
        {"id": "sw2", "kind": "hex", "name": "SW2", "src": "SM str. 28",
         "title": "Test switch",
         "note": "W pracy normalnej <span class='mono'>0</span>. "
                 "<span class='mono'>SW2 = 3</span> + <span class='mono'>SW7</span> zeruje liczniki "
                 "czasu pracy, potem trzeba wrocic na 0 i znowu wcisnac SW7."},
        {"id": "sw3", "kind": "dip", "name": "SW3", "src": "SM str. 28",
         "title": "Test switch — tryb ID, LED5, predkosc",
         "bits": [
             {"i": 1, "target": False,
              "desc": "tryb ustawiania Central controller ID. <span class='mono'>OFF</span> w pracy normalnej"},
             {"i": 2, "target": False,
              "desc": "zrodlo dla LED5: <span class='mono'>OFF</span> = RS-485, "
                      "<span class='mono'>ON</span> = Uh line"},
             {"i": 3, "target": None, "desc": "razem z Bit4 wybiera predkosc RS-485"},
             {"i": 4, "target": None, "desc": "razem z Bit3 wybiera predkosc RS-485"},
         ],
         "table": [["Bit3", "Bit4", "Predkosc", "Uwagi"],
                   ["OFF", "OFF", "9600 bps", "ustawienie fabryczne"],
                   ["ON", "OFF", "19200 bps", ""],
                   ["OFF", "ON", "38400 bps", "najszybsze, jakie interfejs przyjmuje"],
                   ["ON", "ON", "19200 bps", "to samo co ON/OFF"]],
         "note": "Predkosc musi sie zgadzac z bramka RS-485. Po zmianie wcisnij "
                 "<span class='mono'>SW7</span>, dopiero potem przestaw bramke."},
        {"id": "sw5", "kind": "two", "name": "SW5", "src": "SM str. 29",
         "title": "Terminator RS-485",
         "on": "120 Ω", "off": "open",
         "note": "Instrukcja, ramka REQUIREMENT: <i>Set “120 ohm” only when the Modbus interface "
                 "address SW=1, and set “open” for other Modbus interfaces</i>."},
        {"id": "sw6", "kind": "two", "name": "SW6", "src": "SM str. 29",
         "title": "Terminator magistrali Uh",
         "on": "100 Ω", "off": "open",
         "note": "Instrukcja, ta sama ramka: <i>The Uh Line Termination resistance is set on the "
                 "air conditioner side. Set SW6 to “open”.</i> Terminacje Uh robi adapter przez SW21."},
        {"id": "sw8", "kind": "dip", "name": "SW8", "src": "SM str. 28",
         "title": "Test switch",
         "bits": [{"i": 1, "target": False, "desc": "w pracy normalnej <span class='mono'>OFF</span>"},
                  {"i": 2, "target": False, "desc": "w pracy normalnej <span class='mono'>OFF</span>"}],
         "note": "Instrukcja: <i>Test switch (all OFF usually)</i>."},
        {"id": "ccid", "kind": "choice", "name": "Central controller ID", "src": "SM str. 16, 30-31",
         "title": "Tozsamosc interfejsu na magistrali Uh",
         "options": [["old", CCID["old"]], ["id20", CCID["id20"]]],
         "note": "NOTE do rozdzialu 3-7: <i>When connecting with RAC interface, need to set the "
                 "“Central controller ID setting” of the Modbus interface to “old controller”.</i> "
                 "Procedura: <span class='mono'>SW3 Bit1 → ON</span>, <span class='mono'>SW1 → F</span>, "
                 "<span class='mono'>SW4</span>, <span class='mono'>SW3 Bit1 → OFF</span>, "
                 "<b>SW1 z powrotem na adres slave</b>, <span class='mono'>SW7</span>."},
    ]


def iface_blank() -> dict:
    """Stan fabryczny interfejsu: SW1 nieustawione, ID20, wszystko open [SM str. 28-30]."""
    return {"sw1": 0, "sw2": 0, "sw3": [False] * 4, "sw5": False, "sw6": False,
            "sw8": [False, False], "ccid": "id20"}


def iface_normalize(raw) -> dict:
    st = iface_blank()
    if not isinstance(raw, dict):
        return st
    for k in ("sw1", "sw2"):
        try:
            v = int(raw.get(k, 0))
        except (TypeError, ValueError):
            v = 0
        st[k] = v if 0 <= v <= 15 else 0
    for k, width in (("sw3", 4), ("sw8", 2)):
        v = raw.get(k)
        if isinstance(v, list):
            st[k] = [bool(v[i]) if i < len(v) else False for i in range(width)]
    for k in ("sw5", "sw6"):
        st[k] = bool(raw.get(k, False))
    if raw.get("ccid") in CCID:
        st["ccid"] = raw["ccid"]
    return st


def iface_baud(state: dict) -> int:
    return BAUD_BY_BITS[(state["sw3"][2], state["sw3"][3])]


def iface_check(state: dict, cfg_slave: int) -> list[dict]:
    """Bledy w ustawieniu interfejsu. Reguly z instrukcji, nic zgadywanego."""
    out = []
    if state["sw1"] == 0:
        out.append({"level": "bad", "text":
                    "SW1 = <span class='mono'>0</span>. Instrukcja, ramka IMPORTANT: <i>if the SW1 value "
                    "is that of the central controller ID or is 0, the Modbus interface will not operate "
                    "properly</i> [SM str. 31]."})
    elif state["sw1"] != cfg_slave:
        out.append({"level": "bad", "text":
                    f"SW1 = <span class='mono'>{state['sw1']}</span>, a w "
                    f"<span class='mono'>config.json</span> panel odpytuje slave "
                    f"<span class='mono'>{cfg_slave}</span>. Jedno z dwoch trzeba zmienic, inaczej "
                    "aplikacja mowi w prozne."})
    if state["sw1"] and state["sw1"] not in IFACE_SLOTS:
        out.append({"level": "warn", "text":
                    f"SW1 = <span class='mono'>{state['sw1']}</span> nie jest zadnym z adresow "
                    "przewidzianych dla kolejnych interfejsow (<span class='mono'>1, 4, 7, 10, 13</span>) "
                    "[SM str. 28]. Przy jednym interfejsie to nie szkodzi, przy dwoch adresy sie nalozą."})

    if state["ccid"] != "old":
        out.append({"level": "bad", "text":
                    "Central controller ID to <span class='mono'>" + CCID[state["ccid"]] + "</span>. "
                    "NOTE do rozdz. 3-7: <i>When connecting with RAC interface, need to set the "
                    "“Central controller ID setting” of the Modbus interface to “old controller”</i> "
                    "[SM str. 16]. Bez tego adaptery RAC nie beda obslugiwane."})

    want5 = state["sw1"] == 1
    if state["sw5"] != want5:
        out.append({"level": "warn" if not want5 else "bad", "text":
                    f"SW5 stoi na <span class='mono'>{'120 Ω' if state['sw5'] else 'open'}</span>, "
                    f"a przy SW1 = <span class='mono'>{state['sw1']}</span> ma byc "
                    f"<span class='mono'>{'120 Ω' if want5 else 'open'}</span> — instrukcja: "
                    "<i>Set “120 ohm” only when the Modbus interface address SW=1</i> [SM str. 29]."})
    if state["sw6"]:
        out.append({"level": "bad", "text":
                    "SW6 stoi na <span class='mono'>100 Ω</span>. Instrukcja: <i>The Uh Line Termination "
                    "resistance is set on the air conditioner side. Set SW6 to “open”</i> [SM str. 29]. "
                    "Terminacje Uh robi adapter przez SW21 — tak masz dwa rezystory."})
    if state["sw3"][0]:
        out.append({"level": "bad", "text":
                    "SW3 Bit1 = ON, czyli interfejs siedzi w trybie ustawiania Central controller ID, "
                    "a nie w pracy normalnej [SM str. 28]."})
    if state["sw2"]:
        out.append({"level": "warn", "text":
                    f"SW2 = <span class='mono'>{state['sw2']}</span>, a instrukcja mowi "
                    "<i>Set these switches to zero (0)</i> w pracy normalnej [SM str. 28]."})
    if any(state["sw8"]):
        out.append({"level": "warn", "text":
                    "SW8 ma bit w pozycji ON, a instrukcja: <i>Test switch (all OFF usually)</i> "
                    "[SM str. 28]."})
    return out


# --------------------------------------------------------------------------- wyliczanie adapterow z interfejsu

def _apply_addr(state: dict, addr: int) -> None:
    """Rozklada adres centralny na przelaczniki adaptera [OM str. 3]."""
    state["sw61"][0] = addr >= 100
    state["sw64"] = (addr // 10) % 10
    state["sw63"] = addr % 10


def derive(units: list[dict], iface_state: dict, cfg_slave: int) -> dict:
    """Rozpisuje ustawienia adapterow RAC I/F na podstawie interfejsu Modbus.

    Interfejs nie ustawia adresow jednostek - te biora sie z pola n w config.json.
    Narzuca natomiast zakres adresow, terminacje Uh i to, ze adaptery musza pracowac
    w TU2C-LINK, zeby dzialaly funkcje specjalne RAC.
    """
    iface = iface_normalize(iface_state)
    order = [u["n"] for u in units]
    names = {u["n"]: (u.get("label") or f"Jednostka {u['n']}") for u in units}
    lowest = min(order, default=0)

    states, notes, why = {}, [], []

    for n in order:
        st = blank_state()
        st["sw61"] = [n >= 100, True, True, False]
        st["sw62"] = [False, False, True, False]
        _apply_addr(st, n)
        st["sw21"] = [n == lowest, False]
        states[str(n)] = st

    # 1. co narzucil interfejs
    if iface["ccid"] == "old":
        why.append("Central controller ID = <b>old controller</b> ⇒ adresy centralne jednostek "
                   "w zakresie <span class='mono'>1-64</span> [SM str. 33], maksymalnie 64 jednostki "
                   "[SM str. 16].")
    else:
        notes.append({"level": "bad", "text":
                      "Interfejs nie jest ustawiony na <span class='mono'>old controller</span>, "
                      "a przy adapterach RAC musi byc [SM str. 16]. Popraw interfejs — wyliczenie "
                      "ponizej zaklada, ze to zrobisz."})
    why.append(f"SW1 = <span class='mono'>{iface['sw1']}</span> ⇒ ten adres slave obsluguje jednostki "
               "o adresie centralnym <span class='mono'>1-64</span>, kolejny "
               f"(<span class='mono'>{iface['sw1'] + 1}</span>) jednostki 65-128 [SM str. 7].")
    if not iface["sw6"]:
        why.append(f"SW6 = <b>open</b> na interfejsie ⇒ magistrale Uh zamyka adapter: "
                   f"<span class='mono'>SW21 Bit1 = ON</span> na module „{names[lowest]}”, "
                   "bo ma najnizszy adres [OM str. 2, SM str. 29].")
    else:
        notes.append({"level": "bad", "text":
                      "SW6 na interfejsie stoi na <span class='mono'>100 Ω</span>. Wyliczenie i tak "
                      "daje terminator na adapterze, wiec magistrala Uh mialaby dwa. Ustaw SW6 na "
                      "<span class='mono'>open</span> [SM str. 29]."})
    why.append("Adaptery RAC pracuja w <b>TU2C-LINK</b> ⇒ <span class='mono'>SW61 Bit2 = ON</span> "
               "(wybor reczny) i <span class='mono'>SW61 Bit3 = ON</span>. W TCC-LINK interfejs nie "
               "udostepnia funkcji specjalnych RAC [SM str. 35].")
    why.append("<span class='mono'>SW62 Bit3 = ON</span> na kazdym adapterze, inaczej adapter nie "
               "ustawia adresu centralnego i interfejs nie ma czego odpytac [OM str. 3].")
    why.append(f"Predkosc RS-485 <span class='mono'>{iface_baud(iface)} bps</span> dotyczy wylacznie "
               "lacza interfejs–bramka. Adapterow nie ustawia sie na predkosc.")

    # 2. adresy z config.json
    for n in order:
        if not ADDR_MIN <= n <= ADDR_MAX:
            notes.append({"level": "bad", "text":
                          f"{names[n]}: <span class='mono'>n = {n}</span> w config.json jest poza "
                          f"zakresem <span class='mono'>{ADDR_MIN}-{ADDR_MAX}</span>, ktory narzuca "
                          "Central controller ID = old controller [SM str. 33]."})
    if len(set(order)) != len(order):
        notes.append({"level": "bad", "text":
                      "config.json ma dwie jednostki o tym samym <span class='mono'>n</span>. "
                      "SM str. 32: <i>Set the indoor unit central control address so that it does not "
                      "match any other indoor unit addresses</i>."})
    if len(order) > 64:
        notes.append({"level": "bad", "text":
                      "wiecej niz 64 jednostki na jednym interfejsie przy adapterach RAC "
                      "[SM str. 16: <i>The maximum number of indoor units that can be connected "
                      "is 64 IDUs</i>]."})

    notes.append({"level": "warn", "text":
                  "Po przelaczeniu interfejsu na <span class='mono'>old controller</span> jednostki "
                  "zgodne z TU2C-LINK moga przestac odpowiadac do czasu ich restartu "
                  "[SM str. 38, sekcja 9-7]."})

    plan = [{"n": n, "label": names[n], "addr": n,
             "sw64": (n // 10) % 10, "sw63": n % 10,
             "terminator": n == lowest} for n in order]
    return {"states": states, "notes": notes, "why": why, "plan": plan,
            "iface": iface, "baud": iface_baud(iface), "slave": iface["sw1"],
            "cfg_slave": cfg_slave}
