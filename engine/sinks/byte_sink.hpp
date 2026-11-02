#pragma once

// Destino de bytes codificados (MP3). Abstrae a dónde van los bytes del encoder:
// - D1: archivo (FileByteSink) — para validar el MP3 a disco.
// - D2: Icecast (IcecastByteSink, con libshout) — el stream real.

#include <cstdio>
#include <cstddef>
#include <string>

struct IByteSink {
  virtual ~IByteSink() = default;
  virtual bool open() = 0;
  virtual void write(const unsigned char* data, size_t n) = 0;
  virtual void close() = 0;
};

class FileByteSink : public IByteSink {
 public:
  explicit FileByteSink(std::string path) : path_(std::move(path)) {}
  ~FileByteSink() override { close(); }

  bool open() override {
    f_ = std::fopen(path_.c_str(), "wb");
    return f_ != nullptr;
  }
  void write(const unsigned char* data, size_t n) override {
    if (f_ && n) std::fwrite(data, 1, n, f_);
  }
  void close() override {
    if (f_) {
      std::fclose(f_);
      f_ = nullptr;
    }
  }

 private:
  std::string path_;
  std::FILE* f_ = nullptr;
};
