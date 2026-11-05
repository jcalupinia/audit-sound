// Pruebas unitarias del buscador unificado (search.js). Node: `node web/pro/search_test.mjs`.
// Cubren A2 y las correcciones A4.2 (licencia por pista, dedup por versión, cancelación).
import * as S from './search.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// --- fmtDuration / versionTag ---
ok(S.fmtDuration(0) === '—' && S.fmtDuration(65) === '1:05', 'fmtDuration');
ok(S.versionTag('Tema (Live at X)') === 'live' && S.versionTag('Tema - Radio Edit') === 'radio', 'versionTag detecta variantes');

// --- A4.2-A: licencia por pista ---
ok(S.classifyLicense('http://creativecommons.org/licenses/by/3.0/', S.AVAIL.PREVIEW).availability === 'mezclar', 'CC BY → mezclar');
ok(S.classifyLicense('http://creativecommons.org/licenses/by-sa/3.0/', S.AVAIL.PREVIEW).availability === 'mezclar', 'CC BY-SA → mezclar');
const nc = S.classifyLicense('http://creativecommons.org/licenses/by-nc/4.0/', S.AVAIL.PREVIEW);
ok(nc.availability === 'previsualizar' && nc.restrictions.includes('NC'), 'CC BY-NC → previsualizar + restricción NC');
const nd = S.classifyLicense('http://creativecommons.org/licenses/by-nd/4.0/', S.AVAIL.PREVIEW);
ok(nd.availability === 'previsualizar' && nd.restrictions.includes('ND'), 'CC BY-ND → previsualizar + restricción ND');
ok(S.classifyLicense('', S.AVAIL.PREVIEW).availability === 'previsualizar', 'Jamendo licencia desconocida → previsualizar (conservador)');
ok(S.classifyLicense('', S.AVAIL.LOOKUP).availability === 'consultar', 'Archive licencia desconocida → consultar (conservador)');
ok(S.classifyLicense('All Rights Reserved', S.AVAIL.LOOKUP).availability === 'consultar', 'todos los derechos → consultar');
// normLibre ya NO marca todo como mezclar:
ok(S.normLibre({ id: '1', title: 'T', artist: 'A', license: 'http://creativecommons.org/licenses/by-nc/4.0/' }).availability === 'previsualizar',
   'normLibre con NC → previsualizar (no mezclar)');
ok(S.normLibre({ id: '2', title: 'T', artist: 'A', license: 'http://creativecommons.org/licenses/by/3.0/' }).availability === 'mezclar',
   'normLibre con BY → mezclar');

// --- A4.2-B: dedup conservador (no fusiona versiones/álbumes/duraciones distintas) ---
const mk = (o) => S.normLibre(Object.assign({ license: 'http://creativecommons.org/licenses/by/3.0/' }, o));
ok(S.dedupe([mk({ id: 'a', title: 'Tema', artist: 'X', duration: 200 }),
             mk({ id: 'b', title: 'Tema (Remix)', artist: 'X', duration: 200 })]).length === 2,
   'no fusiona original vs remix');
ok(S.dedupe([mk({ id: 'a', title: 'Tema', artist: 'X', duration: 200, album: 'Album1' }),
             mk({ id: 'b', title: 'Tema', artist: 'X', duration: 200, album: 'Album2' })]).length === 2,
   'no fusiona misma pista en álbumes distintos');
ok(S.dedupe([mk({ id: 'a', title: 'Tema', artist: 'X', duration: 200 }),
             mk({ id: 'b', title: 'Tema', artist: 'X', duration: 260 })]).length === 2,
   'no fusiona duraciones muy distintas');
// SÍ fusiona la misma grabación en dos fuentes (local mezclar + archive consultar) → conserva mezclar
const cross = S.dedupe([S.normLocal({ id: 'L', name: 'X - Tema.mp3', duration: 200 }),
                        S.normArchive({ id: 'A', title: 'Tema', artist: 'X', duration: 200, license: 'All Rights Reserved' })]);
ok(cross.length === 1 && cross[0].availability === 'mezclar' && cross[0].alsoIn.includes('archive'),
   'fusiona la MISMA grabación entre fuentes y conserva la mayor disponibilidad');

// --- A2: searchAll paralelo, error por proveedor, filtro, timeout ---
const pOk = { source: 'libre', label: 'Libre', search: async () => [mk({ id: '1', title: 'Uno', artist: 'X' })] };
const pErr = { source: 'archive', label: 'Archive', search: async () => { throw new Error('API 429'); } };
const r1 = await S.searchAll('q', { providers: [pOk, pErr], timeoutMs: 2000 });
ok(r1.results.length === 1 && r1.errors.length === 1, 'searchAll: un proveedor falla, otro responde');

// --- A4.2-C: cancelación con AbortSignal ---
const ac = new AbortController();
const pSlow = { source: 'navidrome', label: 'Navidrome', search: (q, n, signal) => new Promise((res, rej) => {
  const t = setTimeout(() => res([]), 5000);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); });
}) };
const pr = S.searchAll('q', { providers: [pSlow], signal: ac.signal, timeoutMs: 9000 });
setTimeout(() => ac.abort(), 100);
let aborted = false;
try { await pr; } catch (e) { aborted = (e && e.name === 'AbortError'); }
ok(aborted, 'searchAll rechaza con AbortError al cancelar (consulta obsoleta)');

// --- límite de resultados ---
const many = Array.from({ length: 500 }, (_, i) => ({ source: 'libre', label: 'L', search: async () => [] }));
const big = { source: 'libre', label: 'L', search: async () => Array.from({ length: 500 }, (_, i) => mk({ id: 'x' + i, title: 'T' + i, artist: 'A' + i })) };
const r2 = await S.searchAll('q', { providers: [big], maxTotal: 200 });
ok(r2.results.length === 200, 'searchAll aplica el tope de resultados (memoria)');

console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
