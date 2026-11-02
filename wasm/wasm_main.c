// Punto de entrada para WASM con PROXY_TO_PTHREAD: el "hilo principal" del motor
// corre en un worker (que sí puede bloquear al crear el hilo del cache), mientras
// el hilo del navegador queda libre. Mantiene vivo el runtime para las llamadas FFI.
#include <emscripten.h>

int main(void) {
  emscripten_exit_with_live_runtime();
  return 0;
}
