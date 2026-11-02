#pragma once

// OfflineSink: sink portable headless para servidor/pruebas (issue C1).
// Tira del render a ~tiempo real en bloques fijos y descarta el audio, o lo
// vuelca a un archivo PCM (float32 intercalado) si la variable de entorno
// AUDIT_SOUND_PCM_OUT apunta a una ruta. Es el sink de reemplazo de Oboe para
// que el motor corra en Linux; el StreamSink (MP3 -> Icecast) llega en D1/D2.

#include "iaudiosink.hpp"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <thread>
#include <vector>

class OfflineSink : public IAudioSink {
 public:
  OfflineSink() = default;
  ~OfflineSink() override { stop(); }

  int start(IAudioRenderer* renderer) override {
    if (!renderer) return 0;
    renderer_ = renderer;
    running_.store(true);
    thread_ = std::thread([this] { loop(); });
    return sampleRate_;
  }

  void stop() override {
    running_.store(false);
    if (thread_.joinable()) thread_.join();
    if (file_) {
      std::fclose(file_);
      file_ = nullptr;
    }
  }

  int sampleRate() const override { return sampleRate_; }
  int channels() const override { return channels_; }

 private:
  void loop() {
    const int block = 1024;
    std::vector<float> buf(static_cast<size_t>(block) * channels_);
    const char* path = std::getenv("AUDIT_SOUND_PCM_OUT");
    if (path && path[0]) {
      file_ = std::fopen(path, "wb");
    }
    const auto blockDur =
        std::chrono::nanoseconds(static_cast<long long>(1e9 * block / sampleRate_));
    auto next = std::chrono::steady_clock::now();
    while (running_.load()) {
      std::fill(buf.begin(), buf.end(), 0.0f);
      renderer_->renderInterleaved(buf.data(), block, channels_);
      if (file_) {
        std::fwrite(buf.data(), sizeof(float), buf.size(), file_);
      }
      next += blockDur;
      std::this_thread::sleep_until(next);
    }
  }

  IAudioRenderer* renderer_ = nullptr;
  std::atomic<bool> running_{false};
  std::thread thread_;
  std::FILE* file_ = nullptr;
  int sampleRate_ = 48000;
  int channels_ = 2;
};
