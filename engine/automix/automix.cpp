// AutoMix — port del Auto DJ de Mixxx (issue M3). Ver docs del port.
// Máquina de estados + cálculo de transición + avance del crossfader por posición.

#include "automix.h"

#include "mix_points.hpp"
#include "platform_log.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

namespace {

enum { ST_DISABLED = 0, ST_IDLE = 1, ST_FADING = 2 };

struct AutoMixImpl {
  DjEngine engine = nullptr;
  AutoMixNextTrackFn nextCb = nullptr;
  void* nextUser = nullptr;

  std::atomic<double> transitionTime{8.0};
  std::atomic<int> mode{0};  // 0 skip-silence, 1 full track
  std::atomic<int> state{ST_DISABLED};
  std::atomic<bool> running{false};
  std::atomic<bool> skipReq{false};
#ifndef __EMSCRIPTEN__
  std::thread th;  // solo servidor/Android; en WASM se usa begin()+tick() sin hilo
#endif

  // Estado por deck (sustituye DeckAttributes).
  double deckFirst[2] = {0.0, 0.0};
  double deckLast[2] = {-1.0, -1.0};
  double deckLoudEnd[2] = {-1.0, -1.0};  // fin de la parte fuerte (punto de mezcla por energía)
  float deckRate[2] = {1.0f, 1.0f};       // velocidad aplicada por syncTempo (1 = tempo propio)
  // Mejoras del 2026-11-08 (medición en producción). Se pueden apagar por entorno:
  //  AUDIT_SOUND_MIX_POINT=silence  → vuelve a terminar el fundido en el último sonido.
  //  AUDIT_SOUND_TEMPO_RETURN=0     → la entrante se queda al tempo de la saliente (antes).
  bool mixByEnergy = true;
  bool tempoReturn = true;
  double maxAdvance = 45.0;  // s: lo más que se adelanta el final (AUDIT_SOUND_MIX_MAX_ADELANTO)
  bool rampActive = false;
  std::chrono::steady_clock::time_point rampFrom{}, rampLast{};
  bool deckLoaded[2] = {false, false};
  std::string deckPath[2];
  std::string currentPath;  // pista que suena (bajo infoMu)
  std::mutex infoMu;        // protege deckPath/currentPath para los getters
  int fromDeck = 0;
  double fadeBeginSec = 0, fadeEndSec = 0, toStartSec = 0;

  bool loadInto(int d) {
    char path[4096];
    path[0] = 0;
    if (!nextCb || !nextCb(nextUser, path, (int)sizeof(path)) || !path[0]) return false;
    if (!dj_load(engine, d, path)) {
      LOGE("automix: no carga %s (%s)", path, dj_last_error());
      return false;
    }
    double first = 0, last = -1;
    float e = 0;
    dj_analyze_silence(path, &first, &last, &e);
    deckFirst[d] = first;
    deckLast[d] = last > 0 ? last : dj_duration(engine, d);
    deckLoudEnd[d] = -1.0;
    if (mixByEnergy) dj_analyze_loud_end(path, &deckLoudEnd[d]);
    deckRate[d] = 1.0f;
    dj_set_rate(engine, d, 1.0f);
    deckLoaded[d] = true;
    {
      std::lock_guard<std::mutex> lk(infoMu);
      deckPath[d] = path;
    }
    dj_seek(engine, d, first);  // cue al primer sonido
    LOGI("automix: pista en deck %d (dur=%.1f first=%.2f last=%.2f fuerte_hasta=%.2f bpm=%.1f)", d,
         dj_duration(engine, d), first, deckLast[d], deckLoudEnd[d], dj_get_bpm(engine, d));
    return true;
  }

