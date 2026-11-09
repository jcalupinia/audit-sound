#pragma once

// Efectos de audio del motor (bancos FX de la consola). Sin E/S: lo prueba tools/fx_test.cpp.
//
// Dos bancos; cada uno aplica UN efecto a un destino: el deck A, el deck B o la salida general
// (antes de la voz en vivo, para que el locutor no salga con eco). Efectos:
//   eco       — repeticiones que se apagan (con amortiguación de agudos, como cinta)
//   delay     — repeticiones que saltan de izquierda a derecha (ping-pong)
//   reverb    — sala (tipo Freeverb: 4 filtros peine + 2 pasa-todo por canal)
//   filtro    — perilla DJ: < 0,5 pasa-bajos, > 0,5 pasa-altos, 0,5 casi neutro
//   flanger   — retardo corto modulado con realimentación
//   phaser    — 4 pasa-todo modulados
//   bitcrush  — menos bits y menos muestras (sonido digital roto)
// «param» (0..1) es el control principal de cada efecto (tiempo, sala, frecuencia, velocidad o
// cantidad). Con «sync» el tiempo/velocidad sigue el BPM del deck. «wet» (0..1) es la mezcla; cambia
// con una rampa de ~10 ms para que no haya chasquidos. Los parámetros se escriben desde el hilo HTTP
// (atómicos) y el hilo de audio nunca se bloquea ni reserva memoria salvo al cambiar la frecuencia.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <vector>

namespace fx {

enum Type { NONE = 0, ECHO, DELAY, REVERB, FILTER, FLANGER, PHASER, CRUSH, TYPE_COUNT };
enum Target { TARGET_A = 0, TARGET_B = 1, TARGET_MASTER = 2 };

inline const char* typeName(int t) {
  static const char* n[] = {"none", "echo", "delay", "reverb", "filter", "flanger", "phaser", "crush"};
  return t >= 0 && t < TYPE_COUNT ? n[t] : "none";
}
inline int typeFromName(const char* s) {
  if (!s) return -1;
  for (int t = 0; t < TYPE_COUNT; ++t)
    if (std::strcmp(s, typeName(t)) == 0) return t;
  return -1;
}
inline const char* targetName(int t) { return t == TARGET_A ? "A" : t == TARGET_B ? "B" : "master"; }
inline int targetFromName(const char* s) {
  if (!s) return -1;
  if (!std::strcmp(s, "A")) return TARGET_A;
  if (!std::strcmp(s, "B")) return TARGET_B;
  if (!std::strcmp(s, "master")) return TARGET_MASTER;
  return -1;
}

// Tiempos musicales de eco/delay con «sync»: fracción de pulso elegida por param.
inline double syncBeats(float param) {
  static const double b[] = {0.25, 0.5, 0.75, 1.0, 1.5, 2.0};
  const int i = std::min(5, std::max(0, (int)std::floor(param * 6.0f)));
  return b[i];
}
// Tiempo del eco/delay en segundos.
inline double echoSeconds(float param, bool sync, float bpm) {
  if (sync && bpm > 40.0f && bpm < 300.0f) return syncBeats(param) * 60.0 / bpm;
  return 0.06 + 0.94 * std::max(0.0f, std::min(1.0f, param));  // 60..1000 ms
}
// Velocidad del LFO (Hz) de flanger/phaser: con sync, un ciclo cada 1..8 pulsos.
inline double lfoHz(float param, bool sync, float bpm) {
  if (sync && bpm > 40.0f && bpm < 300.0f) {
    static const double beats[] = {8, 4, 2, 1};
    const int i = std::min(3, std::max(0, (int)std::floor(param * 4.0f)));
    return bpm / 60.0 / beats[i];
  }
  return 0.05 + 1.95 * std::max(0.0f, std::min(1.0f, param));
}

struct Params {
  std::atomic<int> type{NONE};
  std::atomic<int> target{TARGET_MASTER};
  std::atomic<bool> on{false};
  std::atomic<bool> sync{true};
  std::atomic<float> wet{0.35f};
  std::atomic<float> param{0.5f};
};

class Unit {
 public:
  Params p;

