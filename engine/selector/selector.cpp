// Selector musical inteligente (issue M4). Ver docs/SELECTOR_MUSICAL_INTELIGENTE.md.

#include "selector.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <random>
#include <unordered_map>
#include <vector>

namespace {

// --- Camelot (portado de lib/engine/music_utils.dart) ---
struct Camelot {
  int number = 0;
  bool minor = false;
  bool valid = false;
};
Camelot camelot(int key) {
  // Número Camelot de cada clase de altura 0..11 en mayor.
  static const int majNum[12] = {8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1};
  if (key < 0 || key > 23) return {0, false, false};
  if (key <= 11) return {majNum[key], false, true};
  const int root = key - 12;  // menor
  return {majNum[(root + 3) % 12], true, true};
}
bool keysCompatible(int a, int b) {
  const Camelot x = camelot(a), y = camelot(b);
  if (!x.valid || !y.valid) return false;
  if (x.number == y.number) return true;  // mismo número o relativa mayor/menor
  const int dn = std::abs(x.number - y.number);
  return x.minor == y.minor && (dn == 1 || dn == 11);
}
// Armonía: 1.0 compatible, 0.5 dominante/subdominante mismo modo, 0.0 choca,
// 0.5 si falta la tonalidad (neutro, no penaliza).
double harmonyScore(int ref, int cand) {
  if (ref < 0 || cand < 0) return 0.5;
  if (keysCompatible(ref, cand)) return 1.0;
  const Camelot x = camelot(ref), y = camelot(cand);
  if (x.valid && y.valid && x.minor == y.minor) {
    const int dn = std::abs(x.number - y.number);
    if (dn == 5 || dn == 7) return 0.5;  // dominante/subdominante
  }
  return 0.0;
}

double tempoScore(float refBpm, float candBpm) {
  if (refBpm <= 0 || candBpm <= 0) return 0.5;
  const double d = std::fabs(candBpm - refBpm) / refBpm;
  if (d <= 0.06) return 1.0;
  if (d <= 0.12) return 0.6;
  const double dHalf = std::fabs(candBpm - refBpm * 2.0) / (refBpm * 2.0);
  const double dDouble = std::fabs(candBpm - refBpm * 0.5) / (refBpm * 0.5);
  if (dHalf <= 0.06 || dDouble <= 0.06) return 0.5;
  return 0.0;
}

}  // namespace

struct Track {
  std::string path;
  float bpm = 0;
  int key = -1;
  float energy = 0;
};

struct Selector::Impl {
  SelectorConfig cfg;
  std::vector<Track> tracks;
  std::unordered_map<std::string, int> timesPlayed;
  std::deque<std::string> recent;  // últimas elecciones (cooldown)
  int refIdx = -1;                 // índice de la última entregada (referencia)
  std::mt19937 rng{std::random_device{}()};

  bool inCooldown(const std::string& path) const {
    return std::find(recent.begin(), recent.end(), path) != recent.end();
  }

  double score(const Track& ref, const Track& c) const {
    const double h = harmonyScore(ref.key, c.key);
    const double t = tempoScore(ref.bpm, c.bpm);
    const double e = 1.0 - std::min(1.0, std::fabs((double)c.energy - (double)ref.energy));
    auto it = timesPlayed.find(c.path);
    const int tp = it == timesPlayed.end() ? 0 : it->second;
    const double f = 1.0 / (1.0 + tp);
    return cfg.wHarmony * h + cfg.wTempo * t + cfg.wEnergy * e + cfg.wFresh * f;
  }

  int pickFirst() {
    if (tracks.empty()) return -1;
    std::uniform_int_distribution<size_t> d(0, tracks.size() - 1);
    return (int)d(rng);
  }

  int pickNext() {
    if (tracks.empty()) return -1;
    if (refIdx < 0) return pickFirst();
    const Track& ref = tracks[refIdx];
    // Filtro duro: fuera de cooldown (y distinto de la referencia).
    std::vector<std::pair<double, int>> cands;
    for (int i = 0; i < (int)tracks.size(); ++i) {
      if (i == refIdx) continue;
      if (inCooldown(tracks[i].path)) continue;
      cands.emplace_back(score(ref, tracks[i]), i);
    }
    if (cands.empty()) {  // todo en cooldown: relajar, usar todos menos ref
      for (int i = 0; i < (int)tracks.size(); ++i)
        if (i != refIdx) cands.emplace_back(score(ref, tracks[i]), i);
    }
    if (cands.empty()) return refIdx;  // solo hay una pista
    std::sort(cands.begin(), cands.end(),
              [](auto& a, auto& b) { return a.first > b.first; });
    const int n = std::min((int)cands.size(), cfg.topN);
    // Muestreo ponderado por score^(1/T) entre el top-N.
    const double invT = cfg.temperature > 1e-3 ? 1.0 / cfg.temperature : 1000.0;
    std::vector<double> w(n);
    double sum = 0;
    for (int i = 0; i < n; ++i) {
      w[i] = std::pow(std::max(1e-6, cands[i].first), invT);
      sum += w[i];
    }
    std::uniform_real_distribution<double> ud(0.0, sum);
    double r = ud(rng);
    int chosen = cands[0].second;
    for (int i = 0; i < n; ++i) {
      r -= w[i];
      if (r <= 0) { chosen = cands[i].second; break; }
    }
    return chosen;
  }

  std::string next() {
    const int idx = pickNext();
    if (idx < 0) return "";
    refIdx = idx;
    const std::string& path = tracks[idx].path;
    timesPlayed[path]++;
    recent.push_back(path);
    const int cd = std::min(cfg.cooldown, (int)tracks.size() - 1);
    while ((int)recent.size() > cd && cd > 0) recent.pop_front();
    if (cd <= 0) recent.clear();
    return path;
  }
};

Selector::Selector(SelectorConfig cfg) : p_(new Impl()) { p_->cfg = cfg; }
Selector::~Selector() { delete p_; }

void Selector::addTrack(const std::string& path, float bpm, int key, float energy) {
  p_->tracks.push_back({path, bpm, key, energy});
}
std::size_t Selector::size() const { return p_->tracks.size(); }
std::string Selector::next() { return p_->next(); }

int Selector::nextTrackCb(void* user, char* out, int cap) {
  auto* s = static_cast<Selector*>(user);
  const std::string path = s->next();
  if (path.empty()) return 0;
  std::snprintf(out, (size_t)cap, "%s", path.c_str());
  return 1;
}
