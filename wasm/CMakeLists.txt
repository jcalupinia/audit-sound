cmake_minimum_required(VERSION 3.22)
project(audit_sound_wasm LANGUAGES C CXX)

# Build del motor para el navegador (WebAssembly + Web Audio) — modo PRO/manual.
# Sin dependencias de servidor (lame/shout/curl/microhttpd/FFmpeg). AAC no soportado
# en WASM; sí MP3/WAV/FLAC/Opus. Issue: motor WASM.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

set(ROOT ${CMAKE_CURRENT_SOURCE_DIR}/..)

# Hilos (chunk_cache usa un worker de decodificación).
add_compile_options(-pthread -O2 -fexceptions)
add_link_options(-pthread)

add_subdirectory(${ROOT}/third_party/qm-dsp qm-dsp-build)
include(${ROOT}/third_party/opus_stack.cmake)   # ogg, opus, opusfile

add_executable(audit_engine
  ${ROOT}/engine/dj_engine.cpp
  ${ROOT}/engine/last_error.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/wasm_main.c
)
target_compile_definitions(audit_engine PRIVATE _USE_MATH_DEFINES)
target_include_directories(audit_engine PRIVATE
  ${ROOT}/engine
  ${ROOT}/third_party/dr_libs
  ${ROOT}/third_party/signalsmith-stretch
  ${ROOT}/third_party/signalsmith-linear/include
  ${ROOT}/third_party/qm-dsp
)
target_link_libraries(audit_engine PRIVATE qm_dsp opusfile)

target_link_options(audit_engine PRIVATE
  -sMODULARIZE=1
  -sEXPORT_NAME=AuditEngine
  -sALLOW_MEMORY_GROWTH=1
  -sPROXY_TO_PTHREAD=1
  -sPTHREAD_POOL_SIZE=8
  -sEXIT_RUNTIME=0
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,HEAPF32,HEAPU8,FS
  -sEXPORTED_FUNCTIONS=_dj_create,_dj_destroy,_dj_start,_dj_stop,_dj_load,_dj_play,_dj_seek,_dj_set_cue,_dj_jump_cue,_dj_set_gain,_dj_set_eq,_dj_set_filter,_dj_set_fader,_dj_set_xfader,_dj_set_master,_dj_set_rate,_dj_set_keylock,_dj_get_bpm,_dj_get_key,_dj_get_beat_offset,_dj_position,_dj_duration,_dj_playing,_dj_loaded,_dj_set_loop,_dj_set_hotcue,_dj_jump_hotcue,_dj_clear_hotcue,_dj_beat_jump,_dj_waveform_bins,_dj_waveform_copy,_dj_render,_dj_last_error,_malloc,_free
)
set_target_properties(audit_engine PROPERTIES OUTPUT_NAME "audit_engine")

# Autoprueba WASM (main en C que corre en el worker): genera .html auto-ejecutable.
add_executable(audit_selftest
  ${ROOT}/engine/dj_engine.cpp
  ${ROOT}/engine/last_error.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/wasm_selftest.cpp
)
target_compile_definitions(audit_selftest PRIVATE _USE_MATH_DEFINES)
target_include_directories(audit_selftest PRIVATE
  ${ROOT}/engine ${ROOT}/third_party/dr_libs ${ROOT}/third_party/signalsmith-stretch
  ${ROOT}/third_party/signalsmith-linear/include ${ROOT}/third_party/qm-dsp)
target_link_libraries(audit_selftest PRIVATE qm_dsp opusfile)
target_link_options(audit_selftest PRIVATE
  -sALLOW_MEMORY_GROWTH=1 -sPROXY_TO_PTHREAD=1 -sPTHREAD_POOL_SIZE=8 -sEXIT_RUNTIME=0
  --preload-file ${CMAKE_CURRENT_SOURCE_DIR}/track.wav@/track.wav)
set_target_properties(audit_selftest PROPERTIES SUFFIX ".html")
