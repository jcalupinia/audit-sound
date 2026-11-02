// Control API (issue M5) con libmicrohttpd.

#include "control_api.h"

#include <microhttpd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <random>
#include <string>

#include "platform_log.hpp"

// Compat: algunas versiones nombran el tipo de retorno MHD_Result; otras int.
#ifndef MHD_HTTP_OK
#define MHD_HTTP_OK 200
#endif

namespace {

struct Api {
  struct MHD_Daemon* daemon = nullptr;
  DjEngine engine = nullptr;
  AutoMix automix = nullptr;
  std::string user, pass, token;
};

std::string randomToken() {
  static const char* hx = "0123456789abcdef";
  std::mt19937 rng((unsigned)time(nullptr) ^ (unsigned)(uintptr_t)&hx);
  std::string s;
  for (int i = 0; i < 32; ++i) s += hx[rng() & 0xf];
  return s;
}

std::string basenameNoExt(const std::string& path) {
  size_t a = path.find_last_of('/');
  std::string b = a == std::string::npos ? path : path.substr(a + 1);
  size_t d = b.find_last_of('.');
  if (d != std::string::npos) b = b.substr(0, d);
  std::string out;
  for (char c : b) out += (c == '"' || c == '\\') ? '\'' : c;  // escape mínimo JSON
  return out;
}

const char* arg(struct MHD_Connection* c, const char* key) {
  return MHD_lookup_connection_value(c, MHD_GET_ARGUMENT_KIND, key);
}

MHD_Result reply(struct MHD_Connection* c, int code, const std::string& body,
                 const char* ctype = "application/json") {
  struct MHD_Response* r =
      MHD_create_response_from_buffer(body.size(), (void*)body.data(), MHD_RESPMEM_MUST_COPY);
  MHD_add_response_header(r, "Content-Type", ctype);
  MHD_add_response_header(r, "Access-Control-Allow-Origin", "*");
  MHD_add_response_header(r, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  MHD_add_response_header(r, "Access-Control-Allow-Headers", "Content-Type, Authorization");
  MHD_Result ret = MHD_queue_response(c, code, r);
  MHD_destroy_response(r);
  return ret;
}

MHD_Result handler(void* cls, struct MHD_Connection* c, const char* url, const char* method,
                   const char*, const char*, size_t* upload_size, void** con_cls) {
  auto* api = static_cast<Api*>(cls);

  if (0 == std::strcmp(method, "OPTIONS")) return reply(c, 200, "");

  // Patrón de ciclo de petición de MHD (consume el cuerpo de POST, que ignoramos).
  if (*con_cls == nullptr) {
    *con_cls = (void*)1;
    return MHD_YES;
  }
  if (0 == std::strcmp(method, "POST") && *upload_size != 0) {
    *upload_size = 0;
    return MHD_YES;
  }

  const std::string path = url;

  if (path == "/api/login" && 0 == std::strcmp(method, "POST")) {
    const char* u = arg(c, "user");
    const char* p = arg(c, "pass");
    if (u && p && api->user == u && api->pass == p) {
      return reply(c, 200, "{\"token\":\"" + api->token + "\"}");
    }
    return reply(c, 401, "{\"error\":\"credenciales inválidas\"}");
  }

  // El resto exige token.
  const char* tok = arg(c, "token");
  if (!tok || api->token != tok) {
    return reply(c, 401, "{\"error\":\"no autorizado\"}");
  }

  if (path == "/api/status" && 0 == std::strcmp(method, "GET")) {
    char nowp[4096];
    nowp[0] = 0;
    automix_current_path(api->automix, nowp, (int)sizeof(nowp));
    const std::string title = basenameNoExt(nowp);
    const int deck = automix_from_deck(api->automix);
    const float bpm = dj_get_bpm(api->engine, deck);
    char buf[512];
    std::snprintf(buf, sizeof(buf),
                  "{\"nowPlaying\":\"%s\",\"state\":%d,\"mode\":%d,\"transition\":%.1f,"
                  "\"bpm\":%.1f}",
                  title.c_str(), automix_state(api->automix), automix_get_mode(api->automix),
                  automix_get_transition_time(api->automix), bpm);
    return reply(c, 200, buf);
  }

  if (path == "/api/command" && 0 == std::strcmp(method, "POST")) {
    const char* action = arg(c, "action");
    const char* value = arg(c, "value");
    if (!action) return reply(c, 400, "{\"error\":\"falta action\"}");
    if (0 == std::strcmp(action, "skip")) {
      automix_skip(api->automix);
    } else if (0 == std::strcmp(action, "set_transition") && value) {
      automix_set_transition_time(api->automix, std::atof(value));
    } else if (0 == std::strcmp(action, "set_mode") && value) {
      automix_set_mode(api->automix, std::atoi(value));
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
  api->token = randomToken();
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

void control_api_stop(ControlApi h) {
  auto* api = static_cast<Api*>(h);
  if (!api) return;
  if (api->daemon) MHD_stop_daemon(api->daemon);
  delete api;
}

}  // extern "C"
