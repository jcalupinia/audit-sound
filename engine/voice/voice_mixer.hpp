#pragma once

// Mezclador de voz en vivo (micrófonos del DJ) para el motor. Sin E/S: lo prueba tools/voice_test.cpp.
//
// - La voz llega por la red en bloques de PCM 16 bits mono, a cualquier frecuencia de muestreo, y se
//   remuestrea a la del motor. Un búfer absorbe la irregularidad de la red: la voz empieza a sonar con
//   ~120 ms acumulados y, si se acumula más de `kMaxLatencySec`, se descarta lo más viejo para que el
//   retraso no crezca.
// - Talkover (atenuación de la música mientras se habla): 0 apagado, 1 siempre (botón), 2 automático
//   (la música baja cuando la voz supera −42 dBFS y empieza a volver 600 ms después de que se calla).
// - Un productor (hilo HTTP) y un consumidor (hilo de audio): el productor toma `pushMu`; el consumidor
//   solo lee índices atómicos, nunca bloquea.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <mutex>
#include <vector>

class VoiceMixer {
 public:
  static constexpr double kPrimeSec = 0.12;      // búfer mínimo antes de empezar a sonar
  static constexpr double kMaxLatencySec = 0.8;  // retraso máximo tolerado
  static constexpr float kAutoThresholdDb = -42.0f;
  static constexpr double kHoldSec = 0.6;        // la música vuelve 600 ms después de callar

  explicit VoiceMixer(int engineRate = 48000) { setEngineRate(engineRate); }

  void setEngineRate(int sr) {
    std::lock_guard<std::mutex> lk(pushMu);
    rate_ = sr > 8000 ? sr : 48000;
    ring_.assign((size_t)rate_ * 3, 0.0f);  // 3 s de capacidad
    w_.store(0);
    r_.store(0);
    primed_ = false;
    srcPos_ = 0.0;
    last_ = 0.0f;
  }
  int engineRate() const { return rate_; }

  // Talkover: 0 apagado, 1 siempre, 2 automático. Ganancia de la voz (lineal, 0..4) y
  // atenuación de la música (dB, negativo).
  std::atomic<int> talkover{2};
  std::atomic<float> voiceGain{1.0f};
  std::atomic<float> duckDb{-14.0f};

  // Productor: PCM 16 bits mono a `srcRate`. Devuelve las muestras escritas (ya remuestreadas).
  int push(const int16_t* pcm, int frames, int srcRate) {
    if (!pcm || frames <= 0 || srcRate < 8000 || srcRate > 192000) return 0;
    std::lock_guard<std::mutex> lk(pushMu);
    const size_t cap = ring_.size();
    const double step = (double)srcRate / (double)rate_;  // muestras de origen por muestra de salida
    int written = 0;
    // Remuestreo lineal continuo entre bloques: srcPos_ es la posición en el bloque actual,
    // con last_ como la muestra anterior al bloque (índice -1).
    while (srcPos_ < (double)frames - 1e-9) {
      const int i0 = (int)std::floor(srcPos_);
      const double f = srcPos_ - i0;
      const float a = i0 < 0 ? last_ : pcm[i0] / 32768.0f;
      const float b = i0 + 1 < frames ? pcm[i0 + 1] / 32768.0f : a;
      const float v = (float)(a + (b - a) * f);
      size_t w = w_.load(std::memory_order_relaxed);
      const size_t r = r_.load(std::memory_order_acquire);
      if (w - r >= cap - 1) break;  // lleno (no debería ocurrir: el consumidor recorta el retraso)
      ring_[w % cap] = v;
      w_.store(w + 1, std::memory_order_release);
      ++written;
      srcPos_ += step;
    }
    srcPos_ -= (double)frames;
    last_ = pcm[frames - 1] / 32768.0f;
    received_.fetch_add((uint64_t)written, std::memory_order_relaxed);
    return written;
  }

  // Consumidor (hilo de audio): una muestra de voz por cuadro y la ganancia a aplicar a la música.
  // Mezcla en sitio: l/r son la música; se atenúa y se suma la voz.
  void process(float* l, float* r, int frames) {
    const int mode = talkover.load(std::memory_order_relaxed);
    const float vg = std::max(0.0f, std::min(4.0f, voiceGain.load(std::memory_order_relaxed)));
    const float duckLin = std::pow(10.0f, std::min(0.0f, duckDb.load(std::memory_order_relaxed)) / 20.0f);
    const size_t cap = ring_.size();
    const double attack = 1.0 - std::exp(-1.0 / (0.08 * rate_));   // ~80 ms al bajar
    const double release = 1.0 - std::exp(-1.0 / (0.35 * rate_));  // ~350 ms al volver
    const double envK = 1.0 - std::exp(-1.0 / (0.05 * rate_));     // medidor ~50 ms
    const size_t prime = (size_t)(kPrimeSec * rate_);
    const size_t maxLat = (size_t)(kMaxLatencySec * rate_);
    const int holdFrames = (int)(kHoldSec * rate_);
    const float thrLin = std::pow(10.0f, kAutoThresholdDb / 20.0f);
    for (int i = 0; i < frames; ++i) {
      size_t rd = r_.load(std::memory_order_relaxed);
      const size_t wr = w_.load(std::memory_order_acquire);
      size_t avail = wr - rd;
      if (avail > maxLat) {  // la red se adelantó: descartar lo más viejo
        rd = wr - prime;
        avail = prime;
        ++dropped_;
      }
      if (!primed_ && avail >= prime) primed_ = true;
      float v = 0.0f;
      if (primed_ && avail > 0) {
        v = ring_[rd % cap];
        r_.store(rd + 1, std::memory_order_release);
      } else if (primed_) {
        primed_ = false;  // se vació: esperar a reunir otra vez el búfer mínimo
        ++underruns_;
      } else if (rd != r_.load(std::memory_order_relaxed)) {
        r_.store(rd, std::memory_order_release);
      }
      env_ += (std::fabs(v) - env_) * envK;
      if (env_ > thrLin) holdLeft_ = holdFrames;
      else if (holdLeft_ > 0) --holdLeft_;
      const bool duck = mode == 1 || (mode == 2 && holdLeft_ > 0);
      const double target = duck ? duckLin : 1.0;
      duckGain_ += (target - duckGain_) * (target < duckGain_ ? attack : release);
      const float g = (float)duckGain_;
      l[i] = l[i] * g + v * vg;
      r[i] = r[i] * g + v * vg;
    }
  }

  // Lecturas para /api/status (aproximadas, desde cualquier hilo).
  float levelDb() const { return env_ > 1e-6 ? 20.0f * (float)std::log10(env_) : -120.0f; }
  float musicGain() const { return (float)duckGain_; }
  int bufferedMs() const {
    const size_t a = w_.load() - r_.load();
    return (int)(1000.0 * (double)a / rate_);
  }
  bool active() const { return primed_; }
  uint64_t receivedSamples() const { return received_.load(); }
  uint64_t underruns() const { return underruns_; }
  uint64_t dropped() const { return dropped_; }

 private:
  std::mutex pushMu;
  std::vector<float> ring_;
  std::atomic<size_t> w_{0}, r_{0};
  int rate_ = 48000;
  double srcPos_ = 0.0;
  float last_ = 0.0f;
  std::atomic<uint64_t> received_{0};
  // Estado del consumidor (solo hilo de audio).
  bool primed_ = false;
  double env_ = 0.0;
  int holdLeft_ = 0;
  double duckGain_ = 1.0;
  uint64_t underruns_ = 0, dropped_ = 0;
};
