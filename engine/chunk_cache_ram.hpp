#pragma once

// Cache de decodificación para WebAssembly (navegador): SIN hilos. En el navegador
// no se puede crear un std::thread desde el hilo que instancia el runtime sin caer
// en "unwind" (Atomics.wait prohibido), así que aquí se decodifica la pista COMPLETA
// a RAM (PCM nativo interleaved estéreo) en open() y se sirve por interpolación
// lineal en readRun() —exactamente la misma que la ruta de servidor/Android—. Es el
// patrón estándar de las apps de DJ en web: la pista ya viaja en memoria.
//
// Expone la MISMA interfaz pública que la ChunkCache con hilos (open/stop/readRun/
// hintEngineFrames/hintEngineSpans/jumpTo/setHotFrame/waitChunk/engineFrames y
// ChunkCache::Span / kChunkFrames), para que dj_engine.cpp no distinga cuál usa.

#include "streaming_decoder.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

struct ChunkCache {
  static constexpr int kChunkFrames = 8192;  // solo para los Span que arma el motor

  struct Span {
    int64_t start = 0;
    int64_t count = 0;
  };

  ChunkCache() = default;
  ChunkCache(const ChunkCache&) = delete;
  ChunkCache& operator=(const ChunkCache&) = delete;
  ~ChunkCache() { stop(); }

  // Decodifica la pista entera a RAM (interleaved estéreo, tasa nativa).
  bool open(const char* path, int engineSr) {
    stop();
    if (!path || engineSr < 1) return false;
    StreamingDecoder dec;
    if (!dec.open(path)) return false;
    if (dec.sampleRate < 1 || dec.channels < 1) return false;

    engineSr_ = engineSr;
    nativeSr_ = (int)dec.sampleRate;

    const uint64_t total = dec.totalFrames;
    std::vector<float> pcm;
    if (total > 0) pcm.reserve((size_t)total * 2);

    // Lee en bloques; readStereo siempre entrega interleaved estéreo.
    constexpr uint64_t kBlock = 16384;
    std::vector<float> buf((size_t)kBlock * 2);
    dec.seek(0);
    uint64_t frames = 0;
    for (;;) {
      const uint64_t got = dec.readStereo(buf.data(), kBlock);
      if (got == 0) break;
      pcm.insert(pcm.end(), buf.begin(), buf.begin() + (size_t)got * 2);
      frames += got;
      if (total > 0 && frames >= total) break;
    }
    dec.close();
    if (frames < 1) return false;

    data_ = std::move(pcm);
    nativeFrames_ = (int64_t)frames;
    lastL_ = lastR_ = 0.0f;
    return engineFrames() > 0;
  }

  void stop() {
    data_.clear();
    data_.shrink_to_fit();
    nativeFrames_ = 0;
    nativeSr_ = 0;
  }

  // Longitud en cuadros del motor (tasa de salida).
  int64_t engineFrames() const {
    if (nativeFrames_ <= 0 || nativeSr_ < 1 || engineSr_ < 1) return 0;
    return (int64_t)((double)nativeFrames_ * (double)engineSr_ / (double)nativeSr_);
  }

  // En RAM todo está presente: estos no hacen nada.
  void hintEngineFrames(int64_t, int64_t, bool = false) {}
  void hintEngineSpans(const Span*, int, bool = false) {}
  void jumpTo(int64_t) {}
  void setHotFrame(int64_t) {}
  bool waitChunk(int, int) const { return nativeFrames_ > 0; }

  // Corre n cuadros desde la posición `pos` (en cuadros del motor), avanzando `step`
  // por muestra. Interpola linealmente sobre el PCM nativo —idéntico a la ruta con
  // hilos, pero sin fallos ni rampa porque el audio siempre está en memoria.
  void readRun(double pos, double step, float* L, float* R, int n, bool = false) {
    const int64_t total = nativeFrames_;
    const double ratio = nativeRatio();
    for (int k = 0; k < n; ++k) {
      const double p = (pos + (double)k * step) * ratio;
      if (total < 2 || p < 0.0 || p >= (double)total - 1.0) {
        L[k] = R[k] = 0.0f;
        continue;
      }
      const int64_t i0 = (int64_t)p;
      const float l0 = data_[(size_t)i0 * 2];
      const float r0 = data_[(size_t)i0 * 2 + 1];
      const float l1 = data_[(size_t)(i0 + 1) * 2];
      const float r1 = data_[(size_t)(i0 + 1) * 2 + 1];
      const float frac = (float)(p - (double)i0);
      L[k] = l0 * (1.0f - frac) + l1 * frac;
      R[k] = r0 * (1.0f - frac) + r1 * frac;
    }
    lastL_ = L[n > 0 ? n - 1 : 0];
    lastR_ = R[n > 0 ? n - 1 : 0];
  }

 private:
  double nativeRatio() const {
    if (nativeSr_ < 1 || engineSr_ < 1) return 1.0;
    return (double)nativeSr_ / (double)engineSr_;
  }

  std::vector<float> data_;     // PCM nativo interleaved estéreo
  int64_t nativeFrames_ = 0;
  int nativeSr_ = 0;
  int engineSr_ = 0;
  float lastL_ = 0.0f, lastR_ = 0.0f;
};