  void setRate(int sr) {
    sr_ = sr > 8000 ? sr : 48000;
    const size_t dl = (size_t)(2.1 * sr_);  // eco/delay hasta 2 s
    dlL_.assign(dl, 0.0f);
    dlR_.assign(dl, 0.0f);
    const double s = sr_ / 44100.0;
    static const int combs[4] = {1116, 1188, 1277, 1356};
    static const int alls[2] = {556, 441};
    for (int i = 0; i < 4; ++i) {
      cL_[i].assign((size_t)(combs[i] * s), 0.0f);
      cR_[i].assign((size_t)((combs[i] + 23) * s), 0.0f);
    }
    for (int i = 0; i < 2; ++i) {
      aL_[i].assign((size_t)(alls[i] * s), 0.0f);
      aR_[i].assign((size_t)((alls[i] + 23) * s), 0.0f);
    }
    flL_.assign((size_t)(0.012 * sr_), 0.0f);
    flR_.assign((size_t)(0.012 * sr_), 0.0f);
    clear();
  }
  int rate() const { return sr_; }

  // Procesa en sitio. bpm: tempo del destino (0 si no se conoce).
  void process(float* l, float* r, int n, float bpm) {
    if (sr_ <= 0) return;
    const int type = p.type.load(std::memory_order_relaxed);
    if (type != lastType_) { clear(); lastType_ = type; }
    const bool on = p.on.load(std::memory_order_relaxed) && type != NONE;
    const float wetT = on ? std::max(0.0f, std::min(1.0f, p.wet.load(std::memory_order_relaxed))) : 0.0f;
    if (!on && wet_ < 1e-4f) { wet_ = 0.0f; return; }  // apagado: sin costo
    const float param = std::max(0.0f, std::min(1.0f, p.param.load(std::memory_order_relaxed)));
    const bool sync = p.sync.load(std::memory_order_relaxed);
    const float ramp = 1.0f - std::exp(-1.0f / (0.01f * (float)sr_));
    switch (type) {
      case ECHO: case DELAY: runDelay(l, r, n, wetT, ramp, echoSeconds(param, sync, bpm), type == DELAY); break;
      case REVERB: runReverb(l, r, n, wetT, ramp, param); break;
      case FILTER: runFilter(l, r, n, wetT, ramp, param); break;
      case FLANGER: runFlanger(l, r, n, wetT, ramp, lfoHz(param, sync, bpm)); break;
      case PHASER: runPhaser(l, r, n, wetT, ramp, lfoHz(param, sync, bpm)); break;
      case CRUSH: runCrush(l, r, n, wetT, ramp, param); break;
      default: break;
    }
  }

  float currentWet() const { return wet_; }

 private:
  int sr_ = 0;
  int lastType_ = NONE;
  float wet_ = 0.0f;
  // eco/delay
  std::vector<float> dlL_, dlR_;
  size_t dlPos_ = 0;
  float dampL_ = 0, dampR_ = 0;
  double dlTime_ = -1;  // tiempo suavizado (s): cambiar el tiempo no salta
  // reverb
  std::vector<float> cL_[4], cR_[4], aL_[2], aR_[2];
  size_t cPosL_[4] = {}, cPosR_[4] = {}, aPosL_[2] = {}, aPosR_[2] = {};
  float cStL_[4] = {}, cStR_[4] = {};
  // filtro (SVF TPT)
  float fIc1L_ = 0, fIc2L_ = 0, fIc1R_ = 0, fIc2R_ = 0, fParam_ = -1;
  // flanger
  std::vector<float> flL_, flR_;
  size_t flPos_ = 0;
  double lfo_ = 0;
  // phaser
  float phL_[4] = {}, phR_[4] = {}, phFbL_ = 0, phFbR_ = 0;
  // bitcrush
  float crHoldL_ = 0, crHoldR_ = 0;
  double crPhase_ = 1.0;

  void clear() {
    std::fill(dlL_.begin(), dlL_.end(), 0.0f);
    std::fill(dlR_.begin(), dlR_.end(), 0.0f);
    dlPos_ = 0; dampL_ = dampR_ = 0; dlTime_ = -1;
    for (int i = 0; i < 4; ++i) {
      std::fill(cL_[i].begin(), cL_[i].end(), 0.0f);
      std::fill(cR_[i].begin(), cR_[i].end(), 0.0f);
      cPosL_[i] = cPosR_[i] = 0; cStL_[i] = cStR_[i] = 0;
    }
    for (int i = 0; i < 2; ++i) {
      std::fill(aL_[i].begin(), aL_[i].end(), 0.0f);
      std::fill(aR_[i].begin(), aR_[i].end(), 0.0f);
      aPosL_[i] = aPosR_[i] = 0;
    }
    fIc1L_ = fIc2L_ = fIc1R_ = fIc2R_ = 0; fParam_ = -1;
    std::fill(flL_.begin(), flL_.end(), 0.0f);
    std::fill(flR_.begin(), flR_.end(), 0.0f);
    flPos_ = 0; lfo_ = 0;
    for (int i = 0; i < 4; ++i) phL_[i] = phR_[i] = 0;
    phFbL_ = phFbR_ = 0; crHoldL_ = crHoldR_ = 0; crPhase_ = 1.0;
  }

