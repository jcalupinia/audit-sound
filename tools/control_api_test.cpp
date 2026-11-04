// Prueba de integración del Control API endurecido (Etapa A / A1.3, A1.5).
// Arranca el servidor embebido y lo ejercita con libcurl:
//   - credenciales inválidas → 401; login correcto → 200 + token
//   - token por cabecera Authorization: Bearer (preferido) → 200
//   - token por query ?token= (respaldo retrocompatible) → 200
//   - sin token → 401; comando del controlador → 200
//   - rate limit de /api/login → 429 tras demasiados intentos
//   - CORS por allowlist: refleja solo el Origin permitido
//
// Devuelve 0 si todo pasa; !=0 si algo falla. No necesita audio (no se llama a
// dj_start): basta el handle del motor para que respondan los endpoints.
#include <curl/curl.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "api/control_api.h"
#include "automix.h"
#include "dj_engine.h"

namespace {

struct Resp {
  long code = 0;
  std::string body;
  std::string headers;
};

size_t wbody(char* p, size_t s, size_t n, void* u) {
  ((std::string*)u)->append(p, s * n);
  return s * n;
}
size_t whdr(char* p, size_t s, size_t n, void* u) {
  ((std::string*)u)->append(p, s * n);
  return s * n;
}

Resp req(const std::string& url, const std::string& method, const char* bearer = nullptr,
         const char* origin = nullptr) {
  Resp r;
  CURL* h = curl_easy_init();
  curl_easy_setopt(h, CURLOPT_URL, url.c_str());
  if (method == "POST") curl_easy_setopt(h, CURLOPT_POST, 1L);
  if (method == "POST") curl_easy_setopt(h, CURLOPT_POSTFIELDS, "");
  curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, wbody);
  curl_easy_setopt(h, CURLOPT_WRITEDATA, &r.body);
  curl_easy_setopt(h, CURLOPT_HEADERFUNCTION, whdr);
  curl_easy_setopt(h, CURLOPT_HEADERDATA, &r.headers);
  curl_easy_setopt(h, CURLOPT_TIMEOUT, 5L);
  struct curl_slist* hdrs = nullptr;
  if (bearer) hdrs = curl_slist_append(hdrs, (std::string("Authorization: Bearer ") + bearer).c_str());
  if (origin) hdrs = curl_slist_append(hdrs, (std::string("Origin: ") + origin).c_str());
  if (hdrs) curl_easy_setopt(h, CURLOPT_HTTPHEADER, hdrs);
  curl_easy_perform(h);
  curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &r.code);
  if (hdrs) curl_slist_free_all(hdrs);
  curl_easy_cleanup(h);
  return r;
}

int g_pass = 0, g_fail = 0;
void check(bool cond, const std::string& msg) {
  if (cond) { ++g_pass; std::printf("  OK   %s\n", msg.c_str()); }
  else { ++g_fail; std::printf("  FAIL %s\n", msg.c_str()); }
}

std::string tokenFrom(const std::string& body) {
  auto k = body.find("\"token\":\"");
  if (k == std::string::npos) return "";
  k += 9;
  auto e = body.find('"', k);
  return body.substr(k, e - k);
}

}  // namespace

int main() {
  curl_global_init(CURL_GLOBAL_DEFAULT);

  // --- Instancia 1: funcional (sin allowlist CORS) ---
  unsetenv("AUDIT_SOUND_API_ORIGIN");
  DjEngine e1 = dj_create();
  AutoMix a1 = automix_create(e1);
  const int P1 = 18791;
  ControlApi api1 = control_api_start(P1, "dj", "secreto", e1, a1);
  if (!api1) { std::fprintf(stderr, "no se pudo arrancar control_api en %d\n", P1); return 2; }
  const std::string B1 = "http://127.0.0.1:" + std::to_string(P1);

  check(req(B1 + "/api/login?user=dj&pass=MALA", "POST").code == 401, "login con clave mala → 401");
  Resp lo = req(B1 + "/api/login?user=dj&pass=secreto&name=Test", "POST");
  check(lo.code == 200, "login correcto → 200");
  std::string tok = tokenFrom(lo.body);
  check(!tok.empty(), "login devuelve token");

  check(req(B1 + "/api/status", "GET", tok.c_str()).code == 200, "status con Bearer → 200");
  check(req(B1 + "/api/status?token=" + tok, "GET").code == 200, "status con ?token= (compat) → 200");
  check(req(B1 + "/api/status", "GET").code == 401, "status sin token → 401");
  check(req(B1 + "/api/status", "GET", "token-falso").code == 401, "status con token inválido → 401");
  // El que hizo login es el controlador (primero en entrar) → su comando pasa.
  check(req(B1 + "/api/command?action=skip", "POST", tok.c_str()).code == 200,
        "comando del controlador → 200");

  control_api_stop(api1);

  // --- Instancia 2: rate limit de login ---
  DjEngine e2 = dj_create();
  AutoMix a2 = automix_create(e2);
  const int P2 = 18792;
  ControlApi api2 = control_api_start(P2, "dj", "secreto", e2, a2);
  const std::string B2 = "http://127.0.0.1:" + std::to_string(P2);
  int got429 = 0, got401 = 0;
  for (int i = 0; i < 12; ++i) {
    long code = req(B2 + "/api/login?user=dj&pass=MALA", "POST").code;
    if (code == 429) ++got429;
    else if (code == 401) ++got401;
  }
  check(got401 >= 1 && got429 >= 1, "rate limit: primeros intentos 401, luego 429 (" +
        std::to_string(got401) + " x401, " + std::to_string(got429) + " x429)");
  control_api_stop(api2);

  // --- Instancia 3: CORS por allowlist ---
  setenv("AUDIT_SOUND_API_ORIGIN", "https://sound.audit-ia.ec", 1);
  DjEngine e3 = dj_create();
  AutoMix a3 = automix_create(e3);
  const int P3 = 18793;
  ControlApi api3 = control_api_start(P3, "dj", "secreto", e3, a3);
  const std::string B3 = "http://127.0.0.1:" + std::to_string(P3);
  Resp okOrigin = req(B3 + "/api/status", "GET", nullptr, "https://sound.audit-ia.ec");
  check(okOrigin.headers.find("Access-Control-Allow-Origin: https://sound.audit-ia.ec") !=
        std::string::npos, "CORS refleja el Origin permitido");
  Resp badOrigin = req(B3 + "/api/status", "GET", nullptr, "https://malicioso.example");
  check(badOrigin.headers.find("Access-Control-Allow-Origin") == std::string::npos,
        "CORS no refleja un Origin no permitido");
  check(okOrigin.headers.find("Access-Control-Allow-Origin: *") == std::string::npos,
        "CORS: con allowlist NO se emite el comodín *");
  control_api_stop(api3);

  curl_global_cleanup();
  std::printf("\nRESULTADO: %d OK, %d FAIL\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
