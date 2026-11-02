#pragma once

// IcecastByteSink (issue D2): publica los bytes MP3 del StreamSink a un servidor
// Icecast como source client, usando libshout (igual que el broadcast de Mixxx).
// En producción el Icecast corre como contenedor en Coolify (Hetzner).

#include "byte_sink.hpp"
#include "platform_log.hpp"

#include <shout/shout.h>

#include <chrono>
#include <mutex>
#include <string>

class IcecastByteSink : public IByteSink {
 public:
  IcecastByteSink(std::string host, int port, std::string mount, std::string user,
                  std::string password)
      : host_(std::move(host)),
        port_(port),
        mount_(std::move(mount)),
        user_(std::move(user)),
        password_(std::move(password)) {}

  ~IcecastByteSink() override { close(); }

  bool open() override {
    static std::once_flag once;
    std::call_once(once, [] { shout_init(); });
    const bool ok = openConnection();
    if (ok) LOGI("Icecast conectado: %s:%d%s (MP3)", host_.c_str(), port_, mount_.c_str());
    return ok;
  }

  void write(const unsigned char* data, size_t n) override {
    if (!n) return;
    if (!connected_) {
      // Reconexión con enfriamiento: si Icecast cayó o la red parpadeó, se
      // restablece la conexión sin reiniciar el proceso (defecto S1 de F0).
      tryReconnect();
      if (!connected_) return;  // aún sin servidor: se descarta el bloque
    }
    if (shout_send(s_, data, n) != SHOUTERR_SUCCESS) {
      LOGE("shout_send: %s", shout_get_error(s_));
      connected_ = false;  // marcar caída; el próximo write intentará reconectar
    }
    // No llamamos shout_sync(): StreamSink ya pacea a ~tiempo real por bloque.
  }

  void close() override {
    if (s_) {
      shout_close(s_);
      shout_free(s_);
      s_ = nullptr;
    }
  }

 private:
  // Crea el source client y abre la conexión. No registra el LOGI de "conectado"
  // (lo hacen open()/tryReconnect() según el caso).
  bool openConnection() {
    if (s_) {
      shout_close(s_);
      shout_free(s_);
      s_ = nullptr;
    }
    s_ = shout_new();
    if (!s_) {
      LOGE("shout_new falló");
      return false;
    }
    shout_set_host(s_, host_.c_str());
    shout_set_port(s_, static_cast<unsigned short>(port_));
    shout_set_user(s_, user_.c_str());
    shout_set_password(s_, password_.c_str());
    shout_set_mount(s_, mount_.c_str());
    shout_set_protocol(s_, SHOUT_PROTOCOL_HTTP);  // Icecast 2
    if (shout_set_content_format(s_, SHOUT_FORMAT_MP3, SHOUT_USAGE_AUDIO, nullptr) !=
        SHOUTERR_SUCCESS) {
      LOGE("shout_set_content_format: %s", shout_get_error(s_));
    }
    shout_set_meta(s_, SHOUT_META_NAME, "AUDIT SOUND");
    if (shout_open(s_) != SHOUTERR_SUCCESS) {
      LOGE("shout_open falló (%s:%d%s): %s", host_.c_str(), port_, mount_.c_str(),
           shout_get_error(s_));
      shout_free(s_);
      s_ = nullptr;
      connected_ = false;
      return false;
    }
    connected_ = true;
    return true;
  }

  // Reintenta la conexión, pero no más de una vez cada kReconnectCooldown para no
  // saturar la CPU/el log mientras el servidor no vuelve.
  void tryReconnect() {
    const auto now = std::chrono::steady_clock::now();
    if (now - lastAttempt_ < kReconnectCooldown) return;
    lastAttempt_ = now;
    if (openConnection()) {
      LOGI("Icecast reconectado: %s:%d%s", host_.c_str(), port_, mount_.c_str());
    }
  }

  static constexpr std::chrono::milliseconds kReconnectCooldown{2000};

  std::string host_;
  int port_;
  std::string mount_;
  std::string user_;
  std::string password_;
  shout_t* s_ = nullptr;
  bool connected_ = false;
  std::chrono::steady_clock::time_point lastAttempt_{};
};
