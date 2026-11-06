// Prueba unitaria del Generador de sets por IA (Fase 3C): el intérprete de la petición y
// el ordenador por energía/BPM. Funciones puras (sin navegador), corre en node/CI.
//   node web/pro/setai_test.mjs
import { parseRequest, orderTracks } from './console_setai.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  OK  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// --- parseRequest: género/artista, nº de pistas, energía ---
let r = parseRequest('lofi 30 min que suba de energía');
ok(r.query === 'lofi' && r.count === 9 && r.energy === 'up', 'lofi 30 min ↑ → query=lofi, 9 pistas (30/3.5), energía ascendente');

r = parseRequest('cumbia, 12 pistas');
ok(r.query === 'cumbia' && r.count === 12 && r.energy === 'flat', 'cumbia 12 pistas → query limpia (sin coma), 12 pistas, energía pareja');

r = parseRequest('un set de salsa de 1 hora que baje de energía');
ok(r.query === 'salsa' && r.count === 17 && r.energy === 'down', 'salsa 1 hora ↓ → query=salsa, 17 pistas (60/3.5), energía descendente');

r = parseRequest('reggaeton 8 canciones');
ok(r.query === 'reggaeton' && r.count === 8, 'reggaeton 8 canciones → query=reggaeton, 8 pistas');

r = parseRequest('');
ok(r.query === '' && r.count === 10 && r.energy === 'flat', 'vacío → sin query (toda la biblioteca), 10 pistas por defecto');

r = parseRequest('pon 999 pistas');
ok(r.count === 30, 'tope de 30 pistas');

// --- orderTracks: arco de energía / BPM ---
const te = [{ name: 'a', energy: 0.9 }, { name: 'b', energy: 0.2 }, { name: 'c', energy: 0.5 }];
ok(orderTracks(te, 'up').map((x) => x.name).join('') === 'bca', 'energía ascendente ordena menos→más (b,c,a)');
ok(orderTracks(te, 'down').map((x) => x.name).join('') === 'acb', 'energía descendente ordena más→menos (a,c,b)');
const tb = [{ name: 'x', bpm: 140 }, { name: 'y', bpm: 90 }, { name: 'z', bpm: 120 }];
ok(orderTracks(tb, 'flat').map((x) => x.name).join('') === 'yzx', 'sin energía: ordena por BPM para suavizar (y,z,x)');

console.log(`\nRESULTADO: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
