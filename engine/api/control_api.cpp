// Control API (M5 + mezcladora manual + endurecimiento Etapa A/A4) con libmicrohttpd.
//
// Seguridad (A4.1):
//   S-01  Login por CUERPO POST (x-www-form-urlencoded); credenciales y token NUNCA
//         viajan en la URL. El token de sesión se envía en `Authorization: Bearer`.
//   S-02  CORS con denegación por defecto: sin allowlist no se emite Access-Control-
//         Allow-Origin (salvo opt-in explícito de desarrollo).
//   S-03  Transferencia de control con autorización: una sesión secundaria SOLICITA
//         el control; el controlador activo APRUEBA o RECHAZA. Sin controlador vivo,
//         el control queda libre y se puede tomar. La reproducción no se interrumpe.
//   S-04  Logout con revocación server-side del token (no reutilizable), caducidad de
//         sesiones, rate limit de login y cabecera de proxy confiable configurable.

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
#include <deque>
#include <unistd.h>
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
constexpr int LOGIN_MAX_ATTEMPTS = 8;       // rate limit de /api/login por IP
constexpr long LOGIN_WINDOW_SECONDS = 300;  // ventana de 5 min

// Config de seguridad tomada del entorno al arrancar.
std::vector<std::string> g_cors_origins;  // AUDIT_SOUND_API_ORIGIN (coma-separada)
bool g_cors_allow_all = false;            // AUDIT_SOUND_API_CORS_ALLOW_ALL=1 (solo dev)
bool g_trust_proxy = true;                // AUDIT_SOUND_API_TRUST_PROXY=false → ignora XFF

struct Catalog {
  std::vector<std::string> titles;
  std::vector<std::string> paths;
  // Fase 2 · B1: metadatos del análisis (meta[i]=0 → desconocidos para esa pista).
  std::vector<float> bpm, energy;
  std::vector<int> key;
  std::vector<double> dur;
  std::vector<char> meta;
  std::vector<std::string> genre;  // "" = sin género (generos.txt de la carpeta de música)
};

constexpr size_t AGENT_QUEUE_MAX = 50;

struct Session {
  std::string name;
  time_t last = 0;
};

// Buffer del cuerpo de la petición (POST). Se libera en el callback de término.
struct ReqCtx {
  std::string body;
  bool tooBig = false;  // cuerpo por encima de kMaxBody: se descarta y se responde 413
};
constexpr size_t kMaxBody = 256 * 1024;  // 256 KB: ~2,7 s de voz a 48 kHz por petición

struct Api {
  struct MHD_Daemon* daemon = nullptr;
  DjEngine engine = nullptr;
  AutoMix automix = nullptr;
  std::string user, pass;
  std::map<std::string, Session> sessions;  // token -> sesión
  std::string controller;                    // token del controlador activo ("" = ninguno)
  std::string pendingReq, pendingReqName;    // S-03: solicitud de control pendiente
  std::map<std::string, std::vector<time_t>> loginAttempts;  // IP -> timestamps
  Catalog cat;
  std::mutex mu;
  // Fase 2 · B2: cola del agente. Cerrojo PROPIO: lo toma el hilo del AutoMix (callback de
  // siguiente pista) sin depender del cerrojo de la API HTTP. Protege también 'cat'.
  std::deque<int> agentQueue;
  std::mutex queueMu;
  std::string queueJsonLocked() const {
    std::string o = "[";
    for (size_t i = 0; i < agentQueue.size(); ++i) o += (i ? "," : "") + std::to_string(agentQueue[i]);
    return o + "]";
  }
  bool manual = false;
  float xfader = 0.5f;
  std::string deckTitle[2];

  std::string controllerName() {
    auto it = sessions.find(controller);
    return it == sessions.end() ? std::string() : it->second.name;
  }
  bool controllerAlive() { return !controller.empty() && sessions.count(controller) != 0; }
  // Purga sesiones inactivas y libera el control/solicitud si su sesión caducó.
  void purge(time_t now) {
    for (auto it = sessions.begin(); it != sessions.end();) {
      if (now - it->second.last > SESSION_TTL_SECONDS) {
        if (controller == it->first) controller.clear();
        if (pendingReq == it->first) { pendingReq.clear(); pendingReqName.clear(); }
        it = sessions.erase(it);
      } else {
        ++it;
      }
    }
  }
  void logEvent(const std::string& e) { LOGI("control_api: %s", e.c_str()); }
};