  void computeTransition() {
    const double dur = dj_duration(engine, fromDeck);
    double fadeEnd =
        mode.load() == 1 ? dur : (deckLast[fromDeck] > 0 ? deckLast[fromDeck] : dur);
    // Punto de mezcla por energía: si la pista decae claramente antes de su último sonido, el
    // fundido termina 1 s después de su parte fuerte (la saliente aún suena llena al mezclar).
    const double loud = deckLoudEnd[fromDeck];
    if (mode.load() == 0 && mixByEnergy) {
      fadeEnd = mixpoints::energyFadeEnd(loud, fadeEnd, transitionTime.load(), maxAdvance);
    }
    double fadeBegin = fadeEnd - transitionTime.load();
    if (fadeBegin < 0) fadeBegin = 0;
    fadeBeginSec = fadeBegin;
    fadeEndSec = fadeEnd;
    const int toDeck = 1 - fromDeck;
    toStartSec = deckLoaded[toDeck] ? deckFirst[toDeck] : 0.0;
  }

  void syncTempo(int fromD, int toD) {
    rampActive = false;  // durante el fundido no se toca el tempo de la saliente
    // Tempo EFECTIVO de la saliente (puede estar aún volviendo a su tempo propio).
    const float bf = dj_get_bpm(engine, fromD) * deckRate[fromD], bt = dj_get_bpm(engine, toD);
    deckRate[toD] = 1.0f;
    if (bf > 0 && bt > 0) {
      const double r = (double)bf / bt;
      if (r >= 0.94 && r <= 1.06) {
        dj_set_keylock(engine, toD, 1);
        dj_set_rate(engine, toD, (float)r);
        deckRate[toD] = (float)r;
      }
    }
  }

  // Tras el fundido, la pista que quedó sonando vuelve gradualmente a su tempo propio
  // (como un DJ que suelta el pitch): espera 4 s y avanza 0,3 % por segundo (6 % en ~20 s).
  void startTempoReturn() {
    rampActive = tempoReturn && std::fabs(deckRate[fromDeck] - 1.0f) > 1e-4f;
    rampFrom = std::chrono::steady_clock::now() + std::chrono::seconds(4);
    rampLast = rampFrom;
  }
  void stepTempoReturn() {
    if (!rampActive) return;
    const auto now = std::chrono::steady_clock::now();
    if (now < rampFrom) return;
    const double dt = std::chrono::duration<double>(now - rampLast).count();
    rampLast = now;
    const float r = mixpoints::rampToward(deckRate[fromDeck], 1.0f, dt, 0.003f);
    if (r != deckRate[fromDeck]) {
      deckRate[fromDeck] = r;
      dj_set_rate(engine, fromDeck, r);
    }
    if (r == 1.0f) {
      rampActive = false;
      LOGI("automix: deck %d de vuelta a su tempo propio", fromDeck);
    }
  }

  // Carga en el deck d reintentando con las siguientes candidatas si una falla
  // (archivo corrupto/no disponible). Evita que una sola pista dañada detenga el
  // DJ autónomo (defecto D1 de F0). Devuelve false solo si se agotan los intentos.
  bool loadIntoRetry(int d, int maxAttempts) {
    for (int i = 0; i < maxAttempts && running.load(); ++i) {
      if (loadInto(d)) return true;
      LOGI("automix: salto pista inválida (intento %d/%d)", i + 1, maxAttempts);
    }
    return false;
  }

