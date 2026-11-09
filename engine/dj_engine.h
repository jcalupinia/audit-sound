#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef void* DjEngine;

DjEngine dj_create(void);
void dj_destroy(DjEngine engine);

int dj_start(DjEngine engine);
void dj_stop(DjEngine engine);

/** Output mode: 0 = internal stereo (phone), 1 = external 4ch USB (deck A 1-2, B 3-4).
 *  In mode 1 Oboe is stopped and the Java USB AudioTrack is the sink, so USB
 *  device selection happens on the Java side, not here. */
int dj_set_output_mode(DjEngine engine, int mode);
int dj_get_output_mode(DjEngine engine);
int dj_get_output_channels(DjEngine engine);

int dj_load(DjEngine engine, int deck, const char* path);
void dj_unload(DjEngine engine, int deck);

void dj_play(DjEngine engine, int deck, int playing);
void dj_seek(DjEngine engine, int deck, double seconds);
void dj_set_cue(DjEngine engine, int deck);
void dj_jump_cue(DjEngine engine, int deck);

double dj_position(DjEngine engine, int deck);
double dj_duration(DjEngine engine, int deck);
int dj_playing(DjEngine engine, int deck);
int dj_loaded(DjEngine engine, int deck);

void dj_set_gain(DjEngine engine, int deck, float linear);
void dj_set_eq(DjEngine engine, int deck, float low_db, float mid_db, float high_db);
void dj_set_filter(DjEngine engine, int deck, float amount);
void dj_set_fader(DjEngine engine, int deck, float linear);
void dj_set_xfader(DjEngine engine, float x);
void dj_set_master(DjEngine engine, float linear);

/* Micrófonos del DJ en vivo (servidor). La voz llega en bloques PCM 16 bits mono a cualquier
 * frecuencia; el motor la remuestrea, la suma a la mezcla estéreo y, con talkover, atenúa la
 * música mientras se habla. Devuelve las muestras aceptadas. */
int dj_voice_push(DjEngine engine, const short* pcm16, int frames, int sample_rate);
/* mode: 0 sin atenuar · 1 atenuar siempre · 2 automático (al hablar). voice_gain lineal (0..4,
 * negativo = no cambia). duck_db: atenuación de la música (−60..0; positivo = no cambia). */
void dj_set_talkover(DjEngine engine, int mode, float voice_gain, float duck_db);
typedef struct {
  int active;              /* la voz está sonando */
  int talkover;            /* modo vigente */
  float level_db;          /* nivel de la voz (dBFS) */
  float music_gain;        /* ganancia aplicada a la música (1 = sin atenuar) */
  int buffered_ms;         /* voz en el búfer */
  double received_seconds; /* voz recibida en total */
  unsigned underruns;      /* veces que el búfer se vació hablando */
} DjVoiceStatus;
void dj_voice_status(DjEngine engine, DjVoiceStatus* st);
// Título de lo que suena ("Artista - Tema"): el sink de Icecast lo publica como metadato del stream.
void dj_set_stream_title(DjEngine engine, const char* title);
void dj_set_rate(DjEngine engine, int deck, float rate);
void dj_set_keylock(DjEngine engine, int deck, int enabled);

float dj_get_bpm(DjEngine engine, int deck);
int dj_get_key(DjEngine engine, int deck);
float dj_get_beat_offset(DjEngine engine, int deck);
void dj_nudge_grid(DjEngine engine, int deck, float seconds);

void dj_set_loop(DjEngine engine, int deck, int enabled, float bars);
double dj_loop_start(DjEngine engine, int deck);
double dj_loop_end(DjEngine engine, int deck);
void dj_set_hotcue(DjEngine engine, int deck, int index, double seconds);
void dj_jump_hotcue(DjEngine engine, int deck, int index);
double dj_get_hotcue(DjEngine engine, int deck, int index);
void dj_clear_hotcue(DjEngine engine, int deck, int index);
void dj_beat_jump(DjEngine engine, int deck, int beats);

int dj_waveform_bins(void);
int dj_waveform_copy(DjEngine engine, int deck, float* min_out, float* max_out, int bins);

/** Decode a 60s prefix (22 kHz mono) + BPM/key/grid. Uses ID3 TBPM/TKEY when present. */
int dj_analyze_file(const char* path, float* bpm, int* key, float* beat_offset);

/** First/last audible sound (-60 dB) in seconds, and RMS energy [0,1].
 *  last_sound = -1 if no sound found; energy over the first 30s. For AutoMix
 *  skip-silence and the intelligent selector. Returns 1 on success, 0 on failure. */
int dj_analyze_silence(const char* path, double* first_sound, double* last_sound,
                       float* energy_rms);

/** Length in seconds from the file header / decoder. Does not decode PCM. */
double dj_file_duration(const char* path);
// Fin (s) de la parte FUERTE de la pista, antes de su decaimiento final (nivel por segundo frente al
// nivel habitual de la pista). El AutoMix termina ahí el fundido en vez de en el último sonido.
// Devuelve 1 si lo encontró; loud_end_sec = -1 si no.
int dj_analyze_loud_end(const char* path, double* loud_end_sec);
// Igual, y además dónde EMPIEZA la parte fuerte (loud_start_sec = -1 si no se encuentra).
// Una sola decodificación del archivo para ambos valores.
int dj_analyze_loud_range(const char* path, double* loud_start_sec, double* loud_end_sec);

/** Load PCM and apply previously cached analysis (skips BPM/key). bpm<=0 runs a full analyze. */
int dj_load_with_analysis(DjEngine engine, int deck, const char* path, float bpm, int key,
                          float beat_offset);

/** Null-terminated reason for the last failed dj_load / open, or "". */
const char* dj_last_error(void);

#ifdef __EMSCRIPTEN__
/** WASM: el AudioWorklet de Web Audio llama a esto para obtener audio
 *  (interleaved float). Devuelve los cuadros escritos. */
int dj_render(DjEngine engine, float* out, int frames, int channels);

/** WASM: fija la tasa de salida del motor a la del AudioContext (44100/48000).
 *  Llamar tras dj_start y antes de cargar pistas (evita el desajuste de tono). */
void dj_set_output_sample_rate(DjEngine engine, int sampleRate);
#endif

#ifdef __cplusplus
}
#endif
