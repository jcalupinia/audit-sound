#pragma once

// Detector de silencio −60 dB (primer/último sonido) + energía RMS (issue M2).
// Umbral −60 dB = 0.001 lineal, el mismo criterio que Mixxx AnalyzerSilence.
// Funciones puras sobre buffers float intercalados estéreo.

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace silence {

constexpr float kThreshold = 0.001f;  // −60 dB

inline int holdSamples(float sampleRate) {
  // Tamaño de la VENTANA de análisis (~2 ms). Se mide el pico dentro de la ventana,
  // no muestras consecutivas por encima del umbral: toda onda cruza el cero (un seno
  // baja de 0.001 en cada cruce), así que exigir N muestras seguidas por encima del
  // umbral NUNCA se cumple para contenido tonal y el archivo se ve "sin silencio".
  // Medir el pico de la ventana evita ese falso negativo (bug detectado en F0).
  return (int)(0.002f * sampleRate);
}

// Primer cuadro con sonido: primera VENTANA de `hold` cuadros cuyo pico supera el
// umbral. Devuelve el inicio de esa ventana, o -1 si no hay sonido.
inline int64_t firstSoundFrame(const float* inter, int64_t frames, int ch, int hold) {
  const int64_t win = hold > 0 ? hold : 1;
  for (int64_t w = 0; w < frames; w += win) {
    const int64_t end = std::min(frames, w + win);
    float peak = 0.0f;
    for (int64_t f = w; f < end; ++f)
      for (int c = 0; c < ch; ++c) peak = std::fmax(peak, std::fabs(inter[f * ch + c]));
    if (peak >= kThreshold) return w;
  }
  return -1;
}

// Último cuadro con sonido: última VENTANA cuyo pico supera el umbral (devuelve su
// último cuadro). -1 si no hay sonido.
inline int64_t lastSoundFrame(const float* inter, int64_t frames, int ch, int hold) {
  const int64_t win = hold > 0 ? hold : 1;
  int64_t last = -1;
  for (int64_t w = 0; w < frames; w += win) {
    const int64_t end = std::min(frames, w + win);
    float peak = 0.0f;
    for (int64_t f = w; f < end; ++f)
      for (int c = 0; c < ch; ++c) peak = std::fmax(peak, std::fabs(inter[f * ch + c]));
    if (peak >= kThreshold) last = end - 1;
  }
  return last;
}

// RMS (0..1) de un buffer intercalado estéreo.
inline float rms(const float* inter, int64_t frames, int ch) {
  if (frames <= 0 || ch <= 0) return 0.0f;
  double acc = 0.0;
  const int64_t n = frames * ch;
  for (int64_t i = 0; i < n; ++i) acc += (double)inter[i] * (double)inter[i];
  return (float)std::sqrt(acc / (double)n);
}

}  // namespace silence
