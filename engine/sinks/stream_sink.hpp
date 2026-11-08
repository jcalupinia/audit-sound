#pragma once

// StreamSink (issues D1/D2): sink que toma el render del motor, lo codifica a MP3
// (Mp3Encoder) y lo entrega a un IByteSink (archivo en D1; Icecast en D2).
// Es el sink del servidor en la arquitectura Opción B.

#include "iaudiosink.hpp"
#include "byte_sink.hpp"
#include "mp3_encoder.hpp"
#include "platform_log.hpp"

#include <atomic>
#include <chrono>
#include <memory>
#include <thread>
#include <vector>

class StreamSink : public IAudioSink {
 public:
  explicit StreamSink(std::unique_ptr<IByteSink> out, int kbps = 192)
      : out_(std::move(out)), kbps_(kbps) {}
  ~StreamSink() override { stop(); }

  int start(IAudioRenderer* renderer) override {
    if (!renderer || !out_) return 0;
    if (!out_->open()) {
      LOGE("StreamSink: no se pudo abrir el destino de bytes");
      return 0;
    }
    if (!encoder_.init(sampleRate_, channels_, kbps_)) {
      out_->close();
      return 0;
    }
    renderer_ = renderer;
    running_.store(true);
    thread_ = std::thread([this] { loop(); });
    LOGI("StreamSink arrancado: MP3 %d kbps, sr=%d ch=%d", kbps_, sampleRate_, channels_);
    return sampleRate_;
  }

  void stop() override {
    if (!running_.exchange(false) && !thread_.joinable()) return;
    if (thread_.joinable()) thread_.join();
    // Vaciar el encoder y cerrar el destino.
    std::vector<unsigned char> tail;
    encoder_.flush(tail);
    if (!tail.empty() && out_) out_->write(tail.data(), tail.size());
    encoder_.close();
    if (out_) out_->close();
  }

  void setTitle(const std::string& t) override {
    if (out_) out_->setTitle(t);
  }

  int sampleRate() const override { return sampleRate_; }
  int channels() const override { return channels_; }

 private:
  void loop() {
    const int block = 1152;  // múltiplo del frame MP3
    std::vector<float> pcm(static_cast<size_t>(block) * channels_);
    std::vector<unsigned char> mp3;
    const auto blockDur =
        std::chrono::nanoseconds(static_cast<long long>(1e9 * block / sampleRate_));
    auto next = std::chrono::steady_clock::now();
    while (running_.load()) {
      std::fill(pcm.begin(), pcm.end(), 0.0f);
      renderer_->renderInterleaved(pcm.data(), block, channels_);
      encoder_.encode(pcm.data(), block, mp3);
      if (!mp3.empty() && out_) out_->write(mp3.data(), mp3.size());
      next += blockDur;
      std::this_thread::sleep_until(next);
    }
  }

  std::unique_ptr<IByteSink> out_;
  Mp3Encoder encoder_;
  IAudioRenderer* renderer_ = nullptr;
  std::atomic<bool> running_{false};
  std::thread thread_;
  int sampleRate_ = 48000;
  int channels_ = 2;
  int kbps_ = 192;
};