std::string randomToken() {
  static const char* hx = "0123456789abcdef";
  static std::mutex seedMu;
  static std::mt19937_64 rng(std::random_device{}() ^
                             (uint64_t)std::chrono::high_resolution_clock::now()
                                 .time_since_epoch()
                                 .count());
  std::lock_guard<std::mutex> lk(seedMu);
  std::string s;
  for (int i = 0; i < 32; ++i) s += hx[rng() & 0xf];  // 128 bits
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

// Comparación en tiempo constante (sin canal lateral de temporización).
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

const char* hdr(struct MHD_Connection* c, const char* key) {
  return MHD_lookup_connection_value(c, MHD_HEADER_KIND, key);
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

// S-01: token SOLO desde `Authorization: Bearer <token>` (nunca desde la URL).
std::string authToken(struct MHD_Connection* c) {
  const char* a = hdr(c, "Authorization");
  if (a && 0 == std::strncmp(a, "Bearer ", 7) && a[7]) return std::string(a + 7);
  return std::string();
}

// Decodifica x-www-form-urlencoded (%XX y '+').
std::string urlDecode(const std::string& s) {
  std::string o;
  for (size_t i = 0; i < s.size(); ++i) {
    char ch = s[i];
    if (ch == '+') { o += ' '; }
    else if (ch == '%' && i + 2 < s.size()) {
      auto hexv = [](char h) -> int {
        if (h >= '0' && h <= '9') return h - '0';
        if (h >= 'a' && h <= 'f') return h - 'a' + 10;
        if (h >= 'A' && h <= 'F') return h - 'A' + 10;
        return -1;
      };
      int hi = hexv(s[i + 1]), lo = hexv(s[i + 2]);
      if (hi >= 0 && lo >= 0) { o += (char)((hi << 4) | lo); i += 2; }
      else o += ch;
    } else {
      o += ch;
    }
  }
  return o;
}

// Extrae un campo de un cuerpo application/x-www-form-urlencoded.
bool formField(const std::string& body, const std::string& key, std::string& out) {
  size_t i = 0;
  while (i < body.size()) {
    size_t amp = body.find('&', i);
    std::string pair = body.substr(i, amp == std::string::npos ? std::string::npos : amp - i);
    size_t eq = pair.find('=');
    std::string k = eq == std::string::npos ? pair : pair.substr(0, eq);
    if (urlDecode(k) == key) { out = eq == std::string::npos ? "" : urlDecode(pair.substr(eq + 1)); return true; }
    if (amp == std::string::npos) break;
    i = amp + 1;
  }
  return false;
}

// IP del cliente para el rate limit. Solo se confía en X-Forwarded-For si está
// habilitado el proxy confiable (detrás de nginx); si no, se usa el socket, para
// evitar que un cliente directo falsee su IP (S-04).
std::string clientIp(struct MHD_Connection* c) {
  if (g_trust_proxy) {
    const char* xff = hdr(c, "X-Forwarded-For");
    if (xff && *xff) {
      std::string s(xff);
      size_t comma = s.find(',');
      std::string first = comma == std::string::npos ? s : s.substr(0, comma);
      size_t a = first.find_first_not_of(" \t");
      size_t b = first.find_last_not_of(" \t");
      if (a != std::string::npos) return first.substr(a, b - a + 1);
    }
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

bool originAllowed(const std::string& o) {
  return std::find(g_cors_origins.begin(), g_cors_origins.end(), o) != g_cors_origins.end();
}

// S-02: CORS con denegación por defecto. Access-Control-Allow-Origin solo si el
// Origin está en la allowlist (o, en dev, con el opt-in explícito "*").
MHD_Result reply(struct MHD_Connection* c, int code, const std::string& body) {
  struct MHD_Response* r =
      MHD_create_response_from_buffer(body.size(), (void*)body.data(), MHD_RESPMEM_MUST_COPY);
  MHD_add_response_header(r, "Content-Type", "application/json");
  const char* origin = hdr(c, "Origin");
  std::string acao;
  if (g_cors_allow_all) acao = "*";
  else if (origin && originAllowed(std::string(origin))) acao = origin;
  if (!acao.empty()) {
    MHD_add_response_header(r, "Access-Control-Allow-Origin", acao.c_str());
    if (acao != "*") MHD_add_response_header(r, "Vary", "Origin");
  }
  MHD_add_response_header(r, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  MHD_add_response_header(r, "Access-Control-Allow-Headers", "Content-Type, Authorization");
  MHD_Result ret = MHD_queue_response(c, code, r);
  MHD_destroy_response(r);
  return ret;
}

std::string deckJson(Api* api, int d) {
  DjEngine e = api->engine;
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
                   const char*, const char* upload_data, size_t* upload_size, void** con_cls) {
  auto* api = static_cast<Api*>(cls);

  // Primera llamada: reservar contexto de petición (acumula el cuerpo POST).
  if (*con_cls == nullptr) { *con_cls = new ReqCtx(); return MHD_YES; }
  auto* ctx = static_cast<ReqCtx*>(*con_cls);

  // Acumular el cuerpo del POST entre invocaciones.
  if (0 == std::strcmp(method, "POST") && *upload_size != 0) {
    if (ctx->body.size() + *upload_size > kMaxBody) ctx->tooBig = true;
    else ctx->body.append(upload_data, *upload_size);
    *upload_size = 0;
    return MHD_YES;
  }
  if (ctx->tooBig) return reply(c, 413, "{\"error\":\"cuerpo demasiado grande\"}");

  const std::string path = url;
  if (0 == std::strcmp(method, "OPTIONS")) return reply(c, 200, "{}");

  // --- S-01: Login por cuerpo POST (x-www-form-urlencoded) ---
  if (path == "/api/login" && 0 == std::strcmp(method, "POST")) {
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
    std::string u, p, nm;
    formField(ctx->body, "user", u);
    formField(ctx->body, "pass", p);
    formField(ctx->body, "name", nm);
    const bool okUser = ctEqual(api->user, u);
    const bool okPass = ctEqual(api->pass, p);
    if (!(okUser && okPass))
      return reply(c, 401, "{\"error\":\"credenciales inválidas\"}");  // sin eco de la credencial
    const std::string name = nm.empty() ? std::string("Dispositivo") : jsonEsc(nm);
    std::lock_guard<std::mutex> lk(api->mu);
    const time_t now = time(nullptr);
    api->purge(now);
    const std::string t = randomToken();
    api->sessions[t] = Session{name, now};
    if (!api->controllerAlive()) api->controller = t;  // primero en entrar toma el control
    const bool youCtl = (api->controller == t);
    api->logEvent("login sesión=" + name + (youCtl ? " (controlador)" : ""));
    return reply(c, 200, "{\"token\":\"" + t + "\",\"name\":\"" + name +
                             "\",\"youAreController\":" + (youCtl ? "true" : "false") + "}");
  }

  // --- A partir de aquí todo exige token de sesión válido (Bearer) ---
  std::lock_guard<std::mutex> lk(api->mu);
  api->purge(time(nullptr));  // recupera control si el controlador se desconectó (TTL)
  const std::string tok = authToken(c);
  auto sit = tok.empty() ? api->sessions.end() : api->sessions.find(tok);
  if (sit == api->sessions.end()) return reply(c, 401, "{\"error\":\"no autorizado\"}");
  sit->second.last = time(nullptr);

  // --- S-04: Logout con revocación server-side ---
  if (path == "/api/logout" && 0 == std::strcmp(method, "POST")) {
    if (api->controller == tok) api->controller.clear();
    if (api->pendingReq == tok) { api->pendingReq.clear(); api->pendingReqName.clear(); }
    const std::string nm = sit->second.name;
    api->sessions.erase(sit);  // el token queda revocado (no reutilizable)
    api->logEvent("logout sesión=" + nm);
    return reply(c, 200, "{\"ok\":true}");
  }

  // --- S-03: Transferencia de control con autorización ---
  if (path == "/api/control/take" && 0 == std::strcmp(method, "POST")) {
    // Si hay un controlador VIVO distinto, no se puede arrebatar: hay que solicitar.
    if (api->controllerAlive() && api->controller != tok)
      return reply(c, 409, "{\"error\":\"control_held\",\"controller\":\"" +
                               api->controllerName() + "\",\"hint\":\"usa /api/control/request\"}");
    api->controller = tok;  // no había controlador vivo → lo toma
    api->pendingReq.clear(); api->pendingReqName.clear();
    api->logEvent("control tomado por " + sit->second.name);
    return reply(c, 200, "{\"ok\":true,\"controller\":\"" + sit->second.name + "\"}");
  }
  if (path == "/api/control/request" && 0 == std::strcmp(method, "POST")) {
    if (!api->controllerAlive()) {  // nadie controla → concede directo
      api->controller = tok;
      api->logEvent("control concedido (libre) a " + sit->second.name);
      return reply(c, 200, "{\"status\":\"granted\"}");
    }
    if (api->controller == tok) return reply(c, 200, "{\"status\":\"granted\"}");  // ya controla
    api->pendingReq = tok;
    api->pendingReqName = sit->second.name;
    api->logEvent("solicitud de control de " + sit->second.name);
    return reply(c, 200, "{\"status\":\"requested\",\"controller\":\"" + api->controllerName() + "\"}");
  }
  if (path == "/api/control/approve" && 0 == std::strcmp(method, "POST")) {
    if (api->controller != tok) return reply(c, 403, "{\"error\":\"solo el controlador aprueba\"}");
    if (api->pendingReq.empty() || !api->sessions.count(api->pendingReq))
      return reply(c, 409, "{\"error\":\"no hay solicitud pendiente\"}");
    const std::string newName = api->pendingReqName;
    api->controller = api->pendingReq;  // transfiere (la reproducción no se toca)
    api->pendingReq.clear(); api->pendingReqName.clear();
    api->logEvent("control transferido a " + newName);
    return reply(c, 200, "{\"ok\":true,\"controller\":\"" + jsonEsc(newName) + "\"}");
  }
  if (path == "/api/control/deny" && 0 == std::strcmp(method, "POST")) {
    if (api->controller != tok) return reply(c, 403, "{\"error\":\"solo el controlador rechaza\"}");
    api->pendingReq.clear(); api->pendingReqName.clear();
    api->logEvent("solicitud de control rechazada");
    return reply(c, 200, "{\"ok\":true}");
  }
  if (path == "/api/control/release" && 0 == std::strcmp(method, "POST")) {
    if (api->controller == tok) api->controller.clear();
    api->pendingReq.clear(); api->pendingReqName.clear();
    api->logEvent("control liberado");
    return reply(c, 200, "{\"ok\":true}");
  }

  if (path == "/api/tracks" && 0 == std::strcmp(method, "GET")) {
    std::lock_guard<std::mutex> lq(api->queueMu);
    const Catalog& k = api->cat;
    bool all = !k.titles.empty();
    std::string out = "{\"tracks\":[";
    for (size_t i = 0; i < k.titles.size(); ++i) {
      if (i) out += ",";
      out += "{\"i\":" + std::to_string(i) + ",\"title\":\"" + jsonEsc(k.titles[i]) + "\"";
      if (k.meta[i]) {
        char m[160];
        std::snprintf(m, sizeof(m), ",\"bpm\":%.2f,\"key\":%d,\"energy\":%.4f,\"duration\":%.2f", k.bpm[i],
                      k.key[i], k.energy[i], k.dur[i]);
        out += m;
      } else {
        all = false;
      }
      if (i < k.genre.size() && !k.genre[i].empty()) out += ",\"genre\":\"" + jsonEsc(k.genre[i]) + "\"";
      out += "}";
    }
    out += std::string("],\"metadata\":") + (all ? "true" : "false") + "}";
    return reply(c, 200, out);
  }

  // Fase 2 · B2: estado de la cola del agente.
  if (path == "/api/queue" && 0 == std::strcmp(method, "GET")) {
    std::lock_guard<std::mutex> lq(api->queueMu);
    std::string out = "{\"queue\":[";
    for (size_t n = 0; n < api->agentQueue.size(); ++n) {
      const int i = api->agentQueue[n];
      out += (n ? "," : "") + std::string("{\"i\":") + std::to_string(i) + ",\"title\":\"" +
             jsonEsc(api->cat.titles[(size_t)i]) + "\"}";
    }
    out += std::string("],\"next_source\":\"") + (api->agentQueue.empty() ? "selector" : "agent") + "\"}";
    return reply(c, 200, out);
  }

  if (path == "/api/status" && 0 == std::strcmp(method, "GET")) {
    const std::string cn = api->controllerName();
    const bool youCtl = (api->controller == tok);
    // S-03: expone la solicitud pendiente para que el controlador la apruebe/rechace.
    const std::string pend = api->pendingReq.empty() ? std::string("") : jsonEsc(api->pendingReqName);
    char head[640];
    std::snprintf(head, sizeof(head),
                  "{\"mode\":\"%s\",\"xfader\":%.3f,\"state\":%d,\"transition\":%.1f,"
                  "\"mixmode\":%d,\"controller\":\"%s\",\"youAreController\":%s,"
                  "\"pendingRequest\":\"%s\",\"decks\":[",
                  api->manual ? "manual" : "auto", api->xfader, automix_state(api->automix),
                  automix_get_transition_time(api->automix), automix_get_mode(api->automix),
                  cn.c_str(), youCtl ? "true" : "false", pend.c_str());
    std::string out = head;
    out += deckJson(api, 0) + "," + deckJson(api, 1) + "]";
    {
      DjVoiceStatus vs{};
      dj_voice_status(api->engine, &vs);
      char vb[256];
      std::snprintf(vb, sizeof(vb),
                    ",\"voice\":{\"active\":%s,\"talkover\":%d,\"level_db\":%.1f,\"music_gain\":%.3f,"
                    "\"buffered_ms\":%d,\"received_s\":%.1f,\"underruns\":%u}",
                    vs.active ? "true" : "false", vs.talkover, vs.level_db, vs.music_gain, vs.buffered_ms,
                    vs.received_seconds, vs.underruns);
      out += vb;
      out += ",\"fx\":[";
      for (int b = 0; b < 2; ++b) {
        DjFxState fs{};
        dj_get_fx(api->engine, b, &fs);
        char fb[256];
        std::snprintf(fb, sizeof(fb),
                      "%s{\"bank\":%d,\"type\":\"%s\",\"target\":\"%s\",\"on\":%s,\"wet\":%.3f,\"param\":%.3f,"
                      "\"sync\":%s,\"active_wet\":%.3f}",
                      b ? "," : "", b + 1, fs.type, fs.target, fs.on ? "true" : "false", fs.wet, fs.param,
                      fs.sync ? "true" : "false", fs.active_wet);
        out += fb;
      }
      out += "]";
    }
    {
      std::lock_guard<std::mutex> lq(api->queueMu);
      out += ",\"queue\":" + api->queueJsonLocked() + ",\"next_source\":\"" +
             (api->agentQueue.empty() ? "selector" : "agent") + "\"";
    }
    out += "}";
    return reply(c, 200, out);
  }

  // Micrófonos del DJ en vivo: PCM 16 bits mono little-endian en el cuerpo, frecuencia en ?sr=.
  // Solo el controlador (el agente) puede enviar voz: nadie más mete audio en el stream.
  if (path == "/api/voice" && 0 == std::strcmp(method, "POST")) {
    if (api->controller != tok)
      return reply(c, 409,
                   "{\"error\":\"control_held\",\"controller\":\"" + api->controllerName() + "\"}");
    const int sr = argi(c, "sr", 48000);
    if (sr < 8000 || sr > 96000) return reply(c, 400, "{\"error\":\"sr inválido\"}");
    if (ctx->body.size() < 2 || ctx->body.size() % 2) return reply(c, 400, "{\"error\":\"PCM 16 bits mono\"}");
    std::vector<short> pcm(ctx->body.size() / 2);
    std::memcpy(pcm.data(), ctx->body.data(), pcm.size() * 2);
    const int n = dj_voice_push(api->engine, pcm.data(), (int)pcm.size(), sr);
    DjVoiceStatus st{};
    dj_voice_status(api->engine, &st);
    return reply(c, 200, "{\"ok\":true,\"accepted\":" + std::to_string(n) + ",\"buffered_ms\":" +
                             std::to_string(st.buffered_ms) + "}");
  }

  if (path == "/api/command" && 0 == std::strcmp(method, "POST")) {
    const char* action = arg(c, "action");
    if (!action) return reply(c, 400, "{\"error\":\"falta action\"}");
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
      if (manual) {
        // Fase 2 (bug corregido): antes se miraba deckTitle, que el AutoMix nunca rellena, y se
        // recargaba la pista 0 ENCIMA del plato que estaba sonando (cortaba el audio). Ahora solo se
        // cargan platos realmente vacíos y se conserva el título de lo que dejó sonando el AutoMix.
        const int from = automix_from_deck(api->automix);
        char cur[4096];
        cur[0] = 0;
        if (from >= 0 && from <= 1 && dj_loaded(e, from) && automix_current_path(api->automix, cur, (int)sizeof(cur)))
          api->deckTitle[from] = basenameNoExt(cur);
        if (api->cat.paths.size() >= 1 && !dj_loaded(e, 0)) {
          dj_load(e, 0, api->cat.paths[0].c_str());
          api->deckTitle[0] = api->cat.titles[0];
        }
        if (api->cat.paths.size() >= 2 && !dj_loaded(e, 1)) {
          dj_load(e, 1, api->cat.paths[1].c_str());
          api->deckTitle[1] = api->cat.titles[1];
        }
        // Fase 2: antes fijaba el crossfader en 0.5 siempre; si un plato está sonando eso
        // podía hacer audible de golpe el otro. Solo se centra si no suena nada.
        if (!dj_playing(e, 0) && !dj_playing(e, 1)) {
          api->xfader = 0.5f;
          dj_set_xfader(e, 0.5f);
        }
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
    } else if (0 == std::strcmp(action, "talkover")) {
      // value: 0 sin atenuar · 1 atenuar siempre · 2 automático; gain (voz, lineal) y duck (dB).
      dj_set_talkover(e, argi(c, "value", 2), (float)argf(c, "gain", -1.0), (float)argf(c, "duck", 1.0));
    } else if (0 == std::strcmp(action, "fx")) {
      // Banco de efectos: bank=1|2, type, target=A|B|master, on, wet, param, sync (todo opcional salvo bank).
      const int bank = argi(c, "bank", 0) - 1;
      const char* type = arg(c, "type");
      const char* target = arg(c, "target");
      const char* on = arg(c, "on");
      const char* sync = arg(c, "sync");
      const char* wet = arg(c, "wet");
      const char* param = arg(c, "param");
      if (!dj_set_fx(e, bank, type, target, on ? (std::atoi(on) != 0) : -1, wet ? (float)std::atof(wet) : -1.0f,
                     param ? (float)std::atof(param) : -1.0f, sync ? (std::atoi(sync) != 0) : -1))
        return reply(c, 400, "{\"error\":\"fx inválido (bank 1-2, type, target A|B|master)\"}");
    } else if (0 == std::strcmp(action, "skip")) {
      automix_skip(api->automix);
    } else if (0 == std::strcmp(action, "set_transition")) {
      automix_set_transition_time(api->automix, argf(c, "value", 8));
    } else if (0 == std::strcmp(action, "set_mode")) {
      automix_set_mode(api->automix, argi(c, "value", 0));
    } else if (0 == std::strncmp(action, "queue_", 6)) {
      // Fase 2 · B2: cola del agente (prioridad sobre el Selector; vacía → Selector).
      std::lock_guard<std::mutex> lq(api->queueMu);
      const size_t n = api->cat.paths.size();
      std::vector<int> ids;
      const bool needsList = !std::strcmp(action, "queue_set") || !std::strcmp(action, "queue_append");
      if (needsList) {
        const char* csv = arg(c, "tracks");
        if (!csv || !*csv) return reply(c, 400, "{\"error\":\"faltan tracks\"}");
        std::string cur;
        for (const char* q = csv;; ++q) {
          if (*q == ',' || *q == 0) {
            if (cur.empty() || cur.find_first_not_of("0123456789") != std::string::npos)
              return reply(c, 400, "{\"error\":\"tracks inválidos\"}");
            const long t = std::strtol(cur.c_str(), nullptr, 10);
            if (t < 0 || (size_t)t >= n) return reply(c, 400, "{\"error\":\"unknown_track\"}");
            ids.push_back((int)t);
            cur.clear();
            if (*q == 0) break;
          } else {
            cur += *q;
          }
        }
      }
      if (!std::strcmp(action, "queue_set")) {
        if (ids.size() > AGENT_QUEUE_MAX) return reply(c, 400, "{\"error\":\"too_many_tracks\"}");
        api->agentQueue.assign(ids.begin(), ids.end());
      } else if (!std::strcmp(action, "queue_append")) {
        if (api->agentQueue.size() + ids.size() > AGENT_QUEUE_MAX)
          return reply(c, 400, "{\"error\":\"too_many_tracks\"}");
        api->agentQueue.insert(api->agentQueue.end(), ids.begin(), ids.end());
      } else if (!std::strcmp(action, "queue_remove")) {
        const int t = argi(c, "track", -1);
        auto it = std::find(api->agentQueue.begin(), api->agentQueue.end(), t);
        if (it == api->agentQueue.end()) return reply(c, 400, "{\"error\":\"not_in_queue\"}");
        api->agentQueue.erase(it);  // cancelación: nunca toca la transición en curso
      } else if (!std::strcmp(action, "queue_clear")) {
        api->agentQueue.clear();
      } else {
        return reply(c, 400, "{\"error\":\"acción desconocida\"}");
      }
      api->logEvent(std::string(action) + " → " + std::to_string(api->agentQueue.size()) + " en cola");
      return reply(c, 200, "{\"ok\":true,\"queue\":" + api->queueJsonLocked() + "}");
    } else {
      return reply(c, 400, "{\"error\":\"acción desconocida\"}");
    }
    return reply(c, 200, "{\"ok\":true}");
  }

  return reply(c, 404, "{\"error\":\"no encontrado\"}");
}

void reqCompleted(void*, struct MHD_Connection*, void** con_cls, enum MHD_RequestTerminationCode) {
  if (con_cls && *con_cls) { delete static_cast<ReqCtx*>(*con_cls); *con_cls = nullptr; }
}

void parseCsvEnv(const char* name, std::vector<std::string>& out) {
  const char* env = std::getenv(name);
  if (!env) return;
  std::string s(env), tok;
  for (size_t i = 0; i <= s.size(); ++i) {
    if (i == s.size() || s[i] == ',') {
      size_t a = tok.find_first_not_of(" \t");
      size_t b = tok.find_last_not_of(" \t");
      if (a != std::string::npos) {
        std::string o = tok.substr(a, b - a + 1);
        while (!o.empty() && o.back() == '/') o.pop_back();
        if (!o.empty()) out.push_back(o);
      }
      tok.clear();
    } else {
      tok += s[i];
    }
  }
}

bool envFalse(const char* name) {
  const char* v = std::getenv(name);
  if (!v) return false;
  std::string s(v);
  std::transform(s.begin(), s.end(), s.begin(), ::tolower);
  return s == "false" || s == "0" || s == "no" || s == "off";
}
bool envTrue(const char* name) {
  const char* v = std::getenv(name);
  if (!v) return false;
  std::string s(v);
  std::transform(s.begin(), s.end(), s.begin(), ::tolower);
  return s == "true" || s == "1" || s == "yes" || s == "on";
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

  // S-02: allowlist CORS. Vacía → denegación por defecto (sin ACAO), salvo opt-in dev.
  g_cors_origins.clear();
  parseCsvEnv("AUDIT_SOUND_API_ORIGIN", g_cors_origins);
  g_cors_allow_all = envTrue("AUDIT_SOUND_API_CORS_ALLOW_ALL");
  // S-04: por defecto se confía en el proxy (nginx); se puede desactivar si el engine
  // queda directamente expuesto, para no fiarse de X-Forwarded-For falseable.
  g_trust_proxy = !envFalse("AUDIT_SOUND_API_TRUST_PROXY");

  api->daemon = MHD_start_daemon(MHD_USE_INTERNAL_POLLING_THREAD, (uint16_t)port, nullptr,
                                 nullptr, &handler, api,
                                 MHD_OPTION_NOTIFY_COMPLETED, (void*)&reqCompleted, nullptr,
                                 MHD_OPTION_END);
  if (!api->daemon) {
    LOGE("control_api: no se pudo iniciar en el puerto %d", port);
    delete api;
    return nullptr;
  }
  LOGI("control_api: escuchando en el puerto %d (CORS %s, proxy %s)", port,
       g_cors_allow_all ? "dev-*" : (g_cors_origins.empty() ? "deny" : "allowlist"),
       g_trust_proxy ? "confiable" : "directo");
  return api;
}

void control_api_add_track(ControlApi h, const char* title, const char* path) {
  auto* api = static_cast<Api*>(h);
  if (!api || !title || !path) return;
  control_api_add_track_meta(h, title, path, 0.0f, -1, -1.0f, 0.0);
}

void control_api_add_track_meta(ControlApi h, const char* title, const char* path, float bpm, int key,
                                float energy, double duration) {
  auto* api = static_cast<Api*>(h);
  if (!api || !title || !path) return;
  std::lock_guard<std::mutex> lk(api->mu);
  std::lock_guard<std::mutex> lq(api->queueMu);
  Catalog& k = api->cat;
  k.titles.push_back(title);
  k.paths.push_back(path);
  const bool known = bpm > 1.0f && energy >= 0.0f;
  k.bpm.push_back(known ? bpm : 0.0f);
  k.key.push_back(known ? key : -1);
  k.energy.push_back(known ? energy : 0.0f);
  k.dur.push_back(duration > 0 ? duration : 0.0);
  k.meta.push_back(known ? 1 : 0);
  k.genre.emplace_back();
}

void control_api_set_track_genre(ControlApi h, int index, const char* genre) {
  auto* api = static_cast<Api*>(h);
  if (!api || !genre || index < 0) return;
  std::lock_guard<std::mutex> lk(api->mu);
  std::lock_guard<std::mutex> lq(api->queueMu);
  Catalog& k = api->cat;
  if ((size_t)index < k.genre.size()) k.genre[(size_t)index] = genre;
}

int control_api_next_queued(ControlApi h, char* path_out, int cap) {
  auto* api = static_cast<Api*>(h);
  if (!api || !path_out || cap <= 1) return 0;
  std::lock_guard<std::mutex> lq(api->queueMu);
  while (!api->agentQueue.empty()) {
    const int i = api->agentQueue.front();
    api->agentQueue.pop_front();
    if (i < 0 || (size_t)i >= api->cat.paths.size()) continue;
    const std::string& f = api->cat.paths[(size_t)i];
    if (::access(f.c_str(), R_OK) != 0) {
      api->logEvent("cola del agente: se descarta (no existe) " + api->cat.titles[(size_t)i]);
      continue;
    }
    if ((int)f.size() + 1 > cap) continue;
    std::memcpy(path_out, f.c_str(), f.size() + 1);
    api->logEvent("cola del agente → " + api->cat.titles[(size_t)i]);
    return 1;
  }
  return 0;
}

void control_api_stop(ControlApi h) {
  auto* api = static_cast<Api*>(h);
  if (!api) return;
  if (api->daemon) MHD_stop_daemon(api->daemon);
  delete api;
}

}  // extern "C"
