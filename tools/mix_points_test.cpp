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

  // 2c) loudStartSec / introStartSec (caso real «Cuban Cigars»: 8 s de intro a −25 dB y luego −12 dB).
  std::vector<float> intro;
  for (int i = 0; i < 8; ++i) intro.push_back(i % 2 ? -29.0f : -22.0f);
  for (int i = 0; i < 60; ++i) intro.push_back(-12.0f);
  const double ls = mixpoints::loudStartSec(intro);
  ok(ls == 8.0, ("parte fuerte empieza en 8 s tras la intro suave (dio " + std::to_string(ls) + ")").c_str());
  ok(mixpoints::loudStartSec(plano) == 0.0, "sin intro suave, la parte fuerte empieza al inicio");
  ok(mixpoints::loudStartSec(std::vector<float>(5, -12.0f)) < 0, "pocos segundos → -1");
  ok(mixpoints::introStartSec(0, 8, 2, 30) == 6, "intro suave de 8 s: la entrante arranca 2 s antes de la parte fuerte");
  ok(mixpoints::introStartSec(0, 1.5, 2, 30) == 0, "intro corta: arranca en el primer sonido");
  ok(mixpoints::introStartSec(0.5, 70, 2, 30) == 30.5, "intro muy larga: nunca salta más de 30 s");
  ok(mixpoints::introStartSec(0, -1, 2, 30) == 0, "sin dato de energía: primer sonido");
  ok(mixpoints::introStartSec(0, 8, 2, 0) == 0, "desactivado (AUDIT_SOUND_INTRO_SALTO=0): primer sonido");

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

  // 3b) dj_analyze_loud_range sobre un WAV con 10 s de intro a −26 dB, 40 s pleno y cola.
  std::vector<float> pcm2;
  for (int i = 0; i < sr * 60; ++i) {
    const double s = (double)i / sr;
    const double g = s < 10 ? 0.05 : (s < 50 ? 1.0 : std::pow(10.0, -2.0 * (s - 50) / 10.0));
    pcm2.push_back((float)(0.4 * g * std::sin(2 * M_PI * 220 * s)));
  }
  ok(writeWav(wav, pcm2, sr), "WAV con intro suave escrito");
  double lst = -1, len = -1;
  dj_analyze_loud_range(wav.c_str(), &lst, &len);
  ok(lst >= 9 && lst <= 10, ("dj_analyze_loud_range ubica el comienzo de la parte fuerte (dio " + std::to_string(lst) + " s)").c_str());
  ok(len >= 50 && len <= 56, ("dj_analyze_loud_range ubica el fin de la parte fuerte (dio " + std::to_string(len) + " s)").c_str());
  std::remove(wav.c_str());

  // 4) breakFadeEnd (puras). Nivel cada 0,25 s: 60 s a −14 dB con un break de 1,5 s a −28 dB.
  {
    using mixpoints::breakFadeEnd;
    const double H = 0.25;
    auto track = [&](double secs, double brk, double brkLen) {
      std::vector<float> q((size_t)(secs / H), -14.0f);
      for (size_t i = 0; i < q.size(); ++i) {
        const double t = (double)i * H;
        if (brk >= 0 && t >= brk && t < brk + brkLen) q[i] = -28.0f;
        if (i % 3 == 0) q[i] += 1.5f;  // un poco de variación, como la música
      }
      return q;
    };
    // Caso de producción: fundido 52–60 s y break en 53,5–55 s → termina en 53,5.
    auto q = track(60, 53.5, 1.5);
    ok(std::fabs(breakFadeEnd(q, H, 60.0, 8.0, 15.0) - 53.5) < 1e-6, "un break dentro del fundido lo adelanta al inicio del break");
    // Sin break: no cambia.
    ok(breakFadeEnd(track(60, -1, 0), H, 60.0, 8.0, 15.0) == 60.0, "sin break, el fundido no cambia");
    // Break antes del fundido (40 s): no cambia.
    ok(breakFadeEnd(track(60, 40.0, 1.5), H, 60.0, 8.0, 15.0) == 60.0, "un break fuera del fundido no lo cambia");
    // Hueco de 0,5 s (un golpe seco, no un break): no cambia.
    ok(breakFadeEnd(track(60, 55.0, 0.5), H, 60.0, 8.0, 15.0) == 60.0, "un hueco de 0,5 s no cuenta como break");
    // El final de la pista (cae y ya no vuelve) no es un break: lo resuelve energyFadeEnd.
    auto fin = track(60, -1, 0);
    for (size_t i = (size_t)(56 / H); i < fin.size(); ++i) fin[i] = -35.0f;
    ok(breakFadeEnd(fin, H, 60.0, 8.0, 15.0) == 60.0, "la caída final (sin vuelta de la música) no es un break");
    // Tope de adelanto: con minFadeEnd = 55 no se adelanta a 53,5.
    ok(breakFadeEnd(q, H, 60.0, 8.0, 55.0) == 60.0, "respeta el tope de adelanto (AUDIT_SOUND_MIX_MAX_ADELANTO)");
    // Dos breaks seguidos: tras adelantar a 53,5, el nuevo tramo (45,5–53) tiene otro en 48 → 48.
    auto q2 = track(60, 53.5, 1.5);
    for (size_t i = (size_t)(48 / H); i < (size_t)(49.5 / H); ++i) q2[i] = -28.0f;
    ok(std::fabs(breakFadeEnd(q2, H, 60.0, 8.0, 15.0) - 48.0) < 1e-6, "si el nuevo tramo tiene otro break, también lo esquiva");
    ok(breakFadeEnd({}, H, 60.0, 8.0, 15.0) == 60.0, "sin datos de nivel, no cambia");
  }

  // 5) dj_analyze_mix_profile: el nivel cada 0,25 s ve el break y el resultado por segundo no cambia.
  {
    std::vector<float> pcm3;
    for (int i = 0; i < sr * 30; ++i) {
      const double s = (double)i / sr;
      const double g = (s >= 20.0 && s < 21.5) ? 0.04 : 1.0;  // break de 1,5 s a −28 dB
      pcm3.push_back((float)(0.4 * g * std::sin(2 * M_PI * 220 * s)));
    }
    ok(writeWav(wav, pcm3, sr), "WAV con break escrito");
    std::vector<float> lv(1000);
    int nq = 0;
    double ls3 = -1, le3 = -1, ls4 = -1, le4 = -1;
    dj_analyze_mix_profile(wav.c_str(), &ls3, &le3, lv.data(), (int)lv.size(), &nq);
    dj_analyze_loud_range(wav.c_str(), &ls4, &le4);
    ok(nq == 120, ("120 niveles para 30 s (dio " + std::to_string(nq) + ")").c_str());
    ok(nq >= 86 && lv[80] < -25 && lv[85] < -25 && lv[79] > -12 && lv[86] > -12,
       "el break de 20–21,5 s aparece en los niveles de 0,25 s");
    ok(ls3 == ls4 && le3 == le4, "loud_start/loud_end iguales a dj_analyze_loud_range");
    lv.resize((size_t)nq);
    const double fe = mixpoints::breakFadeEnd(lv, DJ_LEVEL_HOP_SEC, 27.0, 8.0, 0.0);
    ok(std::fabs(fe - 20.0) < 0.26, ("con el WAV real, el fundido 19–27 termina en el break (dio " + std::to_string(fe) + ")").c_str());
    std::remove(wav.c_str());
  }

  std::printf(fails ? "\n%d FALLA(S)\n" : "\nTODO OK\n", fails);
  return fails ? 1 : 0;
}
