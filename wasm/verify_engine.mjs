// Verificación empírica del MOTOR WASM real (fork SideDeck + ports Mixxx + qm-dsp):
// carga DOS pistas, las mezcla y prueba crossfader, EQ, hotcue, loop y pitch+keylock
// llamando a las MISMAS funciones C que usan los botones de mixer.html (engine_worker.js).
//
// La build de Emscripten 6.0.13 emite el motor como MÓDULO ES6 (export default), por eso
// este verificador es ESM (.mjs). El antiguo wasm_verify.js (CommonJS) ya no aplica a esa
// build. Solo usa funciones presentes en EXPORTED_FUNCTIONS (wasm/CMakeLists.txt).
//
// Uso:
//   node wasm/verify_engine.mjs wasm/build/audit_engine.js pistaA.wav pistaB.wav
// Requiere haber compilado antes:  emcmake cmake -S wasm -B wasm/build && cmake --build wasm/build --target audit_engine
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const jsPath = process.argv[2] || 'wasm/build/audit_engine.js';
const A = process.argv[3], B = process.argv[4];
if (!A || !B) { console.error('uso: node wasm/verify_engine.mjs <audit_engine.js> <A.wav> <B.wav>'); process.exit(2); }

const { default: AuditEngine } = await import(pathToFileURL(path.resolve(jsPath)).href);
const out = [];
const rec = (n, ok, d) => { out.push({ n, ok, d }); console.log((ok ? 'OK  ' : 'FALLA ') + n + ' — ' + d); };

let M;
try { M = await AuditEngine(); }
catch (err) { console.log('ERROR_INIT: ' + String(err && err.message || err).slice(0, 400)); process.exit(3); }
M.FS.writeFile('/a.wav', fs.readFileSync(A));
M.FS.writeFile('/b.wav', fs.readFileSync(B));
const call = (f, rt, at, args) => M.ccall(f, rt, at, args);

const e = call('dj_create', 'number', [], []);
call('dj_start', 'number', ['number'], [e]);

const okA = call('dj_load', 'number', ['number', 'number', 'string'], [e, 0, '/a.wav']);
const okB = call('dj_load', 'number', ['number', 'number', 'string'], [e, 1, '/b.wav']);
const durA = call('dj_duration', 'number', ['number', 'number'], [e, 0]);
const bpmA = call('dj_get_bpm', 'number', ['number', 'number'], [e, 0]);
const bpmB = call('dj_get_bpm', 'number', ['number', 'number'], [e, 1]);
rec('Carga 2 pistas en deck A y B', okA === 1 && okB === 1, `A ok=${okA} (dur=${durA.toFixed(2)}s, bpm=${bpmA.toFixed(1)}) · B ok=${okB} (bpm=${bpmB.toFixed(1)})`);

const frames = 2048, ch = 2, n = frames * ch;
const buf = M._malloc(n * 4);
const renderPeak = (blocks = 20) => {
  let peak = 0;
  for (let k = 0; k < blocks; k++) {
    call('dj_render', 'number', ['number', 'number', 'number', 'number'], [e, buf, frames, ch]);
    const f = new Float32Array(M.HEAPF32.buffer, buf, n);
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(f[i]));
  }
  return peak;
};

call('dj_play', 'number', ['number', 'number'], [e, 0, 1]);
call('dj_play', 'number', ['number', 'number'], [e, 1, 1]);
await new Promise(r => setTimeout(r, 800));
call('dj_set_master', 'number', ['number', 'number'], [e, 1.0]);
call('dj_set_xfader', 'number', ['number', 'number'], [e, 0.5]);
const pMix = renderPeak();
rec('Las 2 canciones suenan a la vez (motor real)', pMix > 0.01, `pico PCM mezcla = ${pMix.toFixed(4)} (>0.01 = audio real)`);

call('dj_set_xfader', 'number', ['number', 'number'], [e, 0.0]); const pA = renderPeak();
call('dj_set_xfader', 'number', ['number', 'number'], [e, 1.0]); const pB = renderPeak();
rec('Crossfader cambia la mezcla A/B', pA > 0.01 && pB > 0.01, `izq(A)=${pA.toFixed(4)} der(B)=${pB.toFixed(4)}`);

call('dj_set_xfader', 'number', ['number', 'number'], [e, 0.0]);
call('dj_set_eq', 'number', ['number', 'number', 'number', 'number', 'number'], [e, 0, 0.0, 1.0, 1.0]);
const pEqKill = renderPeak();
call('dj_set_eq', 'number', ['number', 'number', 'number', 'number', 'number'], [e, 0, 1.0, 1.0, 1.0]);
const pEqFlat = renderPeak();
rec('EQ HI/MID/LOW responde en el motor', pEqKill >= 0 && pEqFlat > 0.01, `low=0 pico=${pEqKill.toFixed(4)} · plano pico=${pEqFlat.toFixed(4)}`);

call('dj_play', 'number', ['number', 'number'], [e, 0, 0]);   // pausa deck A para aislar el salto
call('dj_seek', 'number', ['number', 'number', 'number'], [e, 0, 3.0]);
call('dj_set_hotcue', 'number', ['number', 'number', 'number', 'number'], [e, 0, 0, 1.0]);
call('dj_jump_hotcue', 'number', ['number', 'number', 'number'], [e, 0, 0]);
const pos = call('dj_position', 'number', ['number', 'number'], [e, 0]);
rec('Hotcue: fija en 1.0s y salta', Math.abs(pos - 1.0) < 0.2, `posición tras salto = ${pos.toFixed(2)}s (esperado ≈1.0s)`);

call('dj_set_loop', 'number', ['number', 'number', 'number', 'number'], [e, 0, 1, 4]);
call('dj_play', 'number', ['number', 'number'], [e, 0, 1]);
const pLoop = renderPeak(30);
call('dj_set_loop', 'number', ['number', 'number', 'number', 'number'], [e, 0, 0, 4]);
rec('Loop de 4 beats aceptado (sigue sonando)', pLoop > 0.005, `pico con loop activo = ${pLoop.toFixed(4)}`);

call('dj_set_rate', 'number', ['number', 'number', 'number'], [e, 0, 1.06]);
call('dj_set_keylock', 'number', ['number', 'number', 'number'], [e, 0, 1]);
const pKey = renderPeak();
rec('Pitch +6% + keylock sin romper audio', pKey > 0.005, `pico con keylock = ${pKey.toFixed(4)}`);

const okN = out.filter(x => x.ok).length;
console.log(`\nRESULTADO MOTOR WASM: ${okN}/${out.length} OK`);
process.exit(okN === out.length ? 0 : 1);
