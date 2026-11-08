// Pruebas de las funciones puras del AutoMix (engine/automix/mix_points.hpp) y de
// dj_analyze_loud_end sobre un WAV sintético con cola que se apaga.
// Uso: mix_points_test   (sin argumentos; termina con código 0 si todo pasa)
#include "dj_engine.h"
#include "mix_points.hpp"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

static int fails = 0;
static void ok(bool c, const char* m) {
  std::printf("%s %s\n", c ? "OK   " : "FALLA", m);
  if (!c) ++fails;
}

static bool writeWav(const std::string& path, const std::vector<float>& mono, int sr) {
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return false;
  const uint32_t n = (uint32_t)mono.size(), data = n * 2 * 2, riff = 36 + data;
  const uint16_t ch = 2, bits = 16, fmt = 1, align = 4;
  const uint32_t sr32 = (uint32_t)sr, br = sr32 * 4, fmtLen = 16;
  std::fwrite("RIFF", 1, 4, f); std::fwrite(&riff, 4, 1, f); std::fwrite("WAVEfmt ", 1, 8, f);
  std::fwrite(&fmtLen, 4, 1, f); std::fwrite(&fmt, 2, 1, f); std::fwrite(&ch, 2, 1, f);
  std::fwrite(&sr32, 4, 1, f); std::fwrite(&br, 4, 1, f); std::fwrite(&align, 2, 1, f);
  std::fwrite(&bits, 2, 1, f); std::fwrite("data", 1, 4, f); std::fwrite(&data, 4, 1, f);
  for (float v : mono) {
    const int16_t s = (int16_t)std::lround(std::fmax(-1.f, std::fmin(1.f, v)) * 32767.f);
    std::fwrite(&s, 2, 1, f); std::fwrite(&s, 2, 1, f);
  }
  std::fclose(f);
  return true;
}

int main() {
  // 1) loudEndSec: 60 s a −12 dB y luego 20 s que bajan a −40 dB → la parte fuerte termina ~60 s.
  std::vector<float> db;
  for (int i = 0; i < 60; ++i) db.push_back(-12.0f + (i % 3 == 0 ? 0.5f : -0.5f));
  for (int i = 0; i < 20; ++i) db.push_back(-12.0f - 1.4f * (float)(i + 1));
  const double e = mixpoints::loudEndSec(db);
  ok(e >= 60 && e <= 65, ("parte fuerte termina cerca de 60 s (dio " + std::to_string(e) + ")").c_str());
  // Pista sin decaimiento: la parte fuerte llega hasta el final.
  std::vector<float> plano(80, -12.0f);
  ok(mixpoints::loudEndSec(plano) == 80.0, "sin decaimiento, la parte fuerte llega al final");
  // Datos insuficientes o silencio: −1.
  ok(mixpoints::loudEndSec(std::vector<float>(5, -12.0f)) < 0, "pocos segundos → -1");
  ok(mixpoints::loudEndSec(std::vector<float>(40, -90.0f)) < 0, "silencio → -1");

  // 2) rampToward: 6 % a 0,3 %/s llega a 1.0 en 20 s, sin pasarse y sin saltos mayores al paso.
  float r = 1.06f;
  double t = 0;
  bool salto = false;
  while (r != 1.0f && t < 60) {
    const float prev = r;
    r = mixpoints::rampToward(r, 1.0f, 0.05, 0.003f);
    if (std::fabs(prev - r) > 0.003f * 0.05f + 1e-6f) salto = true;
    t += 0.05;
  }
  ok(r == 1.0f && t > 19.0 && t < 21.0, ("vuelve a 1.0 en ~20 s (tardó " + std::to_string(t) + " s)").c_str());
  ok(!salto, "sin saltos mayores a 0,3 %/s");
  ok(mixpoints::rampToward(0.95f, 1.0f, 1.0, 0.003f) > 0.95f, "también sube desde un tempo más lento");
  ok(mixpoints::rampToward(1.0f, 1.0f, 1.0, 0.003f) == 1.0f, "ya en su tempo, no cambia");

  // 2b) energyFadeEnd: el adelanto se limita (caso real «Cielos»: parte fuerte termina a 330 s de 700).
  ok(mixpoints::energyFadeEnd(330, 700, 8, 45) == 655, "pista con segunda mitad tranquila: solo se adelanta 45 s");
  ok(mixpoints::energyFadeEnd(72, 80, 8, 45) == 73, "cola corta: termina 1 s tras la parte fuerte");
  ok(mixpoints::energyFadeEnd(-1, 80, 8, 45) == 80, "sin dato de energía: último sonido");
  ok(mixpoints::energyFadeEnd(79.5, 80, 8, 45) == 80, "sin decaimiento: último sonido");
  ok(mixpoints::energyFadeEnd(5, 80, 8, 45) == 80, "parte fuerte más corta que el fundido: último sonido");

  // 3) dj_analyze_loud_end sobre un WAV real: 40 s a nivel pleno + 15 s de cola que se apaga.
  const int sr = 44100;
  std::vector<float> pcm;
  for (int i = 0; i < sr * 55; ++i) {
    const double s = (double)i / sr;
    const double g = s < 40 ? 1.0 : std::pow(10.0, -2.0 * (s - 40) / 15.0);  // −40 dB al final
    pcm.push_back((float)(0.4 * g * std::sin(2 * M_PI * 220 * s)));
  }
  const std::string wav = "/tmp/mix_points_test.wav";
  ok(writeWav(wav, pcm, sr), "WAV de prueba escrito");
  double le = -1;
  dj_analyze_loud_end(wav.c_str(), &le);
  ok(le >= 40 && le <= 46, ("dj_analyze_loud_end ubica el fin de la parte fuerte (dio " + std::to_string(le) + " s)").c_str());
  std::remove(wav.c_str());

  std::printf(fails ? "\n%d FALLA(S)\n" : "\nTODO OK\n", fails);
  return fails ? 1 : 0;
}
