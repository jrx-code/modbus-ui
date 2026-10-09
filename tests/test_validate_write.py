import pytest


@pytest.fixture()
def dev(server):
    return server.CFG["byid"]["toshiba"]


def test_unknown_register(server, dev):
    with pytest.raises(ValueError, match="Nieznany"):
        server.validate_write(dev, "u1.does_not_exist", 1)


def test_not_writable_register(server, dev):
    assert not dev["bykey"]["u1.room_temp"]["writable"]
    with pytest.raises(PermissionError):
        server.validate_write(dev, "u1.room_temp", 21)


def test_read_only_space(server):
    fake = {"bykey": {"x": {"key": "x", "writable": True, "space": "input", "type": "uint16"}}}
    with pytest.raises(PermissionError, match="tylko do odczytu"):
        server.validate_write(fake, "x", 1)


@pytest.mark.parametrize("value", [6, 7, 9])
def test_enum_rejects_value_outside(server, dev, value):
    with pytest.raises(ValueError, match="spoza"):
        server.validate_write(dev, "u1.mode_set", value)


def test_enum_accepts_known_value(server, dev):
    reg, raw = server.validate_write(dev, "u1.mode_set", 2)
    assert raw == 2 and reg["key"] == "u1.mode_set"


@pytest.mark.parametrize("value", [16.5, 0, -5])
def test_below_wmin(server, dev, value):
    with pytest.raises(ValueError, match="minimum"):
        server.validate_write(dev, "u1.setpoint", value)


@pytest.mark.parametrize("value", [30.5, 45])
def test_above_wmax(server, dev, value):
    with pytest.raises(ValueError, match="maksimum"):
        server.validate_write(dev, "u1.setpoint", value)


@pytest.mark.parametrize("value, raw", [(17.0, 170), (22.5, 225), (30.0, 300), ("21", 210)])
def test_setpoint_in_range(server, dev, value, raw):
    _, got = server.validate_write(dev, "u1.setpoint", value)
    assert got == raw


def test_coil_bool(server, dev):
    _, raw = server.validate_write(dev, "u2.onoff", "on")
    assert raw == 1


def test_preview_uses_same_rules(server, dev):
    with pytest.raises(ValueError):
        server.preview_write(dev, "u1.setpoint", 99)
    out = server.preview_write(dev, "u1.setpoint", 22)
    assert out["raw"] == 220 and out["func"] == 0x06
