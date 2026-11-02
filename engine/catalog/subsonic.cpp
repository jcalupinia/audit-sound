// Cliente Subsonic (issue M2). libcurl + MD5 propio (dominio público) para el
// token de autenticación. Parseo JSON mínimo (los campos id/suffix/title).

#include "subsonic.h"

#include <curl/curl.h>

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <random>

// ---------------------------------------------------------------------------
// MD5 (dominio público, basado en el RFC 1321). Solo para el token Subsonic.
// ---------------------------------------------------------------------------
namespace {
struct MD5 {
  uint32_t a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  static uint32_t rol(uint32_t x, int c) { return (x << c) | (x >> (32 - c)); }
  std::string hex(const std::string& in) {
    static const uint32_t K[64] = {
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391};
    static const int S[64] = {7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                              5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20,
                              4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                              6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21};
    std::string msg = in;
    const uint64_t bits = (uint64_t)msg.size() * 8;
    msg += (char)0x80;
    while (msg.size() % 64 != 56) msg += (char)0x00;
    for (int i = 0; i < 8; ++i) msg += (char)((bits >> (8 * i)) & 0xff);
    for (size_t off = 0; off < msg.size(); off += 64) {
      uint32_t M[16];
      for (int i = 0; i < 16; ++i) {
        M[i] = (uint8_t)msg[off + i * 4] | ((uint8_t)msg[off + i * 4 + 1] << 8) |
               ((uint8_t)msg[off + i * 4 + 2] << 16) | ((uint8_t)msg[off + i * 4 + 3] << 24);
      }
      uint32_t A = a0, B = b0, C = c0, D = d0;
      for (int i = 0; i < 64; ++i) {
        uint32_t F;
        int g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = F + A + K[i] + M[g];
        A = D; D = C; C = B;
        B = B + rol(F, S[i]);
      }
      a0 += A; b0 += B; c0 += C; d0 += D;
    }
    uint8_t out[16];
    uint32_t vs[4] = {a0, b0, c0, d0};
    for (int i = 0; i < 4; ++i)
      for (int j = 0; j < 4; ++j) out[i * 4 + j] = (vs[i] >> (8 * j)) & 0xff;
    static const char* hx = "0123456789abcdef";
    std::string r;
    for (int i = 0; i < 16; ++i) { r += hx[out[i] >> 4]; r += hx[out[i] & 0xf]; }
    return r;
  }
};

std::string randomSalt() {
  static const char* hx = "0123456789abcdef";
  std::mt19937 rng((unsigned)time(nullptr) ^ (unsigned)(uintptr_t)&hx);
  std::string s;
  for (int i = 0; i < 12; ++i) s += hx[rng() & 0xf];
  return s;
}

size_t writeToString(void* ptr, size_t sz, size_t nm, void* ud) {
  ((std::string*)ud)->append((char*)ptr, sz * nm);
  return sz * nm;
}
size_t writeToFile(void* ptr, size_t sz, size_t nm, void* ud) {
  return std::fwrite(ptr, sz, nm, (FILE*)ud);
}

// Extrae los valores string de la clave "key" en orden, tolerando espacios
// alrededor de ':' (JSON compacto o con espacios). Solo valores string.
std::vector<std::string> jsonValues(const std::string& body, const std::string& key) {
  std::vector<std::string> out;
  const std::string kq = "\"" + key + "\"";
  size_t p = 0;
  while ((p = body.find(kq, p)) != std::string::npos) {
    size_t i = p + kq.size();
    while (i < body.size() && std::isspace((unsigned char)body[i])) ++i;
    if (i >= body.size() || body[i] != ':') { p += kq.size(); continue; }
    ++i;
    while (i < body.size() && std::isspace((unsigned char)body[i])) ++i;
    if (i >= body.size() || body[i] != '"') { p += kq.size(); continue; }  // solo strings
    ++i;
    const size_t e = body.find('"', i);
    if (e == std::string::npos) break;
    out.push_back(body.substr(i, e - i));
    p = e + 1;
  }
  return out;
}
}  // namespace

