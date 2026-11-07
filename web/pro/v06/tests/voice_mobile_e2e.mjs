// Fase 6 · Voz y móvil en Chromium (consola v0.6 → proxy → agente real con motor simulado).
// El micrófono se SIMULA con un SpeechRecognition falso inyectado antes de cargar la página (Chromium
// sin pantalla no tiene micrófono ni servicio de dictado). Los teléfonos se EMULAN (tamaño, toque, UA):
// esto NO sustituye la prueba en un iPhone/Android físico (ver deploy/PROBAR_IPHONE.md).
// Uso: PYTHON=… node web/pro/v06/tests/voice_mobile_e2e.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const PY = process.env.PYTHON || 'python3';
const SHOTS = process.env.SHOTS || '';
const TOK = 'tok-operador-voz-01';
const AG = 18805, WEB = 18106;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLA ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(150); }
  return false;
}
function start(cmd, args, env, cwd, ready) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no arrancó: ' + cmd)), 30000);
    const on = (d) => { if (String(d).includes(ready)) { clearTimeout(t); res(p); } };
    p.stdout.on('data', on); p.stderr.on('data', on);
  });
}
const api = (path, opts = {}) => fetch(`http://127.0.0.1:${AG}/api/v1/dj-agent${path}`,
  { ...opts, headers: { authorization: 'Bearer ' + TOK, 'content-type': 'application/json' } }).then((r) => r.json());

// SpeechRecognition falso: window.__voz = {modo:'ok'|'deny'|'nospeech', texto:'…'}
const FAKE_SR = () => {
  window.__voz = { modo: 'ok', texto: 'salta la canción', inicios: 0 };
  class FakeSR {
    start() {
      window.__voz.inicios++;
      const v = window.__voz;
      setTimeout(() => {
        if (v.modo === 'deny') { this.onerror && this.onerror({ error: 'not-allowed' }); this.onend && this.onend(); return; }
        if (v.modo === 'nospeech') { this.onerror && this.onerror({ error: 'no-speech' }); this.onend && this.onend(); return; }
        if (v.modo === 'hold') return;   // queda escuchando hasta stop()
        const words = v.texto.split(' ');
        const partial = [{ 0: { transcript: words.slice(0, 1).join(' ') }, isFinal: false, length: 1 }];
        this.onresult && this.onresult({ resultIndex: 0, results: partial });
        setTimeout(() => {
          this.onresult && this.onresult({ resultIndex: 0, results: [{ 0: { transcript: v.texto }, isFinal: true, length: 1 }] });
          this.onend && this.onend();
        }, 120);
      }, 120);
    }
    stop() { setTimeout(() => this.onend && this.onend(), 30); }
  }
  window.SpeechRecognition = FakeSR;
};

const db = join(mkdtempSync(join(tmpdir(), 'as-voz-')), 'agent.db');
const agent = await start(PY, ['-m', 'uvicorn', '--factory', 'app.main:create_app', '--host', '127.0.0.1', '--port', String(AG)],
  { DJ_AGENT_DB_PATH: db, DJ_AGENT_ENGINE: 'fake', DJ_AGENT_DEV_TOKENS: `${TOK}:ana:operator:org1` },
  join(REPO, 'services/dj-agent'), 'Uvicorn running');
const web = await start(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: `http://127.0.0.1:${AG}` }, REPO, 'AUDIT SOUND PRO en');
const browser = await chromium.launch();
const errors = [];
const URL = `http://127.0.0.1:${WEB}/v06/`;
const toastText = (p) => p.locator('#toast').innerText().catch(() => '');

