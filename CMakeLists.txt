cmake_minimum_required(VERSION 3.22)
project(audit_sound LANGUAGES C CXX)

# Build headless del motor para servidor Linux (Opción B). SIN Oboe/Android.
# El sink de salida en este build es OfflineSink; el StreamSink (MP3 -> Icecast)
# llega en los issues D1/D2.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

# Algunas libs vendorizadas (ogg, qm-dsp) declaran cmake_minimum_required < 3.5.
# CMake >= 4 eliminó esa compatibilidad; esto permite configurarlas igual.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

set(ROOT ${CMAKE_CURRENT_SOURCE_DIR})

find_package(Threads REQUIRED)

# libmp3lame (encoder MP3 del StreamSink, issue D1).
find_path(LAME_INCLUDE_DIR lame/lame.h)
find_library(LAME_LIBRARY NAMES mp3lame)
if(NOT LAME_INCLUDE_DIR OR NOT LAME_LIBRARY)
  message(FATAL_ERROR "libmp3lame no encontrada (instalar libmp3lame-dev)")
endif()

# libshout (source client de Icecast del StreamSink, issue D2).
find_path(SHOUT_INCLUDE_DIR shout/shout.h)
find_library(SHOUT_LIBRARY NAMES shout)
if(NOT SHOUT_INCLUDE_DIR OR NOT SHOUT_LIBRARY)
  message(FATAL_ERROR "libshout no encontrada (instalar libshout3-dev)")
endif()

# FFmpeg (decodificación AAC/M4A/ALAC en el servidor, issue M2).
find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG REQUIRED IMPORTED_TARGET
  libavcodec libavformat libavutil libswresample)

# libcurl (cliente Subsonic/Navidrome, issue M2).
pkg_check_modules(CURL REQUIRED IMPORTED_TARGET libcurl)

# libmicrohttpd (Control API, issue M5).
pkg_check_modules(MHD REQUIRED IMPORTED_TARGET libmicrohttpd)

# Dependencias vendorizadas (cada una con su propio CMake).
add_subdirectory(${ROOT}/third_party/qm-dsp qm-dsp-build)
include(${ROOT}/third_party/opus_stack.cmake)   # define: ogg, opus, opusfile

# Motor
add_library(audit_sound_engine STATIC
  ${ROOT}/engine/dj_engine.cpp
  ${ROOT}/engine/last_error.cpp
  ${ROOT}/engine/automix/automix.cpp
  ${ROOT}/engine/catalog/subsonic.cpp
  ${ROOT}/engine/selector/selector.cpp
  ${ROOT}/engine/api/control_api.cpp
)
target_compile_definitions(audit_sound_engine PRIVATE _USE_MATH_DEFINES)
target_compile_options(audit_sound_engine PRIVATE -fexceptions)
target_include_directories(audit_sound_engine PUBLIC ${ROOT}/engine ${ROOT}/engine/automix ${ROOT}/engine/catalog ${ROOT}/engine/selector ${ROOT}/engine/api)
target_include_directories(audit_sound_engine PRIVATE
  ${ROOT}/engine/sinks
  ${ROOT}/third_party/dr_libs
  ${ROOT}/third_party/signalsmith-stretch
  ${ROOT}/third_party/signalsmith-linear/include
  ${ROOT}/third_party/qm-dsp
  ${LAME_INCLUDE_DIR}
  ${SHOUT_INCLUDE_DIR}
)
target_link_libraries(audit_sound_engine PRIVATE qm_dsp opusfile Threads::Threads ${LAME_LIBRARY} ${SHOUT_LIBRARY} PkgConfig::FFMPEG PkgConfig::CURL PkgConfig::MHD)

# Autoprueba headless: crea el motor, arranca el sink, opcionalmente carga
# un archivo y comprueba que la posición avanza (pipeline vivo).
add_executable(engine_selftest ${ROOT}/tools/engine_selftest.cpp)
target_link_libraries(engine_selftest PRIVATE audit_sound_engine Threads::Threads)

# Verificador: re-decodifica un MP3 con dr_mp3 (ya vendorizado) y reporta
# validez, duración y nivel (no-silencio). Issue D1.
add_executable(mp3_verify ${ROOT}/tools/mp3_verify.cpp)
target_include_directories(mp3_verify PRIVATE ${ROOT}/third_party/dr_libs)

# Servidor de larga vida: reproduce una carpeta en bucle y emite por el sink
# (Icecast en producción). Placeholder hasta el AutoMix (M3). Issue de despliegue.
add_executable(audit_sound_server ${ROOT}/tools/audit_sound_server.cpp)
target_link_libraries(audit_sound_server PRIVATE audit_sound_engine Threads::Threads)

# Prueba del detector de silencio (-60 dB) + energía (M2).
add_executable(mix_points_test ${ROOT}/tools/mix_points_test.cpp)
target_link_libraries(mix_points_test PRIVATE audit_sound_engine Threads::Threads)
# Mezclador de voz en vivo (micrófonos del DJ + talkover).
add_executable(voice_test ${ROOT}/tools/voice_test.cpp)
target_link_libraries(voice_test PRIVATE audit_sound_engine Threads::Threads)

add_executable(silence_test ${ROOT}/tools/silence_test.cpp)
target_link_libraries(silence_test PRIVATE audit_sound_engine Threads::Threads)

# Prueba del cliente Subsonic/Navidrome (M2): MD5, ping, listado, descarga.
add_executable(subsonic_test ${ROOT}/tools/subsonic_test.cpp)
target_link_libraries(subsonic_test PRIVATE audit_sound_engine Threads::Threads)

# Prueba del selector inteligente (M4): armonía/tempo/energía/anti-repetición.
add_executable(selector_test ${ROOT}/tools/selector_test.cpp)
target_link_libraries(selector_test PRIVATE audit_sound_engine Threads::Threads)

# Prueba de integración del Control API endurecido (Etapa A / A1.3, A1.5):
# auth por Bearer, rate limit de login (429), CORS por allowlist, 401/compat.
add_executable(control_api_test ${ROOT}/tools/control_api_test.cpp)
target_link_libraries(control_api_test PRIVATE audit_sound_engine Threads::Threads PkgConfig::CURL)

# Prueba de reproducción continua + recuperación ante fallos (Etapa A / A1.4):
# fuente de pistas que falla intermitentemente; el AutoMix se recupera y no corta.
add_executable(playback_recovery_test ${ROOT}/tools/playback_recovery_test.cpp)
target_link_libraries(playback_recovery_test PRIVATE audit_sound_engine Threads::Threads)
