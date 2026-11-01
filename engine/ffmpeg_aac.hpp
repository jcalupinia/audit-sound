#pragma once

// Decodificador AAC / ALAC / M4A / MP4 para el servidor (Linux/Apple) vía FFmpeg
// (libavcodec/libavformat/libswresample, LGPL). Reemplaza a MediaCodec de Android.
// Expone la MISMA superficie que MediaCodecAacDecoder: open/close/tell/seek/
// readStereo + channels/sampleRate/totalFrames. Entrega PCM float intercalado
// estéreo al sample rate original del archivo.

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>
}

#include <cstdint>
#include <vector>

#include "last_error.hpp"

struct FfmpegAacDecoder {
  unsigned channels = 0;
  unsigned sampleRate = 0;
  uint64_t totalFrames = 0;

  FfmpegAacDecoder() = default;
  FfmpegAacDecoder(const FfmpegAacDecoder&) = delete;
  FfmpegAacDecoder& operator=(const FfmpegAacDecoder&) = delete;
  ~FfmpegAacDecoder() { close(); }

  bool open(const char* path) {
    close();
    if (avformat_open_input(&fmt_, path, nullptr, nullptr) < 0) {
      djSetLastError("FFmpeg: no se pudo abrir el archivo.");
      return false;
    }
    if (avformat_find_stream_info(fmt_, nullptr) < 0) {
      djSetLastError("FFmpeg: sin información de streams.");
      close();
      return false;
    }
    streamIndex_ = av_find_best_stream(fmt_, AVMEDIA_TYPE_AUDIO, -1, -1, nullptr, 0);
    if (streamIndex_ < 0) {
      djSetLastError("FFmpeg: sin pista de audio.");
      close();
      return false;
    }
    AVStream* st = fmt_->streams[streamIndex_];
    const AVCodec* dec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!dec) {
      djSetLastError("FFmpeg: códec no soportado.");
      close();
      return false;
    }
    ctx_ = avcodec_alloc_context3(dec);
    if (!ctx_ || avcodec_parameters_to_context(ctx_, st->codecpar) < 0 ||
        avcodec_open2(ctx_, dec, nullptr) < 0) {
      djSetLastError("FFmpeg: no se pudo abrir el decodificador.");
      close();
      return false;
    }

    sampleRate = ctx_->sample_rate;
    channels = 2;  // salida siempre estéreo (como el decoder de Android)

    // Resampler: lo que entregue el códec -> float intercalado estéreo, mismo SR.
    AVChannelLayout outLayout = AV_CHANNEL_LAYOUT_STEREO;
    AVChannelLayout inLayout = ctx_->ch_layout;
    if (inLayout.nb_channels <= 0) {
      av_channel_layout_default(&inLayout, 2);
    }
    if (swr_alloc_set_opts2(&swr_, &outLayout, AV_SAMPLE_FMT_FLT, (int)sampleRate, &inLayout,
                            ctx_->sample_fmt, ctx_->sample_rate, 0, nullptr) < 0 ||
        swr_init(swr_) < 0) {
      djSetLastError("FFmpeg: no se pudo inicializar el resampler.");
      close();
      return false;
    }

    // Duración total -> cuadros. Preferir la del stream; si no, la del contenedor.
    double seconds = 0.0;
    if (st->duration != AV_NOPTS_VALUE && st->duration > 0) {
      seconds = (double)st->duration * av_q2d(st->time_base);
    } else if (fmt_->duration != AV_NOPTS_VALUE && fmt_->duration > 0) {
      seconds = (double)fmt_->duration / (double)AV_TIME_BASE;
    }
    totalFrames = (uint64_t)(seconds * (double)sampleRate);