try {
  // ---------- A) Dictado en escritorio, sin agente conectado ----------
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript(FAKE_SR);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL); await page.locator('button[data-action=guest]').click();
  await page.locator('button.navbtn[data-page=agente]').first().click();
  const before = await page.locator('#agent-chat .bubble.user').count();
  await page.locator('button[data-action=agent-voice]').first().click();
  ok(await until(async () => (await page.inputValue('form[data-form=agent] textarea')) === 'salta la canción'),
    'el dictado escribe la transcripción en el cuadro (parcial y luego final)');
  ok((await page.locator('#agent-chat').innerText()).includes('AUDIT SOUND no graba ni guarda el audio'), 'aviso de privacidad la primera vez');
  ok(await page.locator('#agent-chat .bubble.user').count() === before, 'el dictado NO envía la orden solo');
  ok((await toastText(page)).includes('revísalo'), 'pide revisar antes de enviar');

  await page.evaluate(() => { window.__voz.modo = 'hold'; });
  await page.locator('button[data-action=agent-voice]').first().click();
  ok(await until(async () => (await page.locator('button[data-action=agent-voice]').first().innerText()).includes('Detener')), 'el botón cambia a «Detener dictado» mientras escucha');
  await page.locator('button[data-action=agent-voice]').first().click();
  ok(await until(async () => !(await page.locator('button[data-action=agent-voice]').first().innerText()).includes('Detener')), 'se puede detener el dictado');

  await page.evaluate(() => { window.__voz.modo = 'deny'; });
  await page.locator('button[data-action=agent-voice]').first().click();
  ok(await until(async () => (await toastText(page)).includes('Permiso de micrófono denegado')), 'permiso denegado: mensaje claro en español');
  await page.evaluate(() => { window.__voz.modo = 'nospeech'; });
  await page.locator('button[data-action=agent-voice]').first().click();
  ok(await until(async () => (await toastText(page)).includes('No se oyó nada')), 'sin voz: mensaje claro en español');
  await ctx.close();

  // ---------- B) Navegador sin dictado ----------
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(URL); await p2.locator('button[data-action=guest]').click();
  await p2.locator('button.navbtn[data-page=agente]').first().click();
  await p2.locator('button[data-action=agent-voice]').first().click();
  ok(await until(async () => (await toastText(p2)).includes('no admite dictado')), 'navegador sin dictado: avisa y deja escribir');
  await ctx2.close();

  // ---------- C) Teléfonos emulados con el agente real ----------
  for (const name of ['iPhone 13', 'Pixel 7']) {
    const c = await browser.newContext({ ...devices[name] });
    await c.addInitScript(FAKE_SR);
    const m = await c.newPage();
    m.on('pageerror', (e) => errors.push(name + ': ' + String(e)));
    await m.goto(URL); await m.locator('button[data-action=guest]').tap();
    await m.locator('button[data-action=mobile-nav]').tap();
    await m.locator('nav.mobile-nav button[data-page=agente]').tap();
    await m.fill('form[data-form=agent-link] input[name=token]', TOK);
    await m.locator('form[data-form=agent-link] button[type=submit]').tap();
    ok(await until(async () => (await m.locator('main').innerText()).includes('EVENTOS EN VIVO')), `${name}: conectado al agente`);
    const sid = (await api('/sessions')).find((s) => s.state !== 'STOPPED').id;

    const bar = await m.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().height));
    ok(bar <= 110, `${name}: la barra superior fija no tapa la pantalla (${bar}px de alto)`);
    const overflow = await m.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `${name}: sin desplazamiento horizontal (${overflow}px)`);
    const small = await m.evaluate(() => [...document.querySelectorAll('main button[data-action=set-mode], main button[data-action=agent-voice], main form[data-form=agent] button[type=submit], main button[data-action=agent-disconnect]')]
      .filter((b) => b.offsetParent).map((b) => [b.textContent.trim(), Math.round(b.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
    ok(small.length === 0, `${name}: botones principales con al menos 44 px de alto` + (small.length ? ' ' + JSON.stringify(small) : ''));

    await m.locator('main button[data-action=set-mode][data-mode=automatico]').tap();
    ok(await until(async () => (await api('/sessions/' + sid)).mode === 'AUTOMATICO'), `${name}: el modo se cambia con un toque y se aplica en el servidor`);

    await m.locator('main button[data-action=agent-voice]').first().tap();
    await until(async () => (await m.inputValue('form[data-form=agent] textarea')) === 'salta la canción');
    await m.locator('form[data-form=agent] button[type=submit]').tap();
    ok(await until(async () => (await m.locator('#agent-chat').innerText()).includes('Agente DJ · reglas')), `${name}: orden dictada respondida por el agente`);
    const evs = await api(`/sessions/${sid}/events`);
    const parsed = evs.filter((e) => e.type === 'agent.intent.parsed');
    ok(parsed.length && parsed[parsed.length - 1].payload.channel === 'voice', `${name}: la auditoría registra el canal «voice»`);
    if (SHOTS) await m.screenshot({ path: join(SHOTS, `v06_${name.replace(/ /g, '_')}_agente.png`), fullPage: false });

    // escrita a mano → canal «text»
    await m.fill('form[data-form=agent] textarea', 'sube la energía');
    await m.locator('form[data-form=agent] button[type=submit]').tap();
    await until(async () => (await api(`/sessions/${sid}/events`)).filter((e) => e.type === 'agent.intent.parsed').length > parsed.length);
    const evs2 = (await api(`/sessions/${sid}/events`)).filter((e) => e.type === 'agent.intent.parsed');
    ok(evs2[evs2.length - 1].payload.channel === 'text', `${name}: una orden escrita queda como canal «text»`);

    // sin red y vuelta: se reconecta solo
    await c.setOffline(true);
    await m.evaluate(() => window.dispatchEvent(new Event('offline')));
    ok(await until(async () => (await m.locator('main').innerText()).includes('RECONECTANDO EVENTOS')), `${name}: sin red avisa y marca reconexión`);
    await c.setOffline(false);
    await m.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
    ok(await until(async () => (await m.locator('main').innerText()).includes('EVENTOS EN VIVO'), 20000), `${name}: al volver la red se reconecta sin recargar`);
    await m.locator('main button[data-action=agent-disconnect]').tap();
    await c.close();
  }
} catch (e) {
  ok(false, 'excepción: ' + (e && e.stack || e));
}
ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); web.kill(); agent.kill();
console.log(fails ? `\n${fails} FALLA(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);
