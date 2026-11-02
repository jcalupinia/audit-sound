// Verifica el motor WASM: carga un audio en el FS virtual, reproduce y renderiza
// bloques; comprueba que el PCM producido no es silencio. Uso:
//   node wasm_verify.js build/audit_engine.js /ruta/audio.wav
const path = require('path');
const fs = require('fs');

const jsPath = process.argv[2] || 'build/audit_engine.js';
const wav = process.argv[3] || '/tmp/as_mix/01.wav';
const AuditEngine = require(path.resolve(jsPath));

AuditEngine().then((M) => {
  M.FS.writeFile('/track.wav', fs.readFileSync(wav));
  const e = M.ccall('dj_create', 'number', [], []);
  M.ccall('dj_start', 'number', ['number'], [e]);
  const ok = M.ccall('dj_load', 'number', ['number', 'number', 'string'], [e, 0, '/track.wav']);
  console.log('dj_load =', ok, 'dur =', M.ccall('dj_duration', 'number', ['number', 'number'], [e, 0]).toFixed(2), 's');
  M.ccall('dj_play', 'number', ['number', 'number'], [e, 0, 1]);

  const frames = 2048, ch = 2, n = frames * ch;
  const buf = M._malloc(n * 4);
  setTimeout(() => {
    let peak = 0;
    for (let k = 0; k < 30; k++) {
      M.ccall('dj_render', 'number', ['number', 'number', 'number', 'number'], [e, buf, frames, ch]);
      const f = new Float32Array(M.HEAPF32.buffer, buf, n);
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(f[i]));
    }
    console.log('pico del PCM renderizado =', peak.toFixed(4));
    console.log(peak > 0.01 ? 'WASM ENGINE OK (audio real en el navegador)' : 'FALLO (silencio)');
    process.exit(peak > 0.01 ? 0 : 1);
  }, 1500);
}).catch((err) => { console.error('error:', err); process.exit(2); });
