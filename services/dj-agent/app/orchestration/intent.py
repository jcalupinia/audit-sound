"""Intérprete DETERMINISTA de instrucciones en español (ADR-008).

Convierte texto libre en una intención tipada. No decide si se ejecuta: eso lo hace
la política (modo + rol + autonomía). El texto del usuario nunca se trata como código.
Si ninguna regla aplica → UNKNOWN (en Fase 3 el router podrá consultar a Qwen).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Literal

from pydantic import BaseModel, Field

IntentName = Literal["SKIP_TRACK", "SET_TRANSITION", "CHANGE_MODE", "CHANGE_GENRE", "REQUEST_PLAN",
                     "SET_ENERGY", "SET_NO_REPEAT", "PAUSE", "RESUME", "STATUS", "UNKNOWN"]


class Intent(BaseModel):
    intent: IntentName
    parameters: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0.0, le=1.0)


GENRES: dict[str, list[str]] = {
    "deep house": ["deep house", "deep"],
    "house": ["house", "electronica", "electronic", "dance"],
    "techno": ["techno", "tecno"],
    "salsa": ["salsa"],
    "reggaeton": ["reggaeton", "regueton", "reguetón", "reggaetón", "perreo", "urbano"],
    "lounge": ["lounge", "chill", "chillout", "relajada", "ambiental"],   # «ambiente» no: «el ambiente está muerto»
    "pop": ["pop"],
    "cumbia": ["cumbia"],
    "bachata": ["bachata"],
    "merengue": ["merengue"],
}


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip()


def _genre_spans(t: str) -> list[tuple[int, int, str]]:
    """(inicio, fin, género) de la primera mención de cada género, en orden de aparición."""
    spans: list[tuple[int, int, str]] = []
    taken: list[tuple[int, int]] = []
    for genre, words in GENRES.items():
        for w in sorted(words, key=len, reverse=True):
            for m in re.finditer(rf"\b{re.escape(normalize(w))}\b", t):
                if any(a <= m.start() < b for a, b in taken):
                    continue
                taken.append((m.start(), m.end()))
                spans.append((m.start(), m.end(), genre))
    first: dict[str, tuple[int, int, str]] = {}
    for s in sorted(spans):
        first.setdefault(s[2], s)
    return sorted(first.values())


def _segment_minutes(t: str, spans: list[tuple[int, int, str]], i: int) -> int | None:
    """Minutos del segmento i: «salsa 30 minutos» (después, hasta el siguiente género) o
    «30 minutos de salsa» (justo antes)."""
    start, end, _ = spans[i]
    nxt = spans[i + 1][0] if i + 1 < len(spans) else len(t)
    m = re.search(r"(\d{1,3})\s*(min|minuto|minutos|h|hora|horas)\b", t[end:nxt])
    if m is None:
        m = re.search(r"(\d{1,3})\s*(min|minuto|minutos|h|hora|horas)\s+de\s+(musica\s+)?$", t[:start])
    if m is None:
        return 30 if re.search(r"\bmedia hora\b", t[end:nxt]) else None
    n = int(m.group(1))
    return n * 60 if m.group(2).startswith("h") else n


def _find_genres(t: str) -> list[tuple[int, str]]:
    """Géneros mencionados, en orden de aparición (sin duplicados)."""
    found: list[tuple[int, str]] = []
    taken: list[tuple[int, int]] = []
    for genre, words in GENRES.items():
        for w in sorted(words, key=len, reverse=True):
            for m in re.finditer(rf"\b{re.escape(normalize(w))}\b", t):
                if any(a <= m.start() < b for a, b in taken):
                    continue
                taken.append((m.start(), m.end()))
                found.append((m.start(), genre))
    seen, ordered = set(), []
    for _, g in sorted(found):
        if g not in seen:
            seen.add(g)
            ordered.append((len(ordered), g))
    return ordered


def _minutes_after(t: str, start: int = 0) -> int | None:
    m = re.search(r"(\d{1,3})\s*(min|minuto|minutos|h|hora|horas)\b", t[start:])
    if not m:
        if re.search(r"\b(media hora)\b", t[start:]):
            return 30
        if re.search(r"\b(una hora)\b", t[start:]):
            return 60
        return None
    n = int(m.group(1))
    return n * 60 if m.group(2).startswith("h") else n


def _energy_trend(t: str) -> str | None:
    if re.search(r"\b(sube|subir|subiendo|aumenta|aumentar|aumentando|mas)\b.{0,12}\benergia\b|\bque suba\b|\bmas movid|\bprend", t):
        return "up"
    if re.search(r"\b(baja|bajar|bajando|menos|reduce|reduciendo)\b.{0,12}\benergia\b|\bmas tranquil|\brelaj|\bmas suave", t):
        return "down"
    return None


def parse_intent(text: str) -> Intent:
    t = normalize(text)
    if not t:
        return Intent(intent="UNKNOWN", confidence=0.0)

    if re.search(r"\bque (esta )?(sonando|suena)\b|\bestado de la sesion\b|\bque cancion es\b"
                 r"|\bcomo se llama (este|esta|el|la) (tema|cancion|pista)\b|\bque (tema|pista) es\b", t):
        return Intent(intent="STATUS", confidence=0.9)

    mode = None
    if re.search(r"\bmodo (automatico|auto)\b|\bponte en (automatico|auto)\b|\btoma (tu )?el control\b|\b24/?7\b", t):
        mode = "AUTOMATICO"
    elif re.search(r"\bmodo hibrido\b|\bmodo mixto\b|\bsolo (sugiere|propon)"
                   r"|\bpropon\w*\b.{0,30}\bno (las|lo|los) (hagas|ejecutes)\b|\bpideme (permiso|aprobacion)\b", t):
        mode = "HIBRIDO"
    elif re.search(r"\bmodo manual\b|\byo controlo\b|\bdejame (a mi|el control)\b|\bcontrol manual\b", t):
        mode = "MANUAL"
    if mode:
        return Intent(intent="CHANGE_MODE", parameters={"mode": mode}, confidence=0.92)

    if re.search(r"\b(pausa|pausar|pausala|deten|detener|para la musica|parar la musica|silencio total)\b", t):
        return Intent(intent="PAUSE", confidence=0.88)
    if re.search(r"\b(reanuda|reanudar|continua la musica|vuelve a sonar|play)\b", t):
        return Intent(intent="RESUME", confidence=0.85)

    if re.search(r"\b(no repitas|no repetir|evita repetir|evita (las )?repetidas|sin repetir|nada repetido)\b", t):
        return Intent(intent="SET_NO_REPEAT", parameters={"enabled": True}, confidence=0.9)

    m = re.search(r"\btransicion(?:es)?\b.{0,20}?\b(\d{1,2})\s*(s|seg|segundos)\b", t)
    if m:
        return Intent(intent="SET_TRANSITION", parameters={"seconds": float(m.group(1))}, confidence=0.9)
    if re.search(r"\btransicion(?:es)? mas (larga|largas|lenta|lentas|suave|suaves)\b", t):
        return Intent(intent="SET_TRANSITION", parameters={"delta": 4.0}, confidence=0.8)
    if re.search(r"\btransicion(?:es)? mas (corta|cortas|rapida|rapidas)\b", t):
        return Intent(intent="SET_TRANSITION", parameters={"delta": -4.0}, confidence=0.8)

    if re.search(r"\b(salta|saltala|siguiente|skip|next|pasa (a )?la (otra|siguiente)|cambia (de )?(cancion|tema|pista)|otra cancion)\b", t):
        return Intent(intent="SKIP_TRACK", confidence=0.9)

    genres = [g for _, g in _find_genres(t)]
    trend = _energy_trend(t)
    plan_words = re.search(r"\b(planifica|plan de|arma(me)? (un )?set|programa(me)?|sesion de|durante|luego|despues|primero)\b", t)

    if len(genres) >= 2 or (genres and plan_words and re.search(r"\b(luego|despues|primero)\b", t)):
        spans = _genre_spans(t)
        segments = [{"genre": g, "minutes": _segment_minutes(t, spans, i)} for i, (_, _, g) in enumerate(spans)]
        return Intent(intent="REQUEST_PLAN", parameters={"segments": segments, "energy_trend": trend or "steady"},
                      confidence=0.8)

    if genres:
        return Intent(intent="CHANGE_GENRE",
                      parameters={"genre": genres[0], "duration_minutes": _minutes_after(t),
                                  "energy_trend": trend or "steady"}, confidence=0.88)

    if plan_words and re.search(r"\b(sesion|set|plan)\b", t):
        return Intent(intent="REQUEST_PLAN",
                      parameters={"segments": [], "duration_minutes": _minutes_after(t), "energy_trend": trend or "steady"},
                      confidence=0.75)

    if trend:
        return Intent(intent="SET_ENERGY", parameters={"trend": trend}, confidence=0.85)

    return Intent(intent="UNKNOWN", confidence=0.0)
