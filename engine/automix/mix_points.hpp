#pragma once

// Funciones puras del AutoMix (sin estado ni E/S), probadas en tools/mix_points_test.cpp.
//
// 1) loudEndSec: dónde termina la parte FUERTE de una pista, antes de su decaimiento final.
//    El AutoMix original (Mixxx) termina el fundido en el último sonido (−60 dB), así que mezcla
//    la cola que ya se apaga con la intro suave de la siguiente: el oyente percibe un bajón de
//    5–7 dB (medido en producción el 2026-11-08). Un DJ mezcla antes del decaimiento.
// 1b) loudStartSec / introStartSec: dónde EMPIEZA la parte fuerte y desde dónde arrancar la pista
//    entrante. Si abre con una intro suave larga y la saliente termina de golpe, el fundido mezcla
//    la cola con la intro y el oyente oye un hueco (ensayo del 2026-11-08: «Cuban Cigars», 8 s de
//    intro a −25 dB → bajón de 18 dB). Un DJ entra con la entrante ya cerca de su parte fuerte.
// 1c) breakFadeEnd: si la saliente tiene un «break» (corte musical casi en silencio, típico de la
//    bachata y la salsa) DENTRO del fundido, el fundido termina justo donde empieza el break. Si no,
//    el break cae cuando la entrante aún está baja y el oyente oye un bajón (producción, 2026-11-09:
//    «La Bachata Loca → Alentando ilusiones», 7,3 dB; el break de 1,5 s estaba a 2 s del inicio).
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

// Comienzo de la parte fuerte: inicio del primer tramo de 2 s cuya media está a menos de `dropDb`
// de la referencia (la misma de loudEndSec). −1 si no hay datos suficientes.
inline double loudStartSec(const std::vector<float>& rmsDb, float dropDb = 6.0f) {
  std::vector<float> on;
  for (float v : rmsDb)
    if (v > -60.0f) on.push_back(v);
  if (on.size() < 8) return -1.0;
  const size_t k = (size_t)(0.6 * (double)(on.size() - 1));
  std::nth_element(on.begin(), on.begin() + (long)k, on.end());
  const float thr = on[k] - dropDb;
  for (size_t i = 1; i < rmsDb.size(); ++i) {
    const float avg = 0.5f * (rmsDb[i - 1] + rmsDb[i]);
    if (avg >= thr) return (double)(i - 1);
  }
  return -1.0;
}

// Desde dónde arranca la pista entrante: si su intro suave (del primer sonido a la parte fuerte)
// dura más de `lead` s, se adelanta hasta `lead` s antes de la parte fuerte, sin saltar nunca más de
// `maxSkip` s de música. Si no, desde el primer sonido (como siempre).
inline double introStartSec(double first, double loudStart, double lead, double maxSkip) {
  if (loudStart < 0 || maxSkip <= 0) return first;
  const double cand = loudStart - std::max(0.0, lead);
  if (cand <= first) return first;
  return std::min(cand, first + maxSkip);
}

// Fin del fundido con punto de mezcla por energía, LIMITADO: termina 1 s después de la parte fuerte,
// pero nunca más de `maxAdvance` segundos antes del último sonido. Sin el límite, una pista con una
// segunda mitad más tranquila se cortaba a la mitad (producción, 2026-11-08: «Cielos» pasó de 11,6 a
// 5,7 min). Un DJ adelanta la mezcla para no hacerla sobre la cola; no se salta minutos de música.
inline double energyFadeEnd(double loudEnd, double lastSound, double transition, double maxAdvance) {
  if (loudEnd <= transition || lastSound <= 0) return lastSound;
  const double cand = loudEnd + 1.0;
  if (cand >= lastSound) return lastSound;
  return std::max(cand, lastSound - std::max(0.0, maxAdvance));
}

// Nivel de referencia (percentil 60 de los valores con sonido > −60 dB). NAN si hay menos de 8.
inline float levelRefDb(const std::vector<float>& db) {
  std::vector<float> on;
  for (float v : db)
    if (v > -60.0f) on.push_back(v);
  if (on.size() < 8) return NAN;
  const size_t k = (size_t)(0.6 * (double)(on.size() - 1));
  std::nth_element(on.begin(), on.begin() + (long)k, on.end());
  return on[k];
}

// Fin del fundido que evita un break de la saliente. `q`: nivel en dBFS cada `hop` s.
// Un break es un tramo de al menos `minBreak` s a más de `dropDb` bajo la referencia tras el cual la
// música VUELVE antes de `backSec` s (así no se confunde con el final de la pista, que ya resuelve
// energyFadeEnd). Se busca en el tramo del fundido [fadeEnd − transition, fadeEnd − 0,5 s]; si hay
// uno, el fundido termina donde empieza y se vuelve a mirar el nuevo tramo (máximo 4 veces). Nunca
// adelanta el final antes de `minFadeEnd` (el tope de adelanto) ni antes de `transition` s.
inline double breakFadeEnd(const std::vector<float>& q, double hop, double fadeEnd, double transition,
                           double minFadeEnd, float dropDb = 9.0f, double minBreak = 0.75,
                           double backSec = 4.0) {
  if (hop <= 0 || transition <= 0 || q.empty()) return fadeEnd;
  const float ref = levelRefDb(q);
  if (std::isnan(ref)) return fadeEnd;
  const float thr = ref - dropDb;
  const long need = std::max(1L, (long)std::lround(minBreak / hop));
  const long back = (long)std::lround(backSec / hop);
  const long n = (long)q.size();
  for (int it = 0; it < 4; ++it) {
    const long a = std::max(0L, (long)std::floor((fadeEnd - transition) / hop));
    const long b = std::min(n, (long)std::floor((fadeEnd - 0.5) / hop));
    double found = -1.0;
    for (long i = a; i < b;) {
      if (q[(size_t)i] >= thr) { ++i; continue; }
      long j = i;
      while (j < n && q[(size_t)j] < thr) ++j;
      bool returns = false;
      for (long k = j; k < std::min(n, j + back); ++k)
        if (q[(size_t)k] >= thr) { returns = true; break; }
      if (j - i >= need && returns) { found = (double)i * hop; break; }
      i = j;
    }
    if (found < 0 || found < minFadeEnd || found < transition) break;
    fadeEnd = found;
  }
  return fadeEnd;
}

// Mueve `rate` hacia `target` como máximo `perSec` por segundo transcurrido.
inline float rampToward(float rate, float target, double dtSec, float perSec) {
  if (dtSec <= 0.0 || perSec <= 0.0f) return rate;
  const float step = (float)(perSec * dtSec);
  if (std::fabs(target - rate) <= step) return target;
  return rate + (target > rate ? step : -step);
}

}  // namespace mixpoints
