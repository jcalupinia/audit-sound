#pragma once

// Funciones puras del AutoMix (sin estado ni E/S), probadas en tools/mix_points_test.cpp.
//
// 1) loudEndSec: dónde termina la parte FUERTE de una pista, antes de su decaimiento final.
//    El AutoMix original (Mixxx) termina el fundido en el último sonido (−60 dB), así que mezcla
//    la cola que ya se apaga con la intro suave de la siguiente: el oyente percibe un bajón de
//    5–7 dB (medido en producción el 2026-11-08). Un DJ mezcla antes del decaimiento.
// 2) rampToward: acerca la velocidad de reproducción a un objetivo a un ritmo máximo por segundo,
//    para que la pista entrante vuelva a SU tempo después del fundido sin saltos audibles.

#include <algorithm>
#include <cmath>
#include <vector>

namespace mixpoints {

// rmsDb: nivel de cada segundo de la pista en dBFS (un valor por segundo).
// Referencia = percentil 60 de los segundos con sonido (> −60 dB): el nivel "normal" de la pista.
// Devuelve el final (en segundos) del último tramo cuya media móvil de 2 s está a menos de `dropDb`
// de la referencia. −1 si no hay datos suficientes.
inline double loudEndSec(const std::vector<float>& rmsDb, float dropDb = 6.0f) {
  std::vector<float> on;
  for (float v : rmsDb)
    if (v > -60.0f) on.push_back(v);
  if (on.size() < 8) return -1.0;
  std::vector<float> s = on;
  const size_t k = (size_t)(0.6 * (double)(s.size() - 1));
  std::nth_element(s.begin(), s.begin() + (long)k, s.end());
  const float ref = s[k];
  const float thr = ref - dropDb;
  for (long i = (long)rmsDb.size() - 1; i >= 1; --i) {
    const float avg = 0.5f * (rmsDb[(size_t)i] + rmsDb[(size_t)i - 1]);
    if (avg >= thr) return (double)(i + 1);  // fin del segundo i
  }
  return -1.0;
}

// Mueve `rate` hacia `target` como máximo `perSec` por segundo transcurrido.
inline float rampToward(float rate, float target, double dtSec, float perSec) {
  if (dtSec <= 0.0 || perSec <= 0.0f) return rate;
  const float step = (float)(perSec * dtSec);
  if (std::fabs(target - rate) <= step) return target;
  return rate + (target > rate ? step : -step);
}

}  // namespace mixpoints
