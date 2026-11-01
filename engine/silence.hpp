#pragma once

// Detector de silencio −60 dB (primer/último sonido) + energía RMS (issue M2).
// Umbral −60 dB = 0.001 lineal, el mismo criterio que Mixxx AnalyzerSilence.
// Funciones puras sobre buffers float intercalados estéreo.

#include <cmath>
#include <cstdint>

namespace silence {

constexpr float kThreshold = 0.001f;  // −60 dB

inline int holdSamples(float sampleRate) {
  return (int)(0.002f * sampleRate);  // ~2 ms, anti-click (mejora sobre Mixxx)
}

// Índice del primer cuadro cuyo pico supera el umbral sostenido `hold` cuadros.
// -1 si no hay sonido.
inline int64_t firstSoundFrame(const float* inter, int64_t frames, int ch, int hold) {
  int64_t run = 0;
  for (int64_t f = 0; f < frames; ++f) {
    float peak = 0.0f;
    for (int c = 0; c < ch; ++c) peak = std::fmax(peak, std::fabs(inter[f * ch + c]));
    if (peak >= kThreshold) {
      if (++run >= hold) return f - (run - 1);
    } else {
      run = 0;
    }
  }
  return -1;
}

// Índice del último cuadro con sonido sostenido (escaneo hacia atrás). -1 si no hay.
inline int64_t lastSoundFrame(const float* inter, int64_t frames, int ch, int hold) {
  int64_t run = 0;
  for (int64_t f = frames - 1; f >= 0; --f) {
    float peak = 0.0f;
    for (int c = 0; c < ch; ++c) peak = std::fmax(peak, std::fabs(inter[f * ch + c]));
    if (peak >= kThreshold) {
      if (++run >= hold) return f + (run - 1);
    } else {
      run = 0;
    }
  }
  return -1;
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
