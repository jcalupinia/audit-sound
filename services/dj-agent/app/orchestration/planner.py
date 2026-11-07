"""Planificador musical DETERMINISTA.

Solo usa pistas del catálogo que entrega el motor (IDs verificados): nunca inventa títulos.
Puntuación (misma lógica que el copiloto/selector): armonía Camelot 0.45, tempo 0.30,
energía 0.25 hacia un objetivo que sube, baja o se mantiene. Sin metadatos (motor actual,
brecha B1) el plan se degrada: no filtra por género ni compatibilidad y lo declara con
confianza baja.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from app.adapters.engine_base import Track
from app.domain.music import cam_num, camelot, keys_compatible, valid_key
from app.orchestration.intent import normalize

W_HARMONY, W_TEMPO, W_ENERGY = 0.45, 0.30, 0.25
BPM_TOL = 8.0
ENERGY_STEP = {"up": 0.05, "down": -0.05, "steady": 0.0}


@dataclass
class PlanItem:
    position: int
    track_id: int
    title: str
    genre: str | None
    bpm: float | None
    key: int | None
    camelot: str
    energy: float | None
    segment: int
    reason: str
    confidence: float

    def to_dict(self) -> dict:
        return asdict(self)


def _score(prev: Track | None, cand: Track, target_energy: float | None) -> tuple[float, str]:
    if prev is None or not prev.has_metadata or not cand.has_metadata:
        return 0.5, "inicio del bloque"
    if keys_compatible(prev.key, cand.key):
        h, hr = 1.0, "tono compatible"
    elif valid_key(prev.key) and valid_key(cand.key) and cam_num(prev.key) == cam_num(cand.key):  # type: ignore[arg-type]
        h, hr = 0.5, "tono relativo"
    else:
        h, hr = 0.15, "tono a revisar"
    d_bpm = (cand.bpm or 0) - (prev.bpm or 0)
    t = max(0.0, 1 - abs(d_bpm) / BPM_TOL)
    tr = "mismo BPM" if abs(d_bpm) < 1 else f"Δ{abs(d_bpm):.0f} BPM"
    goal = target_energy if target_energy is not None else (prev.energy or 0)
    e = max(0.0, 1 - abs((cand.energy or 0) - goal) / 0.5)
    return W_HARMONY * h + W_TEMPO * t + W_ENERGY * e, f"{hr} · {tr}"


def _genre_pool(catalog: list[Track], genre: str | None) -> list[Track]:
    if not genre:
        return list(catalog)
    g = normalize(genre)
    return [t for t in catalog if t.genre and normalize(t.genre) == g]


def build_plan(catalog: list[Track], *, current: Track | None = None, segments: list[dict] | None = None,
               genre: str | None = None, count: int = 8, energy_trend: str = "steady",
               history_ids: list[int] | None = None, no_repeat: bool = True,
               avg_track_minutes: float = 3.0) -> tuple[list[PlanItem], list[str]]:
    warnings: list[str] = []
    if not catalog:
        return [], ["catalogo_vacio"]
    has_meta = all(t.has_metadata for t in catalog)
    if not has_meta:
        warnings.append("metadatos_no_disponibles_B1: plan sin filtro de género ni compatibilidad (confianza baja)")
    segs = segments or [{"genre": genre, "minutes": None}]
    # "No repetir" mira las pistas recientes, pero nunca más de la mitad del catálogo: con un
    # catálogo pequeño, una ventana fija dejaría al agente sin candidatas.
    window = max(1, len(catalog) // 2)
    used: set[int] = set((history_ids or [])[-window:]) if no_repeat else set()
    items: list[PlanItem] = []
    prev = current
    target = current.energy if current and current.energy is not None else None
    step = ENERGY_STEP.get(energy_trend, 0.0)

    for si, seg in enumerate(segs):
        n = count if not seg.get("minutes") else max(1, round(seg["minutes"] / avg_track_minutes))
        if len(segs) > 1 and not seg.get("minutes"):
            n = max(1, count // len(segs))
        pool = _genre_pool(catalog, seg.get("genre")) if has_meta else list(catalog)
        if has_meta and seg.get("genre") and not pool:
            warnings.append(f"genero_sin_pistas_en_catalogo:{seg['genre']}")
            continue
        for _ in range(n):
            cands = [t for t in pool if t.id not in used]
            if not cands:
                warnings.append(f"pistas_agotadas_en_bloque:{seg.get('genre') or 'general'}")
                break
            if target is not None:
                target = max(0.0, min(1.0, target + step))
            if has_meta:
                scored = sorted(((*_score(prev, c, target), c) for c in cands), key=lambda x: (-x[0], x[2].id))
                score, reason, best = scored[0]
                confidence = round(score, 3)
            else:
                best, reason, confidence = cands[0], "sin metadatos: orden del catálogo", 0.2
            items.append(PlanItem(position=len(items), track_id=best.id, title=best.title, genre=best.genre,
                                  bpm=best.bpm, key=best.key, camelot=camelot(best.key), energy=best.energy,
                                  segment=si, reason=reason, confidence=confidence))
            used.add(best.id)
            prev = best
            if target is None and best.energy is not None:
                target = best.energy
    return items, warnings
