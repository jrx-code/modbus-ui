from devices import racif

UNITS = [{"n": 5, "label": "A"}, {"n": 3, "label": "B"}, {"n": 9, "label": "C"}]


def sw21_target(brd):
    sw = next(s for s in brd if s["id"] == "sw21")
    return sw["bits"][0]["target"]


def test_board_terminator_flag():
    assert sw21_target(racif.board(7, terminator=True)) is True
    assert sw21_target(racif.board(1, terminator=False)) is False


def test_derive_terminator_on_lowest_address_not_unit_1():
    out = racif.derive(UNITS, {"ccid": "old", "sw1": 1}, cfg_slave=1)
    assert {k: v["sw21"][0] for k, v in out["states"].items()} == {"5": False, "3": True, "9": False}
    assert [p["n"] for p in out["plan"] if p["terminator"]] == [3]


def test_derive_sets_address_switches():
    out = racif.derive([{"n": 42}], racif.iface_blank(), cfg_slave=1)
    st = out["states"]["42"]
    assert (st["sw64"], st["sw63"], st["sw61"][0]) == (4, 2, False)
    assert racif.address_of(st) == 42


def test_build_terminator_on_lowest_address():
    states = {str(u["n"]): racif.blank_state() for u in UNITS}
    mods = {m["n"]: m for m in racif.build(UNITS, states)["modules"]}
    assert {n: m["terminator"] for n, m in mods.items()} == {5: False, 3: True, 9: False}
    assert {n: sw21_target(m["board"]) for n, m in mods.items()} == {5: False, 3: True, 9: False}


def test_check_missing_terminator_points_at_lowest():
    derived = racif.derive(UNITS, {"ccid": "old", "sw1": 1}, cfg_slave=1)["states"]
    for st in derived.values():
        st["sw21"][0] = False
    found = [f for f in racif.check(UNITS, derived) if f["who"] == "magistrala Uh"]
    assert len(found) == 1
    assert found[0]["apply"] == {"n": 3, "sw": "sw21", "bit": 1, "value": True}


def test_check_derived_states_are_clean():
    derived = racif.derive(UNITS, {"ccid": "old", "sw1": 1}, cfg_slave=1)["states"]
    assert racif.check(UNITS, derived) == []


def test_check_reports_address_zero():
    units = [{"n": 2, "label": "Fresh"}]
    states = {"2": racif.blank_state()}  # factory state: rotary switches at 0
    assert racif.address_of(states["2"]) == 0
    zero = [f for f in racif.check(units, states) if f.get("have") == "0" and f["who"] == "Fresh"]
    assert len(zero) == 1
    assert zero[0]["level"] == "bad"
    assert zero[0]["want"] == "2"
    assert zero[0]["apply"] == {"n": 2, "addr": 2}
