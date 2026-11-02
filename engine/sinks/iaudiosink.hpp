#pragma once

// Abstracción de salida de audio del motor (issue C2, introducida en C1 para
// poder compilar headless en Linux sin Oboe).
//
// El motor produce audio en renderInterleaved(); un sink lo consume. En Android
// el sink es Oboe; en el servidor (Opción B) es un sink de streaming; en pruebas
// headless, OfflineSink.

struct IAudioRenderer {
  virtual ~IAudioRenderer() = default;
  // Rellena `out` con `frames` cuadros intercalados de `channels` canales (Float32).
  virtual void renderInterleaved(float* out, int frames, int channels) = 0;
};

struct IAudioSink {
  virtual ~IAudioSink() = default;
  // Abre y arranca la salida. Devuelve el sample rate real (>0) o 0 si falla.
  virtual int start(IAudioRenderer* renderer) = 0;
  virtual void stop() = 0;
  virtual int sampleRate() const = 0;
  virtual int channels() const = 0;
};
