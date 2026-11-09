// Pruebas de los efectos de audio del motor (engine/fx/fx_rack.hpp) y de su API C.
// Uso: fx_test   (sin argumentos; termina con código 0 si todo pasa)
#include "dj_engine.h"
#include "fx/fx_rack.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

static int fails = 0;
static void ok(bool c, const std::string& m) {
  std::printf("%s %s\n", c ? "OK   " : "FALLA", m.c_str());
  if (!c) ++fails;
}
static const int SR = 48000;

static std::vector<float> sine(double hz, int n, double amp = 0.5) {
  std::vector<float> v((size_t)n);
  for (int i = 0; i < n; ++i) v[(size_t)i] = (float)(amp * std::sin(2 * M_PI * hz * i / SR));
  return v;
}
static double rms(const std::vector<float>& x, size_t a, size_t b) {
  double s = 0;
  for (size_t i = a; i < b; ++i) s += (double)x[i] * x[i];
  return std::sqrt(s / (double)std::max<size_t>(1, b - a));
}
static bool finite(const std::vector<float>& x) {
  for (float v : x)
    if (!std::isfinite(v) || std::fabs(v) > 8.0f) return false;
  return true;
}
// Configura una unidad y procesa en bloques de 512 (como el motor).
static void run(fx::Unit& u, std::vector<float>& l, std::vector<float>& r, float bpm = 120) {
  for (size_t i = 0; i < l.size(); i += 512) {
    const int n = (int)std::min<size_t>(512, l.size() - i);
    u.process(l.data() + i, r.data() + i, n, bpm);
  }
}
static void make(fx::Unit& u, int type, float wet, float param, bool sync = true) {
  u.setRate(SR);
  u.p.type = type;
  u.p.wet = wet;
  u.p.param = param;
  u.p.sync = sync;
  u.p.on = true;
}

