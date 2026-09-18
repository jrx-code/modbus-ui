"""Shared write validation for preview and write paths."""

from __future__ import annotations


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


def validate_write(dev: dict, key: str, value) -> tuple[dict, int]:
    """Wspolna walidacja dla preview i write — te same reguly, jeden punkt utrzymania.

    Preview musi odrzucac te same wartosci co zapis; inaczej dialog potwierdzenia
    pokazuje ramke, ktorej POST /api/write potem nie przyjmie.
    """
    reg = dev["bykey"].get(key)
    if reg is None:
        raise ValueError(f"Nieznany rejestr: {key}")
    if not reg.get("writable"):
        raise PermissionError(f"Rejestr {key} nie jest zapisywalny")
    if reg["space"] not in ("coil", "holding"):
        raise PermissionError(f"Przestrzen {reg['space']} jest tylko do odczytu")

    raw = encode_write(reg, value)
    if reg.get("enum") and raw not in reg["enum"]:
        raise ValueError(f"Wartosc {raw} spoza dozwolonych dla {key}")
    if reg.get("wmin") is not None and float(value) < reg["wmin"]:
        raise ValueError(f"Ponizej minimum {reg['wmin']}")
    if reg.get("wmax") is not None and float(value) > reg["wmax"]:
        raise ValueError(f"Powyzej maksimum {reg['wmax']}")
    return reg, raw
