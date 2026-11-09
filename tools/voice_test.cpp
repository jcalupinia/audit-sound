// Pruebas del mezclador de voz en vivo (engine/voice/voice_mixer.hpp) y de su API en el motor.
// Uso: voice_test   (sin argumentos; termina con código 0 si todo pasa)
#include "dj_engine.h"
#include "voice/voice_mixer.hpp"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

static int fails = 0;
static void ok(bool c, const std::string& m) {
  std::printf("%s %s\n", c ? "OK   " : "FALLA", m.c_str());
  if (!c) ++fails;
}

// Tono de `hz` a `sr` en PCM 16 bits, amplitud `amp` (0..1), continuo entre llamadas.
static std::vector<int16_t> tone(int frames, int sr, double hz, double amp, double& phase) {
  std::vector<int16_t> v((size_t)frames);
  for (int i = 0; i < frames; ++i) {
    v[(size_t)i] = (int16_t)std::lround(32767.0 * amp * std::sin(phase));
    phase += 2 * M_PI * hz / sr;
  }
  return v;
}

static double rms(const std::vector<float>& x, size_t from, size_t to) {
  double s = 0;
  for (size_t i = from; i < to; ++i) s += (double)x[i] * x[i];
  return std::sqrt(s / (double)std::max<size_t>(1, to - from));
}

