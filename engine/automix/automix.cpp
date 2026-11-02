// AutoMix — port del Auto DJ de Mixxx (issue M3). Ver docs del port.
// Máquina de estados + cálculo de transición + avance del crossfader por posición.

#include "automix.h"

#include "platform_log.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
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
  std::thread th;

  // Estado por deck (sustituye DeckAttributes).
  double deckFirst[2] = {0.0, 0.0};
  double deckLast[2] = {-1.0, -1.0};
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
    deckLoaded[d] = true;
    {
      std::lock_guard<std::mutex> lk(infoMu);
      deckPath[d] = path;
    }
    dj_seek(engine, d, first);  // cue al primer sonido
    LOGI("automix: pista en deck %d (dur=%.1f first=%.2f last=%.2f bpm=%.1f)", d,
         dj_duration(engine, d), first, deckLast[d], dj_get_bpm(engine, d));
    return true;
  }

  void computeTransition() {
    const double dur = dj_duration(engine, fromDeck);
    const double fadeEnd =
        mode.load() == 1 ? dur : (deckLast[fromDeck] > 0 ? deckLast[fromDeck] : dur);
    double fadeBegin = fadeEnd - transitionTime.load();
    if (fadeBegin < 0) fadeBegin = 0;
    fadeBeginSec = fadeBegin;
    fadeEndSec = fadeEnd;
    const int toDeck = 1 - fromDeck;
    toStartSec = deckLoaded[toDeck] ? deckFirst[toDeck] : 0.0;
  }

  void syncTempo(int fromD, int toD) {
    const float bf = dj_get_bpm(engine, fromD), bt = dj_get_bpm(engine, toD);
    if (bf > 0 && bt > 0) {
      const double r = (double)bf / bt;
      if (r >= 0.94 && r <= 1.06) {
        dj_set_keylock(engine, toD, 1);
        dj_set_rate(engine, toD, (float)r);
      }
    }
  }

  void loop() {
    fromDeck = 0;
    if (!loadInto(0)) {
      LOGE("automix: sin pista inicial");
      state = ST_DISABLED;
      running = false;
      return;
    }
    dj_seek(engine, 0, deckFirst[0]);
    dj_set_xfader(engine, 0.0f);  // deck 0 a tope
    dj_play(engine, 0, 1);
    {
      std::lock_guard<std::mutex> lk(infoMu);
      currentPath = deckPath[0];
    }
    loadInto(1);  // precarga deck 1 (cued)
    computeTransition();
    state = ST_IDLE;

    while (running.load()) {
      const double pos = dj_position(engine, fromDeck);
      const bool playing = dj_playing(engine, fromDeck) != 0;

      if (skipReq.exchange(false)) {
        fadeBeginSec = pos;
        fadeEndSec = pos + std::min(transitionTime.load(), 4.0);
      }

      if (state.load() == ST_IDLE) {
        if (!playing || pos >= fadeBeginSec) {
          const int toDeck = 1 - fromDeck;
          if (!deckLoaded[toDeck]) {
            if (!loadInto(toDeck)) {
              std::this_thread::sleep_for(std::chrono::milliseconds(200));
              continue;
            }
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
          loadInto(oldFrom);  // precarga la siguiente en el deck liberado
          computeTransition();
          LOGI("automix: fin transición; ahora suena deck %d", fromDeck);
          state = ST_IDLE;
        }
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    state = ST_DISABLED;
  }
};

}  // namespace

extern "C" {

AutoMix automix_create(DjEngine engine) {
  auto* a = new AutoMixImpl();
  a->engine = engine;
  return a;
}

void automix_destroy(AutoMix am) {
  auto* a = static_cast<AutoMixImpl*>(am);
  if (!a) return;
  a->running = false;
  if (a->th.joinable()) a->th.join();
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
  if (on) {
    if (a->running.load()) return 1;
    a->running = true;
    a->th = std::thread([a] { a->loop(); });
  } else {
    a->running = false;
    if (a->th.joinable()) a->th.join();
  }
  return 1;
}

void automix_skip(AutoMix am) { static_cast<AutoMixImpl*>(am)->skipReq = true; }

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
