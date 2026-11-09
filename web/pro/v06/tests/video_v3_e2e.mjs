// Bloque 2 · V1b + V3 en Chromium: fotos y presentaciones (PDF → diapositivas) en los decks de video,
// videoclips con sonido (la imagen sigue al deck de audio) y cues de eventos que pasan contenido a programa.
// Fixtures: foto_verde.png, presentacion_prueba.pdf (página 1 roja, página 2 azul), videoclip_magenta.webm.
// Uso: node web/pro/v06/tests/video_v3_e2e.mjs (desde la raíz del repo).
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
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(100); }
  return false;
}
const near = (px, rgb, tol = 45) => px && rgb.every((v, i) => Math.abs(px[i] - v) <= tol);

const web = spawn(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { env: { ...process.env, PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const setRange = (p, change, v, deck) => p.evaluate(([c, v, d]) => {
  const el = document.querySelector(`input[data-change="${c}"]${d ? `[data-deck="${d}"]` : ''}`); el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, [change, v, deck]);
const setSelect = (p, sel, v) => p.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
const px = (p, which = 'mix', x = 0.5, y = 0.5) => p.evaluate(([w, x, y]) => window.__ASVJ.sample(w, x, y), [which, x, y]);
async function pxIs(p, rgb, which = 'mix', ms = 4000) {
  let last = null;
  const r = await until(async () => { last = await px(p, which); return near(last, rgb); }, ms);
  if (!r) console.log(`      (píxel ${which}: ${last && last.slice(0, 3)}; esperado ${rgb})`);
  return r;
}
const vx = (p) => p.evaluate(() => window.__ASVX.state());
const nav = (p, page) => p.evaluate((pg) => document.querySelector(`button.navbtn[data-page=${pg}]`).click(), page);

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${WEB}/v06/`);
  await p.locator('button[data-action=guest]').click();
  await nav(p, 'video');
  ok(await until(() => p.evaluate(() => window.__ASVJ && window.__ASVJ.mode)), 'compositor iniciado');

  // 1) Foto en el deck A
  await p.locator('input[data-file="video-A"]').setInputFiles(join(HERE, 'foto_verde.png'));
  ok(await until(async () => (await vx(p)).A.kind === 'image'), 'una foto se carga en el deck de video A');
  await setRange(p, 'video-cross', 0);
  ok(await pxIs(p, [0, 255, 0]), 'la foto se ve en la mezcla (verde)');

  // 2) PDF → presentación en el deck B
  await p.locator('input[data-file="video-B"]').setInputFiles(join(HERE, 'presentacion_prueba.pdf'));
  ok(await until(async () => { const s = await vx(p); return s.B.kind === 'slides' && s.pres.some((x) => x.pages === 2); }, 15000),
    'el PDF se convierte en una presentación de 2 diapositivas en el deck B');
  await setRange(p, 'video-cross', 100);
  ok(await pxIs(p, [255, 0, 0]), 'diapositiva 1 (roja) en la mezcla');
  await p.locator('button[data-action=vx-next][data-deck=B]').click();
  ok(await pxIs(p, [0, 0, 255]), '▶ pasa a la diapositiva 2 (azul)');
  ok((await p.locator('#vx-page-B').textContent()) === 'Diapositiva 2 de 2', 'la consola indica «Diapositiva 2 de 2»');
  await p.locator('button[data-action=vx-next][data-deck=B]').click();
  ok(await pxIs(p, [255, 0, 0]), '▶ en la última vuelve a la primera');
  await setSelect(p, 'select[data-change="vx-auto"][data-deck="B"]', '5');
  ok(await pxIs(p, [0, 0, 255], 'mix', 7000), 'avance automático cada 5 s');
  await setSelect(p, 'select[data-change="vx-auto"][data-deck="B"]', '0');

  // 3) La presentación sigue en la biblioteca tras recargar
  await p.reload();
  await p.locator('button[data-action=guest]').click();
  await nav(p, 'video');
  const presId = await until(async () => (await vx(p)).pres.length > 0, 6000) && (await vx(p)).pres[0].id;
  ok(!!presId, 'la presentación sigue en la biblioteca después de recargar');
  await setSelect(p, 'select[data-change="video-pick"][data-deck="B"]', presId);
  await setRange(p, 'video-cross', 100);
  ok(await pxIs(p, [255, 0, 0], 'mix', 6000), 'elegida desde la biblioteca, se ve de nuevo (diapositivas guardadas)');

  // 4) Videoclip con sonido en el lado A
  await p.locator('input[data-file="video-A"]').setInputFiles(join(HERE, 'videoclip_magenta.webm'));
  ok(await until(async () => (await vx(p)).A.kind === 'video'), 'un video reemplaza a la foto en el deck A');
  await p.locator('button[data-action=vx-clip][data-deck=A]').click();
  ok(await until(async () => (await vx(p)).A.clip), 'activar «videoclip con sonido» en el deck A');
  await nav(p, 'consola');
  ok((await p.locator('main').innerText()).toLowerCase().includes('videoclip_magenta'), 'el sonido del videoclip queda en el deck de audio A');
  await p.locator('button[data-action=deck-play][data-deck=A]').first().click();
  ok(await until(async () => { const s = await p.evaluate(() => window.__ASVX.clipSync('A')); return s && !s.aPaused && !s.vPaused && s.audio > 1; }, 8000),
    'PLAY del deck de audio A reproduce también la imagen');
  const s1 = await p.evaluate(() => window.__ASVX.clipSync('A'));
  ok(Math.abs(s1.audio - s1.video) < 0.15, `imagen y sonido sincronizados (diferencia ${Math.abs(s1.audio - s1.video).toFixed(3)} s)`);
  await setRange(p, 'deck-rate', 110, 'A');
  ok(await until(async () => Math.abs((await p.evaluate(() => window.__ASVX.clipSync('A'))).rate - 1.1) < 0.01, 3000),
    'el pitch del deck de audio (110 %) acelera también la imagen');
  await p.evaluate(() => window.__ASVX.seekAudio('A', 4));
  ok(await until(async () => { const s = await p.evaluate(() => window.__ASVX.clipSync('A')); return Math.abs(s.video - s.audio) < 0.15 && s.video > 3.9; }, 3000),
    'un salto en el audio mueve la imagen al mismo punto');
  await setRange(p, 'audio-cross', 100);
  ok(await until(async () => (await vx(p)).mix === 100, 3000), 'crossfader compartido: el de audio mueve también la mezcla de video');
  await setRange(p, 'audio-cross', 0);
  await p.locator('button[data-action=deck-play][data-deck=A]').first().click();
  ok(await until(async () => { const s = await p.evaluate(() => window.__ASVX.clipSync('A')); return s.aPaused && s.vPaused; }, 3000),
    'pausar el audio pausa la imagen');

  // 5) Cues de eventos: manual y automático
  await nav(p, 'eventos');
  await p.fill('form[data-form=cue] input[name=time]', '23:59');
  await p.fill('form[data-form=cue] input[name=name]', 'Bienvenida');
  await setSelect(p, 'form[data-form=cue] select[name=item]', presId);
  await p.locator('form[data-form=cue] button[type=submit]').click();
  ok(await until(async () => (await vx(p)).cues.some((c) => c.name === 'Bienvenida' && c.item === presId)), 'cue «Bienvenida» con la presentación elegida');
  const before = await vx(p);
  await p.locator('button[data-action=cue-execute]').first().click();
  ok(await until(async () => { const s = await vx(p); return s.live && s.B.kind === 'slides' && s.mix === 100; }, 5000),
    `«Ejecutar» carga la presentación en el deck que no estaba al aire (B) y la pasa a programa (antes mezcla ${before.mix})`);
  ok((await vx(p)).xlink === false, 'el cue desvincula el crossfader compartido del videoclip (si no, el de audio lo devolvería)');
  ok(await pxIs(p, [255, 0, 0], 'program'), 'el programa muestra la diapositiva 1');

  const hm = await p.evaluate(() => new Date().toTimeString().slice(0, 5));
  const fotoId = await p.evaluate(() => window.__ASVX.tracks().find((t) => t.kind === 'image' && t.name === 'foto_verde').id);
  await p.fill('form[data-form=cue] input[name=time]', hm);
  await p.fill('form[data-form=cue] input[name=name]', 'Foto a la hora');
  await setSelect(p, 'form[data-form=cue] select[name=item]', fotoId);
  await p.locator('form[data-form=cue] button[type=submit]').click();
  await p.locator('button[data-action=vx-cue-auto]').click();
  ok(await until(async () => { const s = await vx(p); return s.cues.find((c) => c.name === 'Foto a la hora').lastRun && s.A.kind === 'image'; }, 15000),
    'con «Automático: SÍ» el cue se ejecuta solo a su hora (foto en el deck A)');
  ok(await pxIs(p, [0, 255, 0], 'program', 6000), 'el programa termina en la foto (verde) con la transición');

  // 5b) Biblioteca: la presentación aparece como tal y al quitarla desaparece también tras recargar
  await nav(p, 'biblioteca');
  ok((await p.locator('main').innerText()).includes('PRESENTACIÓN · 2'), 'la biblioteca muestra la presentación con sus 2 diapositivas');
  await p.locator(`button[data-action=track-delete][data-id="${presId}"]`).click();
  await p.reload(); await p.locator('button[data-action=guest]').click(); await sleep(800);
  ok(!(await vx(p)).pres.some((x) => x.id === presId), 'quitar la presentación la borra de la biblioteca guardada');

  // 6) Teléfono
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const q = await ph.newPage();
  q.on('pageerror', (e) => errors.push('teléfono: ' + e));
  await q.goto(`http://127.0.0.1:${WEB}/v06/`);
  await q.locator('button[data-action=guest]').click();
  for (const pg of ['video', 'eventos']) {
    await nav(q, pg); await sleep(300);
    ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `teléfono: «${pg}» no desborda`);
  }
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
} finally {
  await browser.close();
  web.kill();
}
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);