int main() {
  // 0) Nombres
  ok(fx::typeFromName("reverb") == fx::REVERB && fx::typeFromName("nada") < 0 &&
         fx::targetFromName("master") == fx::TARGET_MASTER && fx::targetFromName("C") < 0,
     "nombres de efectos y destinos");

  // 1) Eco sincronizado a 120 BPM con param 0,5 → 1 pulso = 0,5 s: un impulso reaparece a los 0,5 s.
  {
    fx::Unit u; make(u, fx::ECHO, 1.0f, 0.5f);
    std::vector<float> l(SR * 2, 0.0f), r(SR * 2, 0.0f);
    l[100] = r[100] = 1.0f;
    run(u, l, r, 120);
    size_t peak = 0;
    for (size_t i = 1000; i < (size_t)SR; ++i)
      if (std::fabs(l[i]) > std::fabs(l[peak])) peak = i;
    const double ms = (double)(peak - 100) * 1000.0 / SR;
    ok(std::fabs(ms - 500.0) < 3.0, "eco a 120 BPM y 1 pulso: repetición a los 500 ms (" + std::to_string(ms) + " ms)");
    // segunda repetición más débil (se apaga)
    float p2 = 0;
    for (size_t i = (size_t)(SR * 0.95); i < (size_t)(SR * 1.05); ++i) p2 = std::max(p2, std::fabs(l[i]));
    ok(p2 > 0.05f && p2 < std::fabs(l[peak]), "eco: las repeticiones se van apagando");
    ok(fx::echoSeconds(0.0f, true, 128) > 0.11 && fx::echoSeconds(0.0f, true, 128) < 0.12, "eco sincronizado: 1/4 de pulso a 128 BPM ≈ 117 ms");
    ok(std::fabs(fx::echoSeconds(1.0f, false, 0) - 1.0) < 1e-6, "eco libre: param 1 = 1 s");
  }
  // 2) Delay ping-pong: un impulso solo a la izquierda reaparece a la derecha.
  {
    fx::Unit u; make(u, fx::DELAY, 1.0f, 0.5f);
    std::vector<float> l(SR * 3, 0.0f), r(SR * 3, 0.0f);
    l[100] = 1.0f;
    run(u, l, r, 120);
    float rMax = 0;
    for (size_t i = 1000; i < l.size(); ++i) rMax = std::max(rMax, std::fabs(r[i]));
    ok(rMax > 0.1f, "delay ping-pong: lo que entra por la izquierda salta a la derecha");
    ok(finite(l) && finite(r), "delay: sin valores inválidos");
  }
  // 3) Reverb: un golpe deja una cola que dura y se apaga, sin explotar.
  {
    fx::Unit u; make(u, fx::REVERB, 1.0f, 0.8f);
    std::vector<float> l(SR * 4, 0.0f), r(SR * 4, 0.0f);
    for (int i = 0; i < 480; ++i) l[(size_t)i] = r[(size_t)i] = 0.8f;
    run(u, l, r);
    const double tail = rms(l, SR / 2, SR), late = rms(l, SR * 3, SR * 4);
    ok(tail > 0.005, "reverb: deja cola a los 0,5–1 s (" + std::to_string(tail) + ")");
    ok(late < tail * 0.5, "reverb: la cola se apaga");
    ok(finite(l) && finite(r), "reverb: sin valores inválidos");
  }
  // 4) Filtro DJ: pasa-bajos atenúa 5 kHz y deja 100 Hz; pasa-altos al revés; 0,5 casi neutro.
  {
    auto band = [](float param, double hz) {
      fx::Unit u; make(u, fx::FILTER, 1.0f, param);
      auto l = sine(hz, SR), r = sine(hz, SR);
      run(u, l, r);
      return 20 * std::log10(rms(l, SR / 2, SR) / (0.5 / std::sqrt(2.0)));
    };
    const double lp5k = band(0.1f, 5000), lp100 = band(0.1f, 100);
    ok(lp5k < -20 && lp100 > -3, "filtro pasa-bajos: 5 kHz " + std::to_string(lp5k) + " dB, 100 Hz " + std::to_string(lp100) + " dB");
    const double hp100 = band(0.9f, 100), hp8k = band(0.9f, 8000);
    ok(hp100 < -20 && hp8k > -3, "filtro pasa-altos: 100 Hz " + std::to_string(hp100) + " dB, 8 kHz " + std::to_string(hp8k) + " dB");
    ok(std::fabs(band(0.5f, 1000)) < 1.5, "filtro en 0,5: casi neutro");
  }
  // 5) Flanger y phaser: cambian el sonido, sin explotar.
  for (int t : {fx::FLANGER, fx::PHASER}) {
    fx::Unit u; make(u, t, 1.0f, 0.6f);
    auto l = sine(1000, SR * 2), r = sine(1000, SR * 2);
    const auto orig = l;
    run(u, l, r);
    double diff = 0;
    for (size_t i = 0; i < l.size(); ++i) diff += std::fabs(l[i] - orig[i]);
    ok(diff / l.size() > 0.02 && finite(l) && finite(r), std::string(fx::typeName(t)) + ": modula el sonido sin valores inválidos");
  }
  // 6) Bitcrush: con param 1 la señal toma pocos valores distintos (4 bits).
  {
    fx::Unit u; make(u, fx::CRUSH, 1.0f, 1.0f);
    auto l = sine(440, SR), r = sine(440, SR);
    run(u, l, r);
    std::vector<float> vals;
    for (size_t i = SR / 2; i < (size_t)SR; ++i)
      if (std::find(vals.begin(), vals.end(), l[i]) == vals.end()) vals.push_back(l[i]);
    ok(vals.size() <= 16, "bitcrush a 4 bits: " + std::to_string(vals.size()) + " niveles distintos");
  }
  // 7) Apagado o mezcla 0: el sonido pasa intacto. Encender/apagar sin chasquidos (rampa).
  {
    fx::Unit u; make(u, fx::ECHO, 0.0f, 0.5f);
    auto l = sine(440, SR), r = sine(440, SR);
    const auto orig = l;
    run(u, l, r);
    double d = 0;
    for (size_t i = 0; i < l.size(); ++i) d = std::max(d, (double)std::fabs(l[i] - orig[i]));
    ok(d < 1e-4, "mezcla 0: el sonido pasa intacto");
    fx::Unit v; make(v, fx::FILTER, 1.0f, 0.05f);
    v.p.on = false;
    auto a = sine(440, SR), b = sine(440, SR);
    const auto o2 = a;
    run(v, a, b);
    double d2 = 0;
    for (size_t i = 0; i < a.size(); ++i) d2 = std::max(d2, (double)std::fabs(a[i] - o2[i]));
    ok(d2 < 1e-6, "banco apagado: el sonido pasa intacto");
    fx::Unit w; make(w, fx::FILTER, 1.0f, 0.05f);  // de golpe a pasa-bajos fuerte
    auto c = sine(3000, SR / 10), e = sine(3000, SR / 10);
    run(w, c, e);
    float jump = 0;
    for (size_t i = 1; i < 480; ++i) jump = std::max(jump, std::fabs(c[i] - c[i - 1]));
    ok(jump < 0.45f, "encender el efecto no da un salto brusco (rampa de ~10 ms)");
  }
  // 8) Cambiar de efecto limpia el estado (el eco viejo no se cuela en la reverb).
  {
    fx::Unit u; make(u, fx::ECHO, 1.0f, 0.9f);
    std::vector<float> l(SR, 0.0f), r(SR, 0.0f);
    l[10] = r[10] = 1.0f;
    run(u, l, r);
    u.p.type = fx::FILTER;
    u.p.param = 0.5f;
    std::vector<float> z(SR * 2, 0.0f), z2(SR * 2, 0.0f);
    run(u, z, z2);
    ok(rms(z, 0, z.size()) < 1e-6, "al cambiar de efecto no quedan restos del anterior");
  }
  // 9) Rack: cada banco solo afecta a su destino.
  {
    fx::Rack rack;
    rack.setRate(SR);
    rack.bank[0].p.type = fx::FILTER;
    rack.bank[0].p.param = 0.05f;
    rack.bank[0].p.wet = 1.0f;
    rack.bank[0].p.on = true;
    rack.bank[0].p.target = fx::TARGET_A;
    auto al = sine(5000, SR), ar = sine(5000, SR), bl = sine(5000, SR), br = sine(5000, SR);
    for (size_t i = 0; i < al.size(); i += 512) {
      const int n = (int)std::min<size_t>(512, al.size() - i);
      rack.process(fx::TARGET_A, al.data() + i, ar.data() + i, n, 120);
      rack.process(fx::TARGET_B, bl.data() + i, br.data() + i, n, 120);
    }
    ok(rms(al, SR / 2, SR) < 0.05 && rms(bl, SR / 2, SR) > 0.3, "el banco con destino A no toca el deck B");
  }
  // 10) API C del motor.
  {
    DjEngine e = dj_create();
    ok(dj_set_fx(e, 0, "reverb", "master", 1, 0.4f, 0.7f, 0) == 1, "dj_set_fx acepta reverb en la salida general");
    DjFxState st{};
    ok(dj_get_fx(e, 0, &st) == 1 && std::string(st.type) == "reverb" && std::string(st.target) == "master" && st.on == 1 &&
           std::fabs(st.wet - 0.4f) < 1e-6 && st.sync == 0,
       "dj_get_fx devuelve lo configurado");
    ok(dj_set_fx(e, 1, "distorsion", nullptr, -1, -1, -1, -1) == 0 && dj_set_fx(e, 1, nullptr, "C", -1, -1, -1, -1) == 0 &&
           dj_set_fx(e, 2, "echo", nullptr, -1, -1, -1, -1) == 0,
       "tipo, destino o banco inválidos se rechazan");
    dj_set_fx(e, 0, nullptr, nullptr, 0, -1, -1, -1);
    dj_get_fx(e, 0, &st);
    ok(st.on == 0 && std::string(st.type) == "reverb", "cambiar solo «on» conserva el resto");
    dj_destroy(e);
  }
  std::printf(fails ? "\n%d FALLA(S)\n" : "\nTODO OK\n", fails);
  return fails ? 1 : 0;
}