int main() {
  const int SR = 44100;  // frecuencia del motor (Icecast)
  // 1) Sin voz la música pasa intacta, sin atenuar.
  {
    VoiceMixer v(SR);
    std::vector<float> l(4410, 0.5f), r(4410, 0.5f);
    v.process(l.data(), r.data(), 4410);
    ok(std::fabs(l.back() - 0.5f) < 1e-6 && !v.active(), "sin voz la música no cambia");
  }
  // 2) Voz a 48 kHz (navegador) remuestreada a 44,1 kHz: entra tras el búfer mínimo y la música baja.
  {
    VoiceMixer v(SR);
    double ph = 0;
    const int block = 4800;  // 100 ms a 48 kHz
    std::vector<float> outL, music;
    for (int b = 0; b < 30; ++b) {  // 3 s
      auto pcm = tone(block, 48000, 440.0, 0.5, ph);
      v.push(pcm.data(), block, 48000);
      std::vector<float> l(4410, 0.0f), r(4410, 0.0f), m(4410, 0.3f);
      // música constante 0.3 en un canal aparte para medir la ganancia aplicada
      std::vector<float> ml = m, mr = m;
      v.process(ml.data(), mr.data(), 4410);
      for (int i = 0; i < 4410; ++i) outL.push_back(ml[(size_t)i]);
    }
    ok(v.active(), "la voz está sonando");
    ok(std::fabs(v.musicGain() - std::pow(10.0f, -14.0f / 20.0f)) < 0.02,
       "talkover automático: la música baja 14 dB al hablar (ganancia " + std::to_string(v.musicGain()) + ")");
    const double vr = rms(outL, outL.size() - 4410, outL.size());
    // voz 0.5 de pico → 0.354 RMS, más la música atenuada (0.3·0.2 = 0.06) en fase continua
    ok(vr > 0.30 && vr < 0.42, "la voz se suma a la salida (RMS " + std::to_string(vr) + ")");
    ok(v.bufferedMs() < 400, "el retraso de la voz se mantiene bajo (" + std::to_string(v.bufferedMs()) + " ms)");
    ok(std::fabs(v.receivedSamples() / (double)SR - 3.0) < 0.01, "se remuestreó 48 kHz → 44,1 kHz sin perder tiempo");
    // Al callar, la música empieza a volver a los 600 ms y recupera su volumen en ~1 s más.
    for (int b = 0; b < 8; ++b) {  // 0,8 s callado: aún atenuada (espera de 600 ms + búfer)
      std::vector<float> l(4410, 0.3f), r(4410, 0.3f);
      v.process(l.data(), r.data(), 4410);
    }
    ok(v.musicGain() < 0.9, "justo al callar la música sigue atenuada (no sube entre palabras)");
    for (int b = 0; b < 17; ++b) {
      std::vector<float> l(4410, 0.3f), r(4410, 0.3f);
      v.process(l.data(), r.data(), 4410);
    }
    ok(v.musicGain() > 0.97, "al callar la música vuelve a su volumen (" + std::to_string(v.musicGain()) + ")");
  }
  // 3) Talkover apagado: la voz suena pero la música no baja. Siempre: baja aunque no hablen.
  {
    VoiceMixer v(SR);
    v.talkover.store(0);
    double ph = 0;
    for (int b = 0; b < 10; ++b) {
      auto pcm = tone(4410, SR, 300.0, 0.5, ph);
      v.push(pcm.data(), 4410, SR);
      std::vector<float> l(4410, 0.3f), r(4410, 0.3f);
      v.process(l.data(), r.data(), 4410);
    }
    ok(v.musicGain() > 0.999, "talkover apagado: la música no baja");
    VoiceMixer w(SR);
    w.talkover.store(1);
    std::vector<float> l(SR, 0.3f), r(SR, 0.3f);
    w.process(l.data(), r.data(), SR);
    ok(std::fabs(l.back() - 0.3f * std::pow(10.0f, -14.0f / 20.0f)) < 0.01, "talkover siempre: la música baja sin voz");
  }
  // 4) La red se adelanta (llegan 2 s de golpe): se descarta lo viejo y el retraso no pasa de 0,8 s.
  {
    VoiceMixer v(SR);
    double ph = 0;
    auto pcm = tone(SR * 2, SR, 300.0, 0.3, ph);
    v.push(pcm.data(), SR * 2, SR);
    std::vector<float> l(441, 0.0f), r(441, 0.0f);
    v.process(l.data(), r.data(), 441);
    ok(v.bufferedMs() <= 800 && v.dropped() >= 1, "ráfaga de 2 s: se recorta el retraso (" + std::to_string(v.bufferedMs()) + " ms)");
  }
  // 5) Silencio de red (corte): la voz se detiene sin ruido y vuelve a cebar el búfer.
  {
    VoiceMixer v(SR);
    double ph = 0;
    auto pcm = tone(SR / 2, SR, 300.0, 0.3, ph);
    v.push(pcm.data(), SR / 2, SR);
    std::vector<float> l(SR, 0.0f), r(SR, 0.0f);
    v.process(l.data(), r.data(), SR);
    ok(!v.active() && v.underruns() == 1 && l.back() == 0.0f, "corte de red: la voz se detiene limpia y espera el búfer");
  }
  // 5b) El consumidor se detiene (motor reconectando a Icecast) y la voz sigue llegando: el búfer se
  //     llena, se descarta lo que no cabe y NO se pierde la posición (antes: lectura fuera del PCM).
  {
    VoiceMixer v(SR);
    double ph = 0;
    for (int b = 0; b < 45; ++b) {  // 4,5 s de voz sin consumir (el búfer guarda 3 s)
      auto pcm = tone(4800, 48000, 440.0, 0.3, ph);
      v.push(pcm.data(), 4800, 48000);
    }
    ok(v.overflowSamples() > 0, "búfer lleno: la voz que no cabe se descarta");
    std::vector<float> l(SR * 4, 0.0f), r(SR * 4, 0.0f);
    v.process(l.data(), r.data(), SR * 4);  // el consumidor vuelve y vacía
    auto pcm = tone(4800, 48000, 440.0, 0.3, ph);
    const int n = v.push(pcm.data(), 4800, 48000);
    ok(n >= 4400 && n <= 4420, "tras el desborde, 100 ms de voz siguen siendo 100 ms (" + std::to_string(n) + " muestras)");
  }
  // 6) Entradas inválidas.
  {
    VoiceMixer v(SR);
    int16_t x[10] = {0};
    ok(v.push(nullptr, 10, 48000) == 0 && v.push(x, 10, 1000) == 0 && v.push(x, 0, 48000) == 0,
       "bloques inválidos se ignoran");
  }
  // 7) API del motor: push, talkover y estado.
  {
    DjEngine e = dj_create();
    double ph = 0;
    auto pcm = tone(4800, 48000, 440.0, 0.5, ph);
    ok(dj_voice_push(e, pcm.data(), 4800, 48000) > 4000, "dj_voice_push acepta voz");
    dj_set_talkover(e, 1, 1.5f, -20.0f);
    DjVoiceStatus st{};
    dj_voice_status(e, &st);
    ok(st.talkover == 1 && st.received_seconds > 0.09, "dj_set_talkover y dj_voice_status");
    dj_set_talkover(e, 7, -1.0f, 5.0f);  // valores fuera de rango
    dj_voice_status(e, &st);
    ok(st.talkover == 2, "modo inválido → automático");
    dj_destroy(e);
  }
  std::printf(fails ? "\n%d FALLA(S)\n" : "\nTODO OK\n", fails);
  return fails ? 1 : 0;
}