  // Rampa de la mezcla; llega exactamente al valor pedido (sin restos de la señal seca o húmeda).
  void stepWet(float wetT, float ramp) {
    wet_ += (wetT - wet_) * ramp;
    if (std::fabs(wetT - wet_) < 5e-4f) wet_ = wetT;  // −66 dB: inaudible
  }

  static float readFrac(const std::vector<float>& b, size_t pos, double delaySamples) {
    const size_t n = b.size();
    double rp = (double)pos - delaySamples;
    while (rp < 0) rp += (double)n;
    const size_t i0 = (size_t)rp % n, i1 = (i0 + 1) % n;
    const float f = (float)(rp - std::floor(rp));
    return b[i0] + (b[i1] - b[i0]) * f;
  }

  // Eco (cinta: realimentación 0,5 con agudos amortiguados) o delay ping-pong (realimentación 0,45).
  void runDelay(float* l, float* r, int n, float wetT, float ramp, double secs, bool pingpong) {
    const size_t N = dlL_.size();
    if (dlTime_ < 0) dlTime_ = secs;
    const double tk = 1.0 - std::exp(-1.0 / (0.05 * sr_));
    const float fb = pingpong ? 0.45f : 0.5f;
    for (int i = 0; i < n; ++i) {
      stepWet(wetT, ramp);
      dlTime_ += (secs - dlTime_) * tk;
      const double d = std::min((double)N - 2, std::max(1.0, dlTime_ * sr_));
      const float yl = readFrac(dlL_, dlPos_, d), yr = readFrac(dlR_, dlPos_, d);
      if (pingpong) {
        dlL_[dlPos_] = l[i] * 0.7f + r[i] * 0.3f + yr * fb;  // la izquierda recibe lo de la derecha
        dlR_[dlPos_] = yl * fb;
      } else {
        dampL_ += (yl - dampL_) * 0.35f;
        dampR_ += (yr - dampR_) * 0.35f;
        dlL_[dlPos_] = l[i] + dampL_ * fb;
        dlR_[dlPos_] = r[i] + dampR_ * fb;
      }
      dlPos_ = (dlPos_ + 1) % N;
      l[i] += yl * wet_;
      r[i] += yr * wet_;
    }
  }

  // Reverb tipo Freeverb.
  void runReverb(float* l, float* r, int n, float wetT, float ramp, float param) {
    const float room = 0.70f + 0.28f * param, damp = 0.35f;
    for (int i = 0; i < n; ++i) {
      stepWet(wetT, ramp);
      const float in = (l[i] + r[i]) * 0.015f;
      float ol = 0, orr = 0;
      for (int c = 0; c < 4; ++c) {
        float& yL = cL_[c][cPosL_[c]];
        cStL_[c] = yL * (1 - damp) + cStL_[c] * damp;
        const float outL = yL;
        yL = in + cStL_[c] * room;
        cPosL_[c] = (cPosL_[c] + 1) % cL_[c].size();
        ol += outL;
        float& yR = cR_[c][cPosR_[c]];
        cStR_[c] = yR * (1 - damp) + cStR_[c] * damp;
        const float outR = yR;
        yR = in + cStR_[c] * room;
        cPosR_[c] = (cPosR_[c] + 1) % cR_[c].size();
        orr += outR;
      }
      for (int a = 0; a < 2; ++a) {
        float& bl = aL_[a][aPosL_[a]];
        const float tl = bl;
        bl = ol + tl * 0.5f;
        ol = tl - ol;
        aPosL_[a] = (aPosL_[a] + 1) % aL_[a].size();
        float& br = aR_[a][aPosR_[a]];
        const float tr = br;
        br = orr + tr * 0.5f;
        orr = tr - orr;
        aPosR_[a] = (aPosR_[a] + 1) % aR_[a].size();
      }
      l[i] += ol * 3.0f * wet_;
      r[i] += orr * 3.0f * wet_;
    }
  }

