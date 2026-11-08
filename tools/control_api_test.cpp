// Prueba de integración del Control API endurecido (Etapa A4 / S-01..S-04).
// Arranca el servidor embebido y verifica con libcurl:
//   S-01  login por CUERPO POST (form); credenciales fuera de la URL; token por
//         Authorization: Bearer; el legado ?token= queda RECHAZADO.
//   S-02  CORS con denegación por defecto (sin allowlist no hay ACAO) y allowlist.
//   S-03  transferencia de control con autorización (request/approve), y que una
//         sesión secundaria NO puede arrebatar el control con /take si hay controlador.
//   S-04  logout con revocación server-side (token no reutilizable) y rate limit.
#include <curl/curl.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "api/control_api.h"
#include "automix.h"
#include "dj_engine.h"

namespace {

struct Resp { long code = 0; std::string body, headers; };
size_t wbody(char* p, size_t s, size_t n, void* u) { ((std::string*)u)->append(p, s * n); return s * n; }

Resp req(const std::string& url, const std::string& method, const char* bearer = nullptr,
         const char* origin = nullptr, const char* postBody = nullptr) {
  Resp r;
  CURL* h = curl_easy_init();
  curl_easy_setopt(h, CURLOPT_URL, url.c_str());
  if (method == "POST") {
    curl_easy_setopt(h, CURLOPT_POST, 1L);
    curl_easy_setopt(h, CURLOPT_POSTFIELDS, postBody ? postBody : "");
    curl_easy_setopt(h, CURLOPT_POSTFIELDSIZE, (long)(postBody ? std::strlen(postBody) : 0));
  }
  curl_easy_setopt(h, CURLOPT_WRITEFUNCTION, wbody);
  curl_easy_setopt(h, CURLOPT_WRITEDATA, &r.body);
  curl_easy_setopt(h, CURLOPT_HEADERFUNCTION, wbody);
  curl_easy_setopt(h, CURLOPT_HEADERDATA, &r.headers);
  curl_easy_setopt(h, CURLOPT_TIMEOUT, 5L);
  struct curl_slist* hs = nullptr;
  if (bearer) hs = curl_slist_append(hs, (std::string("Authorization: Bearer ") + bearer).c_str());
  if (origin) hs = curl_slist_append(hs, (std::string("Origin: ") + origin).c_str());
  if (postBody) hs = curl_slist_append(hs, "Content-Type: application/x-www-form-urlencoded");
  if (hs) curl_easy_setopt(h, CURLOPT_HTTPHEADER, hs);
  curl_easy_perform(h);
  curl_easy_getinfo(h, CURLINFO_RESPONSE_CODE, &r.code);
  if (hs) curl_slist_free_all(hs);
  curl_easy_cleanup(h);
  return r;
}

int g_pass = 0, g_fail = 0;
void check(bool cond, const std::string& m) {
  if (cond) { ++g_pass; std::printf("  OK   %s\n", m.c_str()); }
  else { ++g_fail; std::printf("  FAIL %s\n", m.c_str()); }
}
std::string field(const std::string& body, const std::string& key) {
  auto k = body.find("\"" + key + "\":\"");
  if (k == std::string::npos) return "";
  k += key.size() + 4;
  return body.substr(k, body.find('"', k) - k);
}

}  // namespace