  // Prepara la sesión autónoma: adopta un deck que YA esté sonando (conmutación
  // manual→auto sin cortar el audio) o, si no, carga la primera pista. Devuelve
  // false solo si no hay ninguna pista válida. No toca `running` (lo hace el caller).
  bool begin() {
    int adopt = -1;
    for (int d = 0; d < 2; ++d)
      if (dj_loaded(engine, d) && dj_playing(engine, d)) { adopt = d; break; }

    if (adopt >= 0) {
      // Adopta el deck en reproducción (no reanaliza: usa su duración actual).
      fromDeck = adopt;
      deckLoaded[adopt] = true;
      deckFirst[adopt] = 0.0;
      deckLast[adopt] = dj_duration(engine, adopt);
      dj_set_xfader(engine, adopt == 0 ? 0.0f : 1.0f);
      {
        std::lock_guard<std::mutex> lk(infoMu);
        currentPath = deckPath[adopt];  // puede quedar vacío si lo cargó el modo manual
      }
      const int other = 1 - adopt;
      deckLoaded[other] = false;
      loadIntoRetry(other, 32);  // precarga el otro deck
    } else {
      fromDeck = 0;
      if (!loadIntoRetry(0, 32)) {
        LOGE("automix: sin pista inicial tras varios intentos");
        state = ST_DISABLED;
        return false;
      }
      dj_seek(engine, 0, deckFirst[0]);
      dj_set_xfader(engine, 0.0f);  // deck 0 a tope
      dj_play(engine, 0, 1);
      {
        std::lock_guard<std::mutex> lk(infoMu);
        currentPath = deckPath[0];
      }
      loadIntoRetry(1, 32);  // precarga deck 1 (cued)
    }
    computeTransition();
    state = ST_IDLE;
    return true;
  }