SubsonicClient::SubsonicClient(std::string baseUrl, std::string user, std::string pass,
                               std::string clientName)
    : base_(std::move(baseUrl)), user_(std::move(user)), pass_(std::move(pass)),
      client_(std::move(clientName)) {
  if (!base_.empty() && base_.back() == '/') base_.pop_back();
}

std::string SubsonicClient::authQuery() const {
  const std::string salt = randomSalt();
  MD5 md5;
  const std::string token = md5.hex(pass_ + salt);
  std::string q = "u=" + user_ + "&t=" + token + "&s=" + salt +
                  "&v=1.16.1&c=" + client_ + "&f=json";
  return q;
}

std::string SubsonicClient::restGet(const std::string& endpoint, const std::string& extra) {
  CURL* c = curl_easy_init();
  if (!c) return "";
  std::string url = base_ + "/rest/" + endpoint + ".view?" + authQuery();
  if (!extra.empty()) url += "&" + extra;
  std::string body;
  curl_easy_setopt(c, CURLOPT_URL, url.c_str());
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, writeToString);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, &body);
  curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 30L);
  curl_easy_setopt(c, CURLOPT_USERAGENT, "AUDIT-SOUND");
  curl_easy_perform(c);
  curl_easy_cleanup(c);
  return body;
}

bool SubsonicClient::ping(std::string* err) {
  const std::string body = restGet("ping", "");
  for (const auto& st : jsonValues(body, "status"))
    if (st == "ok") return true;
  if (err) {
    const auto msgs = jsonValues(body, "message");
    *err = msgs.empty() ? (body.empty() ? "sin respuesta" : body) : msgs[0];
  }
  return false;
}

std::vector<SubsonicSong> SubsonicClient::randomSongs(int n) {
  const std::string body = restGet("getRandomSongs", "size=" + std::to_string(n));
  std::vector<SubsonicSong> out;
  const auto ids = jsonValues(body, "id");
  const auto suf = jsonValues(body, "suffix");
  const auto tit = jsonValues(body, "title");
  for (size_t i = 0; i < ids.size(); ++i) {
    SubsonicSong s;
    s.id = ids[i];
    s.suffix = i < suf.size() ? suf[i] : "mp3";
    s.title = i < tit.size() ? tit[i] : "";
    out.push_back(s);
  }
  return out;
}

std::vector<SubsonicSong> SubsonicClient::playlistSongs(const std::string& playlistId) {
  const std::string body = restGet("getPlaylist", "id=" + playlistId);
  std::vector<SubsonicSong> out;
  const auto ids = jsonValues(body, "id");
  const auto suf = jsonValues(body, "suffix");
  const auto tit = jsonValues(body, "title");
  // La playlist incluye su propio id primero; las entradas con suffix son canciones.
  size_t si = 0;
  for (size_t i = 0; i < ids.size() && si < suf.size(); ++i) {
    // Heurística: asociamos id con suffix en orden; el id de la playlist no tiene suffix.
    SubsonicSong s;
    s.id = ids[i];
    s.suffix = suf[si];
    s.title = si < tit.size() ? tit[si] : "";
    out.push_back(s);
    ++si;
  }
  return out;
}

bool SubsonicClient::download(const SubsonicSong& song, const std::string& outPath) {
  CURL* c = curl_easy_init();
  if (!c) return false;
  // stream con format=raw: Navidrome devuelve el archivo original sin transcodificar.
  std::string url = base_ + "/rest/stream.view?" + authQuery() + "&id=" + song.id + "&format=raw";
  FILE* f = std::fopen(outPath.c_str(), "wb");
  if (!f) { curl_easy_cleanup(c); return false; }
  curl_easy_setopt(c, CURLOPT_URL, url.c_str());
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, writeToFile);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, f);
  curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 120L);
  curl_easy_setopt(c, CURLOPT_USERAGENT, "AUDIT-SOUND");
  const CURLcode rc = curl_easy_perform(c);
  long http = 0;
  curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &http);
  curl_easy_cleanup(c);
  std::fclose(f);
  if (rc != CURLE_OK || http >= 400) return false;
  FILE* chk = std::fopen(outPath.c_str(), "rb");
  if (!chk) return false;
  std::fseek(chk, 0, SEEK_END);
  const long sz = std::ftell(chk);
  std::fclose(chk);
  return sz > 0;
}
