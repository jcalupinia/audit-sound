#pragma once

// Logging portable (issue C1). En Android usa el log del sistema; en el resto
// (servidor/pruebas) escribe a stderr. Sustituye el <android/log.h> que el
// motor de SideDeck usaba incondicionalmente.

#ifdef __ANDROID__
#include <android/log.h>
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "auditsound", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "auditsound", __VA_ARGS__)
#else
#include <cstdio>
#define LOGI(...)                                   \
  do {                                              \
    std::fprintf(stderr, "[auditsound] " __VA_ARGS__); \
    std::fprintf(stderr, "\n");                     \
  } while (0)
#define LOGE(...)                                        \
  do {                                                   \
    std::fprintf(stderr, "[auditsound][err] " __VA_ARGS__); \
    std::fprintf(stderr, "\n");                          \
  } while (0)
#endif
