#pragma once

// Encoder MP3 con libmp3lame (issue D1). Recibe PCM float intercalado estéreo
// en rango [-1, 1] (lo que produce renderInterleaved) y emite MP3 CBR.

#include <lame/lame.h>

#include <vector>

#include "platform_log.hpp"

class Mp3Encoder {
 public:
  ~Mp3Encoder() { close(); }

  bool init(int sampleRate, int channels, int kbps) {
    channels_ = channels >= 2 ? 2 : 1;  // emitimos estéreo (o mono)
    gfp_ = lame_init();
    if (!gfp_) {
      LOGE("lame_init falló");
      return false;
    }
    lame_set_in_samplerate(gfp_, sampleRate);
    lame_set_out_samplerate(gfp_, sampleRate);
    lame_set_num_channels(gfp_, channels_);
    lame_set_mode(gfp_, channels_ == 2 ? JOINT_STEREO : MONO);
    lame_set_VBR(gfp_, vbr_off);  // CBR
    lame_set_brate(gfp_, kbps);
    lame_set_quality(gfp_, 2);  // 0=mejor/lento .. 9=peor/rápido
    if (lame_init_params(gfp_) < 0) {
      LOGE("lame_init_params falló");
      close();
      return false;
    }
    return true;
  }

  // frames = cuadros por canal. Devuelve los bytes MP3 producidos en out.
  void encode(const float* interleaved, int frames, std::vector<unsigned char>& out) {
    if (!gfp_ || frames <= 0) return;
    const int cap = static_cast<int>(1.25 * frames) + 7200;
    out.resize(static_cast<size_t>(cap));
    int n = lame_encode_buffer_interleaved_ieee_float(
        gfp_, interleaved, frames, out.data(), cap);
    if (n < 0) {
      LOGE("lame_encode devolvió %d", n);
      n = 0;
    }
    out.resize(static_cast<size_t>(n));
  }

  // Vacía el buffer interno del encoder al final del stream.
  void flush(std::vector<unsigned char>& out) {
    if (!gfp_) return;
    out.resize(7200);
    int n = lame_encode_flush(gfp_, out.data(), 7200);
    if (n < 0) n = 0;
    out.resize(static_cast<size_t>(n));
  }

  void close() {
    if (gfp_) {
      lame_close(gfp_);
      gfp_ = nullptr;
    }
  }

 private:
  lame_global_flags* gfp_ = nullptr;
  int channels_ = 2;
};
