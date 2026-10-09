import pytest
from devices import toshiba

BASE = {"coil": 1, "discrete": 10001, "input": 30001, "holding": 40001}
STRIDE = {"coil": 152, "discrete": 152, "input": 156, "holding": 156}


def by_suffix(n):
    return {r["key"].split(".", 1)[1]: r for r in toshiba.registers_for_unit(n, "")}


@pytest.mark.parametrize("n", [2, 3, 17, 64])
def test_address_stride_per_space(n):
    first, other = by_suffix(1), by_suffix(n)
    assert first.keys() == other.keys()
    for suffix, reg in first.items():
        step = STRIDE[reg["space"]]
        assert other[suffix]["addr"] - reg["addr"] == step * (n - 1), suffix
        assert other[suffix]["number"] - reg["number"] == step * (n - 1), suffix


def test_all_spaces_are_covered():
    assert {r["space"] for r in toshiba.registers_for_unit(1, "")} == set(STRIDE)


@pytest.mark.parametrize("n", [1, 2, 64])
def test_number_matches_wire_address(n):
    # coil = number - 1, discrete = number - 10001, input = number - 30001, holding = number - 40001
    for reg in toshiba.registers_for_unit(n, ""):
        assert reg["number"] - reg["addr"] == BASE[reg["space"]], reg["key"]


def test_no_numeric_unit_key(example_units):
    # "unit" is the unit of measurement; indoor-unit metadata is iu / iu_label (CLAUDE.md, 2026-09-02)
    regs = toshiba.build(example_units + [{"n": 64, "label": ""}])
    assert regs
    for reg in regs:
        if "unit" in reg:
            assert isinstance(reg["unit"], str), reg["key"]
        assert isinstance(reg["iu"], int)


def test_iu_metadata_and_default_label():
    regs = toshiba.registers_for_unit(5, "")
    assert all(r["iu"] == 5 and r["iu_label"] == "Jednostka 5" for r in regs)
    assert all(r["key"].startswith("u5.") for r in regs)


def test_keys_unique_across_units(example_units):
    keys = [r["key"] for r in toshiba.build(example_units)]
    assert len(keys) == len(set(keys))
