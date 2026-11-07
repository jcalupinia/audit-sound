"""Teoría musical compartida: rueda Camelot y compatibilidad (misma convención que el motor).

Codificación de tonalidad del motor (engine/analyze.hpp:13): 0..11 mayor, 12..23 menor, -1 desconocida.
Port directo de web/pro/copilot.js (camelot, keysCompatible).
"""

from __future__ import annotations

_MAJ = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]


def valid_key(key: int | None) -> bool:
    return key is not None and 0 <= key <= 23


def cam_num(key: int) -> int:
    return _MAJ[key] if key <= 11 else _MAJ[((key - 12) + 3) % 12]


def camelot(key: int | None) -> str:
    if not valid_key(key):
        return "—"
    assert key is not None
    return f"{_MAJ[key]}B" if key <= 11 else f"{_MAJ[((key - 12) + 3) % 12]}A"


def keys_compatible(a: int | None, b: int | None) -> bool:
    if not valid_key(a) or not valid_key(b):
        return False
    assert a is not None and b is not None
    na, nb = cam_num(a), cam_num(b)
    if na == nb:
        return True
    dn = abs(na - nb)
    return (a > 11) == (b > 11) and dn in (1, 11)


def bpm_close(a: float | None, b: float | None, tolerance_pct: float = 8.0) -> bool:
    if not a or not b:
        return False
    return abs(a - b) / a * 100.0 <= tolerance_pct