  // Una iteración de la máquina de estados (sin dormir ni bucle). En el servidor la
  // llama loop() en su hilo; en WASM (sin hilos) la llama el Worker periódicamente.
  void tick() {
    if (state.load() == ST_DISABLED) return;
    const double pos = dj_position(engine, fromDeck);
    const bool playing = dj_playing(engine, fromDeck) != 0;

    if (skipReq.exchange(false)) {
      fadeBeginSec = pos;
      fadeEndSec = pos + std::min(transitionTime.load(), 4.0);
    }

    if (state.load() == ST_IDLE) {
      stepTempoReturn();
      if (!playing || pos >= fadeBeginSec) {
        const int toDeck = 1 - fromDeck;
        if (!deckLoaded[toDeck]) {
          if (!loadIntoRetry(toDeck, 32)) return;  // reintenta en el próximo tick
          computeTransition();
        }
        dj_seek(engine, toDeck, toStartSec);
        syncTempo(fromDeck, toDeck);
        dj_play(engine, toDeck, 1);
        LOGI("automix: transición deck %d -> %d (fadeBegin=%.2f fadeEnd=%.2f)", fromDeck,
             toDeck, fadeBeginSec, fadeEndSec);
        state = ST_FADING;
      }
    } else if (state.load() == ST_FADING) {
      const int toDeck = 1 - fromDeck;
      const float startX = fromDeck == 0 ? 0.0f : 1.0f;
      const float targetX = fromDeck == 0 ? 1.0f : 0.0f;
      double denom = fadeEndSec - fadeBeginSec;
      if (denom < 0.05) denom = 0.05;
      double prog = (pos - fadeBeginSec) / denom;
      if (prog < 0) prog = 0;
      if (prog > 1) prog = 1;
      if (!playing) prog = 1.0;  // la from-deck terminó
      const float x = startX + (targetX - startX) * (float)prog;
      dj_set_xfader(engine, x);
      if (prog >= 1.0) {
        dj_play(engine, fromDeck, 0);
        dj_set_xfader(engine, targetX);
        deckLoaded[fromDeck] = false;
        const int oldFrom = fromDeck;
        fromDeck = toDeck;
        {
          std::lock_guard<std::mutex> lk(infoMu);
          currentPath = deckPath[toDeck];
        }
        loadIntoRetry(oldFrom, 32);  // precarga la siguiente en el deck liberado
        computeTransition();
        LOGI("automix: fin transición; ahora suena deck %d", fromDeck);
        startTempoReturn();
        state = ST_IDLE;
      }
    }
  }

#ifndef __EMSCRIPTEN__
  // Bucle con hilo (servidor/Android). En WASM se usan begin()+tick() desde JS.
  void loop() {
    if (!begin()) {
      running = false;
      return;
    }
    while (running.load()) {
      tick();
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    state = ST_DISABLED;
  }
#endif
};

}  // namespace

extern "C" {

AutoMix automix_create(DjEngine engine) {
  auto* a = new AutoMixImpl();
  a->engine = engine;
  if (const char* mp = std::getenv("AUDIT_SOUND_MIX_POINT"))
    a->mixByEnergy = std::strcmp(mp, "silence") != 0;
  if (const char* ma = std::getenv("AUDIT_SOUND_MIX_MAX_ADELANTO"))
    a->maxAdvance = std::atof(ma) > 0 ? std::atof(ma) : 45.0;
  if (const char* tr = std::getenv("AUDIT_SOUND_TEMPO_RETURN"))
    a->tempoReturn = std::strcmp(tr, "0") != 0;
  return a;
}

void automix_destroy(AutoMix am) {
  auto* a = static_cast<AutoMixImpl*>(am);
  if (!a) return;
  a->running = false;
#ifndef __EMSCRIPTEN__
  if (a->th.joinable()) a->th.join();
#endif
  delete a;
}

void automix_set_next_track(AutoMix am, AutoMixNextTrackFn cb, void* user) {
  auto* a = static_cast<AutoMixImpl*>(am);
  a->nextCb = cb;
  a->nextUser = user;
}

void automix_set_transition_time(AutoMix am, double seconds) {
  static_cast<AutoMixImpl*>(am)->transitionTime = seconds;
}

void automix_set_mode(AutoMix am, int mode) {
  static_cast<AutoMixImpl*>(am)->mode = mode;
}

int automix_enable(AutoMix am, int on) {
  auto* a = static_cast<AutoMixImpl*>(am);
#ifndef __EMSCRIPTEN__
  if (on) {
    if (a->running.load()) return 1;
    a->running = true;
    a->th = std::thread([a] { a->loop(); });
  } else {
    a->running = false;
    if (a->th.joinable()) a->th.join();
  }
  return 1;
#else
  // En WASM no hay hilo: usar automix_begin()/automix_tick()/automix_end().
  (void)a;
  (void)on;
  return 0;
#endif
}

void automix_skip(AutoMix am) { static_cast<AutoMixImpl*>(am)->skipReq = true; }

// Ruta sin hilo (WASM): el Worker llama begin() una vez y tick() periódicamente.
int automix_begin(AutoMix am) {
  auto* a = static_cast<AutoMixImpl*>(am);
  if (a->running.load()) return 1;
  a->running = true;
  const bool ok = a->begin();
  if (!ok) a->running = false;
  return ok ? 1 : 0;
}

void automix_tick(AutoMix am) {
  auto* a = static_cast<AutoMixImpl*>(am);
  if (a->running.load()) a->tick();
}

void automix_end(AutoMix am) {
  auto* a = static_cast<AutoMixImpl*>(am);
  a->running = false;
  a->state = ST_DISABLED;  // deja de conducir el crossfader; el audio sigue sonando
}

int automix_state(AutoMix am) { return static_cast<AutoMixImpl*>(am)->state.load(); }

int automix_current_path(AutoMix am, char* out, int cap) {
  auto* a = static_cast<AutoMixImpl*>(am);
  std::lock_guard<std::mutex> lk(a->infoMu);
  if (a->currentPath.empty() || cap <= 0) {
    if (cap > 0) out[0] = 0;
    return 0;
  }
  std::snprintf(out, (size_t)cap, "%s", a->currentPath.c_str());
  return 1;
}

double automix_get_transition_time(AutoMix am) {
  return static_cast<AutoMixImpl*>(am)->transitionTime.load();
}

int automix_get_mode(AutoMix am) { return static_cast<AutoMixImpl*>(am)->mode.load(); }

int automix_from_deck(AutoMix am) { return static_cast<AutoMixImpl*>(am)->fromDeck; }

}  // extern "C"
