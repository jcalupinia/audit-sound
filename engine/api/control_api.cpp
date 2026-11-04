// Control API (issues M5 + mezcladora manual) con libmicrohttpd.

#include "control_api.h"

#include <microhttpd.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <ctime>
#include <map>
#include <mutex>
#include <random>
#include <string>
#include <vector>

#include "platform_log.hpp"

namespace {

constexpr long SESSION_TTL_SECONDS = 7200;  // sesiones inactivas se purgan tras 2 h

// --- Endurecimiento (Etapa A / A1.3) ---
// Rate limit de /api/login: máx. intentos por IP en una ventana deslizante.
constexpr int LOGIN_MAX_ATTEMPTS = 8;
constexpr long LOGIN_WINDOW_SECONDS = 300;  // 5 min

// Allowlist de orígenes CORS, tomada de AUDIT_SOUND_API_ORIGIN (lista separada por
// comas) en el arranque. Vacía → se mantiene el comodín "*" (retrocompat; el token
// NO viaja en cookie, así que "*" no expone credenciales de navegador, pero acotar
// el origen es mejor práctica). Con uno o más orígenes, solo se refleja el que
// coincida con la cabecera Origin de la petición.
std::vector<std::string> g_cors_origins;

struct Catalog {
  std::vector<std::string> titles;
  std::vector<std::string> paths;
};

// M6 — una sesión por dispositivo.
struct Session {
  std::string name;
  time_t last = 0;
};

struct Api {
  struct MHD_Daemon* daemon = nullptr;
  DjEngine engine = nullptr;
  AutoMix automix = nullptr;
  std::string user, pass;
  std::map<std::string, Session> sessions;  // token -> sesión
  std::string controller;                    // token del controlador activo ("" = ninguno)
  std::map<std::string, std::vector<time_t>> loginAttempts;  // IP -> timestamps (rate limit)
  Catalog cat;
  std::mutex mu;
  bool manual = false;
  float xfader = 0.5f;
  std::string deckTitle[2];