int main() {
  curl_global_init(CURL_GLOBAL_DEFAULT);

  // ---- Instancia 1: funcional (sin allowlist CORS → denegación por defecto) ----
  unsetenv("AUDIT_SOUND_API_ORIGIN");
  unsetenv("AUDIT_SOUND_API_CORS_ALLOW_ALL");
  DjEngine e1 = dj_create(); AutoMix a1 = automix_create(e1);
  const int P1 = 18791;
  ControlApi api1 = control_api_start(P1, "dj", "secreto", e1, a1);
  if (!api1) { std::fprintf(stderr, "no arrancó control_api\n"); return 2; }
  const std::string B1 = "http://127.0.0.1:" + std::to_string(P1);

  // S-01: credenciales por cuerpo POST
  check(req(B1 + "/api/login", "POST", nullptr, nullptr, "user=dj&pass=MALA").code == 401,
        "S-01 login (body) clave mala → 401");
  Resp lo = req(B1 + "/api/login", "POST", nullptr, nullptr, "user=dj&pass=secreto&name=A");
  const std::string tokA = field(lo.body, "token");
  check(lo.code == 200 && !tokA.empty(), "S-01 login (body) correcto → 200 + token");
  check(req(B1 + "/api/status", "GET", tokA.c_str()).code == 200, "S-01 status con Bearer → 200");
  // S-01: el legado ?token= ya NO autentica
  check(req(B1 + "/api/status?token=" + tokA, "GET").code == 401, "S-01 ?token= en la URL → 401 (eliminado)");
  check(req(B1 + "/api/status", "GET").code == 401, "status sin token → 401");
  check(req(B1 + "/api/command?action=skip", "POST", tokA.c_str()).code == 200, "comando del controlador → 200");

  // S-02: CORS denegación por defecto (sin allowlist no hay ACAO ni con Origin)
  Resp co = req(B1 + "/api/status", "GET", tokA.c_str(), "https://sound.audit-ia.ec");
  check(co.headers.find("Access-Control-Allow-Origin") == std::string::npos,
        "S-02 sin allowlist → NO se emite Access-Control-Allow-Origin (deny por defecto)");

  // S-04: logout revoca el token (no reutilizable)
  check(req(B1 + "/api/logout", "POST", tokA.c_str()).code == 200, "S-04 logout → 200");
  check(req(B1 + "/api/status", "GET", tokA.c_str()).code == 401, "S-04 token revocado tras logout → 401");
  control_api_stop(api1);

  // ---- Instancia 2: rate limit ----
  DjEngine e2 = dj_create(); AutoMix a2 = automix_create(e2);
  const int P2 = 18792;
  ControlApi api2 = control_api_start(P2, "dj", "secreto", e2, a2);
  const std::string B2 = "http://127.0.0.1:" + std::to_string(P2);
  int got429 = 0, got401 = 0;
  for (int i = 0; i < 12; ++i) {
    long code = req(B2 + "/api/login", "POST", nullptr, nullptr, "user=dj&pass=MALA").code;
    if (code == 429) ++got429; else if (code == 401) ++got401;
  }
  check(got401 >= 1 && got429 >= 1, "S-04 rate limit: 401 y luego 429 (" +
        std::to_string(got401) + "x401, " + std::to_string(got429) + "x429)");
  control_api_stop(api2);

  // ---- Instancia 3: CORS allowlist ----
  setenv("AUDIT_SOUND_API_ORIGIN", "https://sound.audit-ia.ec", 1);
  DjEngine e3 = dj_create(); AutoMix a3 = automix_create(e3);
  const int P3 = 18793;
  ControlApi api3 = control_api_start(P3, "dj", "secreto", e3, a3);
  const std::string B3 = "http://127.0.0.1:" + std::to_string(P3);
  Resp okO = req(B3 + "/api/status", "GET", nullptr, "https://sound.audit-ia.ec");
  check(okO.headers.find("Access-Control-Allow-Origin: https://sound.audit-ia.ec") != std::string::npos,
        "S-02 allowlist refleja el Origin permitido");
  Resp badO = req(B3 + "/api/status", "GET", nullptr, "https://malicioso.example");
  check(badO.headers.find("Access-Control-Allow-Origin") == std::string::npos,
        "S-02 allowlist bloquea un Origin no permitido");
  control_api_stop(api3);
  unsetenv("AUDIT_SOUND_API_ORIGIN");

  // ---- Instancia 4: transferencia de control con autorización (S-03) ----
  DjEngine e4 = dj_create(); AutoMix a4 = automix_create(e4);
  const int P4 = 18794;
  ControlApi api4 = control_api_start(P4, "dj", "secreto", e4, a4);
  const std::string B4 = "http://127.0.0.1:" + std::to_string(P4);
  // Sesión A (primera → controladora), sesión B (secundaria)
  const std::string A = field(req(B4 + "/api/login", "POST", nullptr, nullptr, "user=dj&pass=secreto&name=A").body, "token");
  const std::string Bk = field(req(B4 + "/api/login", "POST", nullptr, nullptr, "user=dj&pass=secreto&name=B").body, "token");
  check(!A.empty() && !Bk.empty(), "S-03 dos sesiones simultáneas con token propio");
  check(req(B4 + "/api/command?action=skip", "POST", A.c_str()).code == 200, "S-03 A (controlador) comanda → 200");
  check(req(B4 + "/api/command?action=skip", "POST", Bk.c_str()).code == 409, "S-03 B (secundaria) comanda → 409");
  // B no puede arrebatar con /take mientras A controla
  check(req(B4 + "/api/control/take", "POST", Bk.c_str()).code == 409, "S-03 B /take con controlador activo → 409");
  // B solicita el control
  Resp rq = req(B4 + "/api/control/request", "POST", Bk.c_str());
  check(rq.code == 200 && field(rq.body, "status") == "requested", "S-03 B solicita control → requested");
  // A ve la solicitud pendiente
  check(field(req(B4 + "/api/status", "GET", A.c_str()).body, "pendingRequest") == "B",
        "S-03 A ve pendingRequest=B");
  // A aprueba → B pasa a controlar
  check(req(B4 + "/api/control/approve", "POST", A.c_str()).code == 200, "S-03 A aprueba → 200");
  check(req(B4 + "/api/command?action=skip", "POST", Bk.c_str()).code == 200, "S-03 B ya controla → 200");
  check(req(B4 + "/api/command?action=skip", "POST", A.c_str()).code == 409, "S-03 A dejó de controlar → 409");
  control_api_stop(api4);

  // ---- Instancia 5: Fase 2 — metadatos (B1) y cola del agente (B2) ----
  const std::string f0 = "/tmp/as_f2_t0.wav", f1 = "/tmp/as_f2_t1.wav";
  for (const auto& f : {f0, f1}) { FILE* fp = std::fopen(f.c_str(), "wb"); if (fp) { std::fputs("x", fp); std::fclose(fp); } }
  DjEngine e5 = dj_create(); AutoMix a5 = automix_create(e5);
  const int P5 = 18795;
  ControlApi api5 = control_api_start(P5, "dj", "secreto", e5, a5);
  const std::string B5 = "http://127.0.0.1:" + std::to_string(P5);
  control_api_add_track_meta(api5, "Tema Cero", f0.c_str(), 124.0f, 7, 0.62f, 183.4);
  control_api_add_track_meta(api5, "Tema Uno", f1.c_str(), 126.0f, 8, 0.70f, 200.0);
  control_api_add_track_meta(api5, "Fantasma", "/tmp/as_f2_no_existe.wav", 120.0f, 19, 0.40f, 150.0);
  control_api_set_track_genre(api5, 1, "merengue");
  control_api_set_track_genre(api5, 9, "salsa");  // índice inexistente: se ignora
  const std::string T5 = field(req(B5 + "/api/login", "POST", nullptr, nullptr, "user=dj&pass=secreto&name=agente").body, "token");
  Resp tr = req(B5 + "/api/tracks", "GET", T5.c_str());
  check(tr.code == 200 && tr.body.find("\"metadata\":true") != std::string::npos,
        "B1 /api/tracks anuncia metadata=true cuando todas las pistas están analizadas");
  check(tr.body.find("\"bpm\":124.00,\"key\":7,\"energy\":0.6200,\"duration\":183.40") != std::string::npos,
        "B1 /api/tracks expone BPM, tonalidad, energía y duración");
  check(tr.body.find("{\"i\":0,\"title\":\"Tema Cero\"") != std::string::npos,
        "B1 cambio aditivo: se conservan i y title");
  check(tr.body.find("\"duration\":200.00,\"genre\":\"merengue\"}") != std::string::npos,
        "/api/tracks publica el género de la pista que lo tiene");
  check(tr.body.find("\"duration\":183.40}") != std::string::npos && tr.body.find("salsa") == std::string::npos,
        "sin género no se publica el campo (y un índice inexistente se ignora)");
  auto cmd = [&](const std::string& q, const std::string& tok) { return req(B5 + "/api/command?" + q, "POST", tok.c_str()); };
  Resp qs = cmd("action=queue_set&tracks=2,1,0", T5);
  check(qs.code == 200 && qs.body.find("\"queue\":[2,1,0]") != std::string::npos, "B2 queue_set → 200 y cola resultante");
  Resp st = req(B5 + "/api/status", "GET", T5.c_str());
  check(st.body.find("\"queue\":[2,1,0]") != std::string::npos && st.body.find("\"next_source\":\"agent\"") != std::string::npos,
        "B2 /api/status muestra la cola y next_source=agent");
  check(req(B5 + "/api/queue", "GET", T5.c_str()).body.find("{\"i\":2,\"title\":\"Fantasma\"}") != std::string::npos,
        "B2 GET /api/queue lista las pistas con su título");
  check(cmd("action=queue_set&tracks=99", T5).code == 400, "B2 pista inexistente → 400 unknown_track");
  check(cmd("action=queue_set&tracks=1,abc", T5).code == 400, "B2 lista mal formada → 400");
  std::string many = "action=queue_set&tracks=0";
  for (int i = 0; i < 50; ++i) many += ",1";
  check(cmd(many, T5).code == 400, "B2 más de 50 pistas → 400 too_many_tracks");
  check(req(B5 + "/api/status", "GET", T5.c_str()).body.find("\"queue\":[2,1,0]") != std::string::npos,
        "B2 una petición rechazada no altera la cola");
  Resp rm = cmd("action=queue_remove&track=0", T5);
  check(rm.code == 200 && rm.body.find("\"queue\":[2,1]") != std::string::npos, "B2 queue_remove cancela una pista pendiente");
  check(cmd("action=queue_remove&track=0", T5).code == 400, "B2 quitar algo que no está → 400 not_in_queue");
  char path[512];
  check(control_api_next_queued(api5, path, sizeof(path)) == 1 && f1 == path,
        "B2 next_queued descarta la pista sin archivo y entrega la siguiente válida");
  check(control_api_next_queued(api5, path, sizeof(path)) == 0, "B2 cola vacía → 0 (decide el Selector)");
  check(req(B5 + "/api/status", "GET", T5.c_str()).body.find("\"next_source\":\"selector\"") != std::string::npos,
        "B2 sin cola, next_source=selector");
  check(cmd("action=queue_append&tracks=0,1", T5).body.find("\"queue\":[0,1]") != std::string::npos, "B2 queue_append");
  check(cmd("action=queue_clear", T5).body.find("\"queue\":[]") != std::string::npos, "B2 queue_clear vacía la cola");
  const std::string O5 = field(req(B5 + "/api/login", "POST", nullptr, nullptr, "user=dj&pass=secreto&name=otro").body, "token");
  check(cmd("action=queue_set&tracks=0", O5).code == 409, "B2 la cola solo la controla el controlador (409)");
  control_api_add_track(api5, "Sin analizar", f0.c_str());
  check(req(B5 + "/api/tracks", "GET", T5.c_str()).body.find("\"metadata\":false") != std::string::npos,
        "B1 con una pista sin análisis → metadata=false");
  control_api_stop(api5);
  std::remove(f0.c_str()); std::remove(f1.c_str());

  curl_global_cleanup();
  std::printf("\nRESULTADO: %d OK, %d FAIL\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
