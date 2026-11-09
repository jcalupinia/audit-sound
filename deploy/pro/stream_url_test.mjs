// El servidor publica en config.js la URL del stream de audio para los reproductores.
// Antes solo publicaba LISTEN_URL y escuchar.html / «Escuchar en vivo» pedían /stream.mp3 a este
// mismo servidor, que no lo sirve (404 en producción: «no suena nada»).
// Uso: node deploy/pro/stream_url_test.mjs   (desde la raíz del repo)
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };

const { streamUrlFor } = require('./server.js');
ok(streamUrlFor('', 'https://audit-sound.audit-ia.ec') === 'https://audit-sound.audit-ia.ec/stream.mp3', 'sin STREAM_URL: LISTEN_URL + /stream.mp3');
ok(streamUrlFor('', 'https://audit-sound.audit-ia.ec/') === 'https://audit-sound.audit-ia.ec/stream.mp3', 'quita la barra final de LISTEN_URL');
ok(streamUrlFor('https://radio.ejemplo/live.mp3', 'https://otro') === 'https://radio.ejemplo/live.mp3', 'STREAM_URL manda');
ok(streamUrlFor('', '') === '', 'sin ninguna: no se publica');
ok(streamUrlFor('javascript:alert(1)', '') === '' && streamUrlFor('', 'https://x/"><script>') === '', 'rechaza URLs que no son http(s) o traen caracteres peligrosos');

async function configFor(env) {
  const root = mkdtempSync(join(tmpdir(), 'as_cfg_'));
  cpSync(join(HERE, '../../web/pro/escuchar.html'), join(root, 'escuchar.html'));
  const port = 19000 + Math.floor(Math.random() * 900);
  const p = spawn(process.execPath, [join(HERE, 'server.js')], { env: { ...process.env, ...env, PORT: String(port), WEB_ROOT: root, DJ_AGENT_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((r) => p.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
  try { return await (await fetch(`http://127.0.0.1:${port}/config.js`)).text(); } finally { p.kill(); }
}
const c1 = await configFor({ LISTEN_URL: 'https://audit-sound.audit-ia.ec', STREAM_URL: '' });
ok(c1.includes('window.AUDIT_SOUND_STREAM="https://audit-sound.audit-ia.ec/stream.mp3"'), 'config.js publica AUDIT_SOUND_STREAM a partir de LISTEN_URL (caso de producción)');
const c2 = await configFor({ LISTEN_URL: '', STREAM_URL: '' });
ok(!c2.includes('AUDIT_SOUND_STREAM'), 'sin LISTEN_URL ni STREAM_URL no se publica nada');
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);