  // Filtro DJ (SVF Cytomic, resonancia moderada).
  void runFilter(float* l, float* r, int n, float wetT, float ramp, float param) {
    if (fParam_ < 0) fParam_ = param;
    for (int i = 0; i < n; ++i) {
      stepWet(wetT, ramp);
      fParam_ += (param - fParam_) * ramp;
      const bool hp = fParam_ > 0.5f;
      const float x = hp ? (fParam_ - 0.5f) * 2.0f : (0.5f - fParam_) * 2.0f;  // 0 = neutro, 1 = extremo
      const double fc = hp ? 20.0 * std::pow(250.0, x) : 20000.0 * std::pow(0.01, x);  // 20→5000 Hz / 20k→200 Hz
      const double g = std::tan(M_PI * std::min(fc, 0.45 * sr_) / sr_);
      const double k = 1.0 / 0.9;
      const double a1 = 1.0 / (1.0 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      auto tick = [&](float in, float& ic1, float& ic2) {
        const double v3 = in - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = (float)(2 * v1 - ic1);
        ic2 = (float)(2 * v2 - ic2);
        return (float)(hp ? in - k * v1 - v2 : v2);
      };
      const float yl = tick(l[i], fIc1L_, fIc2L_), yr = tick(r[i], fIc1R_, fIc2R_);
      l[i] = l[i] * (1 - wet_) + yl * wet_;
      r[i] = r[i] * (1 - wet_) + yr * wet_;
    }
  }

  void runFlanger(float* l, float* r, int n, float wetT, float ramp, double hz) {
    const size_t N = flL_.size();
    const double inc = 2 * M_PI * hz / sr_;
    for (int i = 0; i < n; ++i) {
      stepWet(wetT, ramp);
      lfo_ += inc;
      if (lfo_ > 2 * M_PI) lfo_ -= 2 * M_PI;
      const double dl = (0.0005 + 0.0045 * 0.5 * (1 + std::sin(lfo_))) * sr_;
      const double dr = (0.0005 + 0.0045 * 0.5 * (1 + std::sin(lfo_ + M_PI / 2))) * sr_;
      const float yl = readFrac(flL_, flPos_, dl), yr = readFrac(flR_, flPos_, dr);
      flL_[flPos_] = l[i] + yl * 0.6f;
      flR_[flPos_] = r[i] + yr * 0.6f;
      flPos_ = (flPos_ + 1) % N;
      l[i] = l[i] * (1 - wet_ * 0.5f) + yl * wet_ * 0.5f;
      r[i] = r[i] * (1 - wet_ * 0.5f) + yr * wet_ * 0.5f;
    }
  }

  void runPhaser(float* l, float* r, int n, float wetT, float ramp, double hz) {
    const double inc = 2 * M_PI * hz / sr_;
    for (int i = 0; i < n; ++i) {
      stepWet(wetT, ramp);
      lfo_ += inc;
      if (lfo_ > 2 * M_PI) lfo_ -= 2 * M_PI;
      const double f = 200.0 * std::pow(10.0, 0.5 * (1 + std::sin(lfo_)));  // 200..2000 Hz
      const double t = std::tan(M_PI * f / sr_);
      const float c = (float)((t - 1) / (t + 1));
      auto chain = [&](float in, float* st, float& fbk) {
        float x = in + fbk * 0.3f;
        for (int s = 0; s < 4; ++s) {
          const float y = c * x + st[s];
          st[s] = x - c * y;
          x = y;
        }
        fbk = x;
        return x;
      };
      const float yl = chain(l[i], phL_, phFbL_), yr = chain(r[i], phR_, phFbR_);
      l[i] = l[i] * (1 - wet_ * 0.5f) + yl * wet_ * 0.5f;
      r[i] = r[i] * (1 - wet_ * 0.5f) + yr * wet_ * 0.5f;
    }
  }

  void runCrush(float* l, float* r, int n, float wetT, float ramp, float param) {
    const float bits = 16.0f - 12.0f * param;            // 16 → 4 bits
    const float q = std::pow(2.0f, bits - 1.0f);
    const double step = 1.0 / (1.0 + 15.0 * param);     // conserva 1 de cada 1..16 muestras
    for (int i = 0; i < n; ++i) {
      stepWet(wetT, ramp);
      crPhase_ += step;
      if (crPhase_ >= 1.0) {
        crPhase_ -= 1.0;
        crHoldL_ = std::round(l[i] * q) / q;
        crHoldR_ = std::round(r[i] * q) / q;
      }
      l[i] = l[i] * (1 - wet_) + crHoldL_ * wet_;
      r[i] = r[i] * (1 - wet_) + crHoldR_ * wet_;
    }
  }
};

class Rack {
 public:
  static constexpr int kBanks = 2;
  Unit bank[kBanks];

  void setRate(int sr) {
    for (auto& u : bank) u.setRate(sr);
    rate_ = sr;
  }
  int rate() const { return rate_; }

  // Aplica los bancos cuyo destino es `target`, en orden (banco 1 y luego 2).
  void process(int target, float* l, float* r, int n, float bpm) {
    for (auto& u : bank)
      if (u.p.target.load(std::memory_order_relaxed) == target) u.process(l, r, n, bpm);
  }

 private:
  int rate_ = 0;
};

}  // namespace fx
