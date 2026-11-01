cmake_minimum_required(VERSION 3.22)
project(audit_sound LANGUAGES C CXX)

# Build headless del motor para servidor Linux (Opción B). SIN Oboe/Android.
# El sink de salida en este build es OfflineSink; el StreamSink (MP3 -> Icecast)
# llega en los issues D1/D2.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

set(ROOT ${CMAKE_CURRENT_SOURCE_DIR})

find_package(Threads REQUIRED)

# Dependencias vendorizadas (cada una con su propio CMake).
add_subdirectory(${ROOT}/third_party/qm-dsp qm-dsp-build)
include(${ROOT}/third_party/opus_stack.cmake)   # define: ogg, opus, opusfile

# Motor
add_library(audit_sound_engine STATIC
  ${ROOT}/engine/dj_engine.cpp
  ${ROOT}/engine/last_error.cpp
)
target_compile_definitions(audit_sound_engine PRIVATE _USE_MATH_DEFINES)
target_compile_options(audit_sound_engine PRIVATE -fexceptions)
target_include_directories(audit_sound_engine PUBLIC ${ROOT}/engine)
target_include_directories(audit_sound_engine PRIVATE
  ${ROOT}/third_party/dr_libs
  ${ROOT}/third_party/signalsmith-stretch
  ${ROOT}/third_party/signalsmith-linear/include
  ${ROOT}/third_party/qm-dsp
)
target_link_libraries(audit_sound_engine PRIVATE qm_dsp opusfile Threads::Threads)

# Autoprueba headless: crea el motor, arranca el OfflineSink, opcionalmente carga
# un archivo y comprueba que la posición avanza (pipeline vivo).
add_executable(engine_selftest ${ROOT}/tools/engine_selftest.cpp)
target_link_libraries(engine_selftest PRIVATE audit_sound_engine Threads::Threads)