    frame_ = av_frame_alloc();
    pkt_ = av_packet_alloc();
    cursor_ = 0;
    buf_.clear();
    bufPos_ = 0;
    eof_ = false;
    return frame_ && pkt_;
  }

  uint64_t tell() const { return cursor_; }

  bool seek(uint64_t frame) {
    if (!fmt_ || sampleRate == 0) return false;
    AVStream* st = fmt_->streams[streamIndex_];
    const int64_t ts =
        (int64_t)((double)frame / (double)sampleRate / av_q2d(st->time_base));
    if (av_seek_frame(fmt_, streamIndex_, ts, AVSEEK_FLAG_BACKWARD) < 0) {
      return false;
    }
    avcodec_flush_buffers(ctx_);
    buf_.clear();
    bufPos_ = 0;
    eof_ = false;
    cursor_ = frame;
    return true;
  }

  // Intercalado estéreo; devuelve cuadros leídos (0 = fin).
  uint64_t readStereo(float* out, uint64_t frames) {
    if (!fmt_ || frames == 0) return 0;
    uint64_t produced = 0;
    while (produced < frames) {
      if (bufPos_ >= buf_.size()) {
        if (!decodeMore()) break;  // EOF
        if (buf_.empty()) continue;
      }
      const uint64_t availFrames = (buf_.size() - bufPos_) / 2;
      const uint64_t want = frames - produced;
      const uint64_t take = want < availFrames ? want : availFrames;
      std::copy(buf_.begin() + bufPos_, buf_.begin() + bufPos_ + take * 2,
                out + produced * 2);
      bufPos_ += take * 2;
      produced += take;
    }
    cursor_ += produced;
    return produced;
  }

  void close() {
    if (swr_) swr_free(&swr_);
    if (frame_) av_frame_free(&frame_);
    if (pkt_) av_packet_free(&pkt_);
    if (ctx_) avcodec_free_context(&ctx_);
    if (fmt_) avformat_close_input(&fmt_);
    channels = sampleRate = 0;
    totalFrames = cursor_ = 0;
    buf_.clear();
    bufPos_ = 0;
    streamIndex_ = -1;
    eof_ = false;
  }

 private:
  // Decodifica hasta tener muestras en buf_, o marca EOF. Devuelve false en EOF seco.
  bool decodeMore() {
    buf_.clear();
    bufPos_ = 0;
    while (buf_.empty()) {
      if (eof_) return drain();
      const int rr = av_read_frame(fmt_, pkt_);
      if (rr < 0) {
        eof_ = true;
        avcodec_send_packet(ctx_, nullptr);  // iniciar drenaje
        continue;
      }
      if (pkt_->stream_index != streamIndex_) {
        av_packet_unref(pkt_);
        continue;
      }
      avcodec_send_packet(ctx_, pkt_);
      av_packet_unref(pkt_);
      receiveAll();
    }
    return true;
  }

  bool drain() {
    receiveAll();
    return !buf_.empty();
  }

  void receiveAll() {
    while (avcodec_receive_frame(ctx_, frame_) == 0) {
      const int maxOut = swr_get_out_samples(swr_, frame_->nb_samples);
      const size_t base = buf_.size();
      buf_.resize(base + (size_t)maxOut * 2);
      uint8_t* outPtr = reinterpret_cast<uint8_t*>(buf_.data() + base);
      const int got = swr_convert(swr_, &outPtr, maxOut,
                                  (const uint8_t**)frame_->extended_data, frame_->nb_samples);
      buf_.resize(base + (size_t)(got > 0 ? got : 0) * 2);
      av_frame_unref(frame_);
    }
  }

  AVFormatContext* fmt_ = nullptr;
  AVCodecContext* ctx_ = nullptr;
  SwrContext* swr_ = nullptr;
  AVFrame* frame_ = nullptr;
  AVPacket* pkt_ = nullptr;
  int streamIndex_ = -1;
  std::vector<float> buf_;  // float intercalado estéreo pendiente
  size_t bufPos_ = 0;
  uint64_t cursor_ = 0;
  bool eof_ = false;
};
