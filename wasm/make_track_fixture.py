#!/usr/bin/env python3
"""Genera un WAV de prueba para la autoprueba WASM (target `audit_selftest`).

Motivo (Etapa A / A1): el target `audit_selftest` hacía
`--preload-file track.wav`, pero `wasm/track.wav` no está versionado (es un
binario). Sin él, `cmake --build wasm/build` fallaba por completo aunque el
motor real (`audit_engine`) sí compilaba. En vez de versionar un binario, este
script (solo biblioteca estándar) sintetiza un WAV mínimo y válido en tiempo de
configuración de CMake, de modo que el build completo sea autosuficiente y
reproducible.

Uso:  python3 make_track_fixture.py <salida.wav> [segundos] [hz] [sample_rate]
Por defecto: 1.0 s, 440 Hz, 44100 Hz, PCM 16-bit mono.
"""
import math
import struct
import sys
import wave


def main() -> int:
    out = sys.argv[1] if len(sys.argv) > 1 else "track.wav"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    freq = float(sys.argv[3]) if len(sys.argv) > 3 else 440.0
    rate = int(sys.argv[4]) if len(sys.argv) > 4 else 44100

    n = max(1, int(seconds * rate))
    amp = 12000  # ~0.37 de fondo de escala; evita clipping
    frames = bytearray()
    for i in range(n):
        s = int(amp * math.sin(2.0 * math.pi * freq * i / rate))
        frames += struct.pack("<h", s)

    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return 0


if __name__ == "__main__":
    sys.exit(main())
