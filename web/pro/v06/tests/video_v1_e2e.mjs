// Bloque 2 · V1 en Chromium: compositor de video por GPU. Usa dos videos de color sólido (rojo y azul)
// para comprobar la mezcla píxel a píxel: fundido, corte, barrido, brillo, texto, logo, programa,
// que la reproducción NO se reinicia al redibujar y que la biblioteca de videos persiste al recargar.
// Uso: node web/pro/v06/tests/video_v1_e2e.mjs (desde la raíz del repo).
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const WEB = 18000 + Math.floor(Math.random() * 1000);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(120); }
  return false;
}
const near = (px, rgb, tol = 40) => px && rgb.every((v, i) => Math.abs(px[i] - v) <= tol);

const web = spawn(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { env: { ...process.env, PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
const browser = await chromium.launch();
const errors = [];
const URL = `http://127.0.0.1:${WEB}/v06/`;

async function enter(p, page = 'video') {
  await p.goto(URL); await p.locator('button[data-action=guest]').click();
  await p.locator(`button.navbtn[data-page=${page}]`).first().click();
}
const setRange = (p, change, v) => p.evaluate(([c, v]) => {
  const el = document.querySelector(`input[data-change="${c}"]`); el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, [change, v]);
const setSelect = (p, change, v) => p.evaluate(([c, v]) => {
  const el = document.querySelector(`[data-change="${c}"]`); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true }));
}, [change, v]);
const px = (p, x, y, which = 'mix') => p.evaluate(([w, x, y]) => window.__ASVJ.sample(w, x, y), [which, x, y]);
const settle = () => sleep(350);
// Espera (hasta 4 s) a que el píxel llegue al color esperado: en máquinas lentas el compositor dibuja
// menos cuadros por segundo y una lectura a tiempo fijo puede ver el cuadro anterior.
async function pxIs(p, x, y, rgb, tol = 40, which = 'mix') {
  let last = null;
  const okk = await until(async () => { last = await px(p, x, y, which); return near(last, rgb, tol); }, 4000);
  return okk;
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await enter(p);
  ok(await until(() => p.evaluate(() => window.__ASVJ && window.__ASVJ.mode)), 'compositor iniciado');
  const mode = await p.evaluate(() => window.__ASVJ.mode);
  ok(mode === 'GPU (WebGL)', 'mezcla por GPU: ' + mode);
  ok(await p.locator('#vj-mode').innerText() === mode, 'la pantalla informa el modo del compositor');

  await p.locator('input[data-file="video-A"]').setInputFiles(join(HERE, 'video_rojo.webm'));
  await p.locator('input[data-file="video-B"]').setInputFiles(join(HERE, 'video_azul.webm'));
  ok(await until(() => p.evaluate(() => window.__ASVJ.video('A').ready >= 2 && window.__ASVJ.video('B').ready >= 2)), 'videos cargados en los decks A y B');
  await p.locator('button[data-action=video-loop][data-deck=A]').click();
  await p.locator('button[data-action=video-play][data-deck=A]').click();
  await p.locator('button[data-action=video-loop][data-deck=B]').click();
  await p.locator('button[data-action=video-play][data-deck=B]').click();
  ok(await until(() => p.evaluate(() => !window.__ASVJ.video('A').paused && window.__ASVJ.video('A').time > 0.3)), 'el deck A reproduce');

  // Fundido
  await setSelect(p, 'video-transition', 'fade');
  await setRange(p, 'video-cross', 0); await settle();
  ok(await pxIs(p, 0.5, 0.5, [255, 0, 0]), 'crossfader en A → rojo');
  await setRange(p, 'video-cross', 100); await settle();
  ok(await pxIs(p, 0.5, 0.5, [0, 0, 255]), 'crossfader en B → azul');
  await setRange(p, 'video-cross', 50); await settle();
  const mid = await px(p, 0.5, 0.5);
  ok(near(mid, [128, 0, 128], 30), 'fundido al 50 % → mezcla de ambos: ' + mid.slice(0, 3));
  // Corte
  await setSelect(p, 'video-transition', 'cut');
  await setRange(p, 'video-cross', 45); await settle();
  ok(await pxIs(p, 0.5, 0.5, [255, 0, 0]), 'corte por debajo de la mitad → solo A');
  await setRange(p, 'video-cross', 55); await settle();
  ok(await pxIs(p, 0.5, 0.5, [0, 0, 255]), 'corte por encima de la mitad → solo B');
  // Barrido
  await setSelect(p, 'video-transition', 'wipe');
  await setRange(p, 'video-cross', 50); await settle();
  ok(await pxIs(p, 0.25, 0.5, [0, 0, 255]) && await pxIs(p, 0.75, 0.5, [255, 0, 0]), 'barrido al 50 %: izquierda B, derecha A');

  // El redibujo de la página NO reinicia la reproducción
  const t1 = await p.evaluate(() => window.__ASVJ.video('A').time);
  await setSelect(p, 'video-transition', 'fade'); await sleep(600);
  const vA = await p.evaluate(() => window.__ASVJ.video('A'));
  ok(vA.connected && !vA.paused && (vA.time > t1 || vA.time < 1), 'redibujar la página no detiene ni reinicia el video');

  // Efectos
  await setRange(p, 'video-cross', 0);
  await setSelect(p, 'visual-fx', 'brightness'); await setRange(p, 'video-fx-amount', 0); await settle();
  const dark = await px(p, 0.5, 0.5);
  ok(dark[0] < 110 && dark[0] > 40, 'brillo al mínimo oscurece la imagen: ' + dark.slice(0, 3));
  await setSelect(p, 'visual-fx', 'blur'); await setRange(p, 'video-fx-amount', 100); await settle();
  ok(await pxIs(p, 0.5, 0.5, [255, 0, 0]), 'desenfoque sobre color sólido conserva el color');
  await setSelect(p, 'visual-fx', 'glitch'); await settle();
  const d0 = await p.evaluate(() => window.__ASVJ.drawn); await sleep(500);
  ok((await p.evaluate(() => window.__ASVJ.drawn)) > d0, 'el efecto glitch sigue dibujando cuadros');
  await setSelect(p, 'visual-fx', 'none');

  // Texto y logo
  await p.locator('input[data-change="caption"]').fill('Gala AuditConsulting 2026');
  await p.locator('input[data-change="caption"]').dispatchEvent('change'); await settle();
  const band = await px(p, 0.97, 0.896);
  ok(band[0] < 120, 'el texto de superposición dibuja su franja inferior: ' + band.slice(0, 3));
  await p.goto(URL + '#'); // vuelve a entrar para importar el logo por la biblioteca
  await enter(p, 'biblioteca');
  await p.locator('input[data-file="library"]').setInputFiles(join(HERE, 'logo_prueba.png'));
  await p.locator('button.navbtn[data-page=video]').first().click();
  ok(await until(() => p.evaluate(() => document.querySelectorAll('select[data-change="video-logo"] option').length >= 2)), 'el logo importado aparece en «Logo»');
  const logoId = await p.evaluate(() => document.querySelectorAll('select[data-change="video-logo"] option')[1].value);
  await setSelect(p, 'video-logo', logoId); await sleep(500);
  const logoPx = await px(p, 1 - (36 + 80) / 1280, (32 + 50) / 720);
  ok(logoPx[0] > 180 && logoPx[1] > 180 && logoPx[2] < 120, 'el logo se dibuja arriba a la derecha: ' + logoPx.slice(0, 3));

  // Persistencia: tras recargar, los videos siguen en la biblioteca
  await p.reload(); await enter(p, 'video');
  ok(await until(() => p.evaluate(() => document.querySelectorAll('select[data-change="video-pick"] option').length >= 3)), 'tras recargar, los videos siguen en la biblioteca');
  ok(await p.evaluate(() => document.querySelector('input[data-change="caption"]').value) === 'Gala AuditConsulting 2026', 'el texto de superposición se conserva');
  const ids = await p.evaluate(() => [...document.querySelectorAll('select[data-change="video-pick"][data-deck=A] option')].map((o) => [o.value, o.textContent]));
  const rojo = ids.find((x) => x[1] === 'video_rojo'), azul = ids.find((x) => x[1] === 'video_azul');
  await setSelect(p, 'video-pick', rojo[0]);
  ok(await until(() => p.evaluate(() => window.__ASVJ.video('A').ready >= 2)), 'elegir un video de la biblioteca lo carga en el deck');
  await p.locator('button[data-action=video-loop][data-deck=A]').click();   // el video de prueba dura 6 s
  await p.locator('button[data-action=video-play][data-deck=A]').click();
  await setSelect(p, 'video-logo', ''); await p.locator('input[data-change="caption"]').fill(''); await p.locator('input[data-change="caption"]').dispatchEvent('change');
  await setRange(p, 'video-cross', 0); await settle();
  ok(await pxIs(p, 0.5, 0.5, [255, 0, 0]), 'el video recuperado se ve en la mezcla');

  // Programa
  await p.locator('button[data-action=video-take]').first().click(); await settle();
  ok(await pxIs(p, 0.5, 0.5, [255, 0, 0], 40, 'program'), '«Enviar a programa» muestra la mezcla en la salida');
  await p.locator('button[data-action=video-stop]').click(); await settle();
  const off = await px(p, 0.1, 0.1, 'program');
  ok(off[0] < 30 && off[2] < 30, '«Detener» deja el programa en negro');

  // Consola: el video sigue sonando al cambiar de pantalla y la previsualización muestra la mezcla
  await p.locator('button.navbtn[data-page=consola]').first().click(); await settle();
  ok(await p.evaluate(() => !window.__ASVJ.video('A').paused), 'al ir a la consola el video sigue reproduciéndose');
  ok(await p.locator('[data-vslot=preview] canvas').count() === 1, 'la consola muestra la mezcla en «Previsualización»');
  await sleep(1200);
  const fps = await p.evaluate(() => window.__ASVJ.fps);
  // Umbral mínimo de humo (las máquinas de CI sin GPU dan ~16; aquí ~30): detecta un compositor trabado,
  // no mide el rendimiento real del equipo del DJ (eso es prueba física).
  ok(fps >= 8, 'rendimiento del compositor: ' + fps + ' cuadros/s');

  // Quitar de la biblioteca: desaparece también tras recargar
  await p.locator('button.navbtn[data-page=biblioteca]').first().click();
  await p.locator(`button[data-action=track-delete][data-id="${azul[0]}"]`).click();
  await sleep(300); await p.reload(); await enter(p, 'video'); await sleep(600);
  const left = await p.evaluate(() => [...document.querySelectorAll('select[data-change="video-pick"][data-deck=A] option')].map((o) => o.textContent));
  ok(!left.includes('video_azul') && left.includes('video_rojo'), 'quitar un video lo borra de la biblioteca guardada');
  await ctx.close();

  // Teléfono: sin desplazamiento horizontal
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); mp.on('pageerror', (e) => errors.push(String(e)));
  await mp.goto(URL); await mp.locator('button[data-action=guest]').click();
  await mp.evaluate(() => document.querySelector('button.navbtn[data-page=video]').click()); await sleep(500);
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'en teléfono la mezcladora no se desborda');
  await m.close();

  // Sin GPU: respaldo en Canvas 2D con la misma mezcla
  const b2 = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
  const c2 = await b2.newContext(); const q = await c2.newPage(); q.on('pageerror', (e) => errors.push(String(e)));
  await enter(q);
  ok(await until(() => q.evaluate(() => window.__ASVJ && window.__ASVJ.mode === 'Canvas 2D (sin GPU)')), 'sin WebGL usa el respaldo Canvas 2D');
  await q.locator('input[data-file="video-A"]').setInputFiles(join(HERE, 'video_rojo.webm'));
  await q.locator('input[data-file="video-B"]').setInputFiles(join(HERE, 'video_azul.webm'));
  await until(() => q.evaluate(() => window.__ASVJ.video('A').ready >= 2 && window.__ASVJ.video('B').ready >= 2));
  await setRange(q, 'video-cross', 50); await settle();
  ok(await pxIs(q, 0.5, 0.5, [128, 0, 128], 30), 'respaldo 2D: fundido al 50 % mezcla ambos');
  await setSelect(q, 'video-transition', 'wipe'); await settle();
  ok(await pxIs(q, 0.25, 0.5, [0, 0, 255]) && await pxIs(q, 0.75, 0.5, [255, 0, 0]), 'respaldo 2D: barrido');
  await b2.close();
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
}
ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); web.kill();
console.log(fails ? `\n${fails} FALLA(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);