  // Nombre del controlador actual (vacío si no hay o si su sesión caducó).
  std::string controllerName() {
    auto it = sessions.find(controller);
    return it == sessions.end() ? std::string() : it->second.name;
  }
};

std::string randomToken() {
  static const char* hx = "0123456789abcdef";
  // RNG sembrado UNA sola vez: reseeding por llamada con time() daba tokens
  // idénticos a dos logins en el mismo segundo (rompía las sesiones por dispositivo, M6).
  static std::mutex seedMu;
  static std::mt19937_64 rng(std::random_device{}() ^
                             (uint64_t)std::chrono::high_resolution_clock::now()
                                 .time_since_epoch()
                                 .count());
  std::lock_guard<std::mutex> lk(seedMu);
  std::string s;
  for (int i = 0; i < 32; ++i) s += hx[rng() & 0xf];
  return s;
}

std::string jsonEsc(const std::string& in) {
  std::string o;
  for (char c : in) {
    if (c == '"' || c == '\\') o += '\'';
    else if ((unsigned char)c < 0x20) o += ' ';
    else o += c;
  }
  return o;
}

// Comparación en tiempo constante (no revela la longitud ni corta en el primer
// byte distinto): evita un canal lateral de temporización sobre user/pass.
bool ctEqual(const std::string& a, const std::string& b) {
  const size_t n = a.size() > b.size() ? a.size() : b.size();
  unsigned char diff = (unsigned char)(a.size() ^ b.size());
  for (size_t i = 0; i < n; ++i) {
    unsigned char ca = i < a.size() ? (unsigned char)a[i] : 0;
    unsigned char cb = i < b.size() ? (unsigned char)b[i] : 0;
    diff |= (unsigned char)(ca ^ cb);
  }
  return diff == 0;
}

// Cabecera HTTP (devuelve nullptr si no está).
const char* hdr(struct MHD_Connection* c, const char* key) {
  return MHD_lookup_connection_value(c, MHD_HEADER_KIND, key);
}

// Token de sesión: se prefiere `Authorization: Bearer <token>` (no viaja en la
// URL → no se filtra por Referer ni por logs intermedios). Se acepta el query
// `?token=` solo como respaldo retrocompatible.
std::string authToken(struct MHD_Connection* c) {
  const char* a = hdr(c, "Authorization");
  if (a) {
    const char* pfx = "Bearer ";
    if (0 == std::strncmp(a, pfx, 7) && a[7]) return std::string(a + 7);
  }
  const char* q = MHD_lookup_connection_value(c, MHD_GET_ARGUMENT_KIND, "token");
  return q ? std::string(q) : std::string();
}

// IP del cliente para el rate limit. Detrás del proxy (nginx/Coolify) la IP real
// llega en X-Forwarded-For (primer salto); si no, se usa la dirección del socket.
std::string clientIp(struct MHD_Connection* c) {
  const char* xff = hdr(c, "X-Forwarded-For");
  if (xff && *xff) {
    std::string s(xff);
    size_t comma = s.find(',');
    std::string first = comma == std::string::npos ? s : s.substr(0, comma);
    size_t a = first.find_first_not_of(" \t");
    size_t b = first.find_last_not_of(" \t");
    if (a != std::string::npos) return first.substr(a, b - a + 1);
  }
  const union MHD_ConnectionInfo* info =
      MHD_get_connection_info(c, MHD_CONNECTION_INFO_CLIENT_ADDRESS);
  if (info && info->client_addr) {
    char host[64] = {0};
    const struct sockaddr* sa = info->client_addr;
    if (sa->sa_family == AF_INET) {
      const auto* s4 = reinterpret_cast<const struct sockaddr_in*>(sa);
      inet_ntop(AF_INET, &s4->sin_addr, host, sizeof(host));
    } else if (sa->sa_family == AF_INET6) {
      const auto* s6 = reinterpret_cast<const struct sockaddr_in6*>(sa);
      inet_ntop(AF_INET6, &s6->sin6_addr, host, sizeof(host));
    }
    if (host[0]) return std::string(host);
  }
  return std::string("unknown");
}

std::string basenameNoExt(const std::string& path) {
  size_t a = path.find_last_of('/');
  std::string b = a == std::string::npos ? path : path.substr(a + 1);
  size_t d = b.find_last_of('.');
  if (d != std::string::npos) b = b.substr(0, d);
  return jsonEsc(b);
}

const char* arg(struct MHD_Connection* c, const char* key) {
  return MHD_lookup_connection_value(c, MHD_GET_ARGUMENT_KIND, key);
}
int argi(struct MHD_Connection* c, const char* key, int def) {
  const char* v = arg(c, key);
  return v ? std::atoi(v) : def;
}
double argf(struct MHD_Connection* c, const char* key, double def) {
  const char* v = arg(c, key);
  return v ? std::atof(v) : def;
}

MHD_Result reply(struct MHD_Connection* c, int code, const std::string& body) {
  struct MHD_Response* r =
      MHD_create_response_from_buffer(body.size(), (void*)body.data(), MHD_RESPMEM_MUST_COPY);
  MHD_add_response_header(r, "Content-Type", "application/json");
  // CORS: con allowlist configurada, se refleja SOLO el Origin que coincida
  // (y nada si no coincide → el navegador bloquea). Sin allowlist, "*" (retrocompat).
  if (g_cors_origins.empty()) {
    MHD_add_response_header(r, "Access-Control-Allow-Origin", "*");
  } else {
    const char* origin = MHD_lookup_connection_value(c, MHD_HEADER_KIND, "Origin");
    if (origin && std::find(g_cors_origins.begin(), g_cors_origins.end(),
                            std::string(origin)) != g_cors_origins.end()) {
      MHD_add_response_header(r, "Access-Control-Allow-Origin", origin);
      MHD_add_response_header(r, "Vary", "Origin");
    }
  }
  MHD_add_response_header(r, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  MHD_add_response_header(r, "Access-Control-Allow-Headers", "Content-Type, Authorization");
  MHD_Result ret = MHD_queue_response(c, code, r);
  MHD_destroy_response(r);
  return ret;
}

std::string deckJson(Api* api, int d) {
  DjEngine e = api->engine;
  // En modo auto, el título de la pista que suena viene del AutoMix.
  std::string title = api->deckTitle[d];
  if (!api->manual && automix_from_deck(api->automix) == d) {
    char p[4096];
    p[0] = 0;
    if (automix_current_path(api->automix, p, (int)sizeof(p))) title = basenameNoExt(p);
  }
  char buf[640];
  std::snprintf(buf, sizeof(buf),
                "{\"title\":\"%s\",\"loaded\":%d,\"playing\":%d,\"pos\":%.2f,\"dur\":%.2f,"
                "\"bpm\":%.1f,\"key\":%d}",
                title.c_str(), dj_loaded(e, d), dj_playing(e, d), dj_position(e, d),
                dj_duration(e, d), dj_get_bpm(e, d), dj_get_key(e, d));
  return buf;
}

MHD_Result handler(void* cls, struct MHD_Connection* c, const char* url, const char* method,
                   const char*, const char*, size_t* upload_size, void** con_cls) {
  auto* api = static_cast<Api*>(cls);
  if (0 == std::strcmp(method, "OPTIONS")) return reply(c, 200, "{}");
  if (*con_cls == nullptr) { *con_cls = (void*)1; return MHD_YES; }
  if (0 == std::strcmp(method, "POST") && *upload_size != 0) { *upload_size = 0; return MHD_YES; }

  const std::string path = url;

  if (path == "/api/login" && 0 == std::strcmp(method, "POST")) {
    // Rate limit por IP (anti fuerza bruta): ventana deslizante bajo el lock.
    const std::string ip = clientIp(c);
    {
      std::lock_guard<std::mutex> lk(api->mu);
      const time_t now = time(nullptr);
      auto& hits = api->loginAttempts[ip];
      hits.erase(std::remove_if(hits.begin(), hits.end(),
                                [&](time_t t) { return now - t > LOGIN_WINDOW_SECONDS; }),
                 hits.end());
      if ((int)hits.size() >= LOGIN_MAX_ATTEMPTS)
        return reply(c, 429, "{\"error\":\"demasiados intentos; espera unos minutos\"}");
      hits.push_back(now);
    }
    const char* u = arg(c, "user");
    const char* p = arg(c, "pass");
    // Comparación en tiempo constante; se evalúan ambos campos siempre.
    const bool okUser = u && ctEqual(api->user, u);
    const bool okPass = p && ctEqual(api->pass, p);
    if (!(okUser && okPass))
      return reply(c, 401, "{\"error\":\"credenciales inválidas\"}");
    const char* nm = arg(c, "name");
    const std::string name = (nm && nm[0]) ? jsonEsc(nm) : std::string("Dispositivo");
    std::lock_guard<std::mutex> lk(api->mu);
    const time_t now = time(nullptr);
    for (auto it = api->sessions.begin(); it != api->sessions.end();) {  // purgar inactivas
      if (now - it->second.last > SESSION_TTL_SECONDS) {
        if (api->controller == it->first) api->controller.clear();
        it = api->sessions.erase(it);
      } else {
        ++it;
      }
    }
    const std::string t = randomToken();
    api->sessions[t] = Session{name, now};
    if (api->controller.empty()) api->controller = t;  // el primero en entrar toma el control
    const bool youCtl = (api->controller == t);
    return reply(c, 200, "{\"token\":\"" + t + "\",\"name\":\"" + name +
                             "\",\"youAreController\":" + (youCtl ? "true" : "false") + "}");
  }

  // A partir de aquí todo requiere un token de sesión válido. Un único lock cubre
  // la validación y el manejo (los handlers ya NO toman el lock por separado).
  std::lock_guard<std::mutex> lk(api->mu);
  const std::string tok = authToken(c);  // Authorization: Bearer … (o ?token= legado)
  auto sit = tok.empty() ? api->sessions.end() : api->sessions.find(tok);
  if (sit == api->sessions.end()) return reply(c, 401, "{\"error\":\"no autorizado\"}");
  sit->second.last = time(nullptr);

  if (path == "/api/control/take" && 0 == std::strcmp(method, "POST")) {
    api->controller = tok;  // handoff: este dispositivo toma el control
    return reply(c, 200, "{\"ok\":true,\"controller\":\"" + sit->second.name + "\"}");
  }
  if (path == "/api/control/release" && 0 == std::strcmp(method, "POST")) {
    if (api->controller == tok) api->controller.clear();
    return reply(c, 200, "{\"ok\":true}");
  }

  if (path == "/api/tracks" && 0 == std::strcmp(method, "GET")) {
    std::string out = "{\"tracks\":[";
    for (size_t i = 0; i < api->cat.titles.size(); ++i) {
      if (i) out += ",";
      out += "{\"i\":" + std::to_string(i) + ",\"title\":\"" + jsonEsc(api->cat.titles[i]) + "\"}";
    }
    out += "]}";
    return reply(c, 200, out);
  }

  if (path == "/api/status" && 0 == std::strcmp(method, "GET")) {
    const std::string cn = api->controllerName();          // M6: quién controla
    const bool youCtl = (api->controller == tok);
    char head[512];
    std::snprintf(head, sizeof(head),
                  "{\"mode\":\"%s\",\"xfader\":%.3f,\"state\":%d,\"transition\":%.1f,"
                  "\"mixmode\":%d,\"controller\":\"%s\",\"youAreController\":%s,\"decks\":[",
                  api->manual ? "manual" : "auto", api->xfader, automix_state(api->automix),
                  automix_get_transition_time(api->automix), automix_get_mode(api->automix),
                  cn.c_str(), youCtl ? "true" : "false");
    std::string out = head;
    out += deckJson(api, 0) + "," + deckJson(api, 1) + "]}";
    return reply(c, 200, out);
  }

  if (path == "/api/command" && 0 == std::strcmp(method, "POST")) {
    const char* action = arg(c, "action");
    if (!action) return reply(c, 400, "{\"error\":\"falta action\"}");
    // M6: solo el dispositivo que tiene el control puede ejecutar comandos.
    if (api->controller != tok)
      return reply(c, 409,
                   "{\"error\":\"control_held\",\"controller\":\"" + api->controllerName() + "\"}");
    DjEngine e = api->engine;
    const int d = argi(c, "deck", 0) == 1 ? 1 : 0;

    if (0 == std::strcmp(action, "set_mode_dj")) {
      const char* v = arg(c, "value");
      const bool manual = v && 0 == std::strcmp(v, "manual");
      api->manual = manual;
      automix_enable(api->automix, manual ? 0 : 1);
      if (manual) {  // cargar 2 pistas para empezar
        if (api->cat.paths.size() >= 1 && !api->deckTitle[0].size()) {
          dj_load(e, 0, api->cat.paths[0].c_str());
          api->deckTitle[0] = api->cat.titles[0];
        }
        if (api->cat.paths.size() >= 2 && !api->deckTitle[1].size()) {
          dj_load(e, 1, api->cat.paths[1].c_str());
          api->deckTitle[1] = api->cat.titles[1];
        }
        api->xfader = 0.5f;
        dj_set_xfader(e, 0.5f);
      }
    } else if (0 == std::strcmp(action, "deck_load")) {
      const int t = argi(c, "track", -1);
      if (t >= 0 && t < (int)api->cat.paths.size()) {
        dj_load(e, d, api->cat.paths[t].c_str());
        api->deckTitle[d] = api->cat.titles[t];
      }
    } else if (0 == std::strcmp(action, "deck_play")) {
      dj_play(e, d, 1);
    } else if (0 == std::strcmp(action, "deck_pause")) {
      dj_play(e, d, 0);
    } else if (0 == std::strcmp(action, "deck_cue")) {
      dj_play(e, d, 0);
      dj_jump_cue(e, d);
    } else if (0 == std::strcmp(action, "deck_set_cue")) {
      dj_set_cue(e, d);
    } else if (0 == std::strcmp(action, "xfader")) {
      api->xfader = (float)argf(c, "value", 0.5);
      dj_set_xfader(e, api->xfader);
    } else if (0 == std::strcmp(action, "eq")) {
      dj_set_eq(e, d, (float)argf(c, "low", 0), (float)argf(c, "mid", 0),
                (float)argf(c, "high", 0));
    } else if (0 == std::strcmp(action, "filter")) {
      dj_set_filter(e, d, (float)argf(c, "value", 0));
    } else if (0 == std::strcmp(action, "rate")) {
      dj_set_rate(e, d, (float)argf(c, "value", 1.0));
    } else if (0 == std::strcmp(action, "gain")) {
      dj_set_gain(e, d, (float)argf(c, "value", 1.0));
    } else if (0 == std::strcmp(action, "skip")) {
      automix_skip(api->automix);
    } else if (0 == std::strcmp(action, "set_transition")) {
      automix_set_transition_time(api->automix, argf(c, "value", 8));
    } else if (0 == std::strcmp(action, "set_mode")) {
      automix_set_mode(api->automix, argi(c, "value", 0));
    } else {
      return reply(c, 400, "{\"error\":\"acción desconocida\"}");
    }
    return reply(c, 200, "{\"ok\":true}");
  }

  return reply(c, 404, "{\"error\":\"no encontrado\"}");
}

}  // namespace

extern "C" {

ControlApi control_api_start(int port, const char* user, const char* pass, DjEngine engine,
                             AutoMix automix) {
  auto* api = new Api();
  api->engine = engine;
  api->automix = automix;
  api->user = user ? user : "";
  api->pass = pass ? pass : "";
  // Allowlist CORS desde AUDIT_SOUND_API_ORIGIN (lista separada por comas). Vacía → "*".
  g_cors_origins.clear();
  if (const char* env = std::getenv("AUDIT_SOUND_API_ORIGIN")) {
    std::string s(env), tok;
    for (size_t i = 0; i <= s.size(); ++i) {
      if (i == s.size() || s[i] == ',') {
        size_t a = tok.find_first_not_of(" \t");
        size_t b = tok.find_last_not_of(" \t");
        if (a != std::string::npos) {
          std::string o = tok.substr(a, b - a + 1);
          while (!o.empty() && o.back() == '/') o.pop_back();  // sin barra final
          if (!o.empty()) g_cors_origins.push_back(o);
        }
        tok.clear();
      } else {
        tok += s[i];
      }
    }
  }
  api->daemon = MHD_start_daemon(MHD_USE_INTERNAL_POLLING_THREAD, (uint16_t)port, nullptr,
                                 nullptr, &handler, api, MHD_OPTION_END);
  if (!api->daemon) {
    LOGE("control_api: no se pudo iniciar en el puerto %d", port);
    delete api;
    return nullptr;
  }
  LOGI("control_api: escuchando en el puerto %d", port);
  return api;
}

void control_api_add_track(ControlApi h, const char* title, const char* path) {
  auto* api = static_cast<Api*>(h);
  if (!api || !title || !path) return;
  std::lock_guard<std::mutex> lk(api->mu);
  api->cat.titles.push_back(title);
  api->cat.paths.push_back(path);
}

void control_api_stop(ControlApi h) {
  auto* api = static_cast<Api*>(h);
  if (!api) return;
  if (api->daemon) MHD_stop_daemon(api->daemon);
  delete api;
}

}  // extern "C"
