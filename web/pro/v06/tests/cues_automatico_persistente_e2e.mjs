// Cues de eventos: «Automático» sobrevive a una recarga y los cues vencidos con la consola cerrada se avisan
// (no se ejecutan solos). Regresión del hallazgo H-02: antes «⏰ Automático: SÍ» volvía a «NO» al recargar
// y los cues programados dejaban de dispararse sin ningún aviso.
// El reloj del navegador se fija con Playwright (11:40 → 12:00) para que la prueba no dependa de la hora real.
// Uso: node web/pro/v06/tests/cues_automatico_persistente_e2e.mjs (desde la raíz del repo).
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
async function until(fn, ms = 8000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) { /* reintenta */ } await sleep(100); } return false; }
const setSelect = (p, sel, v) => p.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
const nav = (p, page) => p.evaluate((pg) => document.querySelector(`button.navbtn[data-page=${pg}]`).click(), page);
const vx = (p) => p.evaluate(() => window.__ASVX.state());
const autoTxt = async (p) => (await p.locator('button[data-action=vx-cue-auto]').textContent()).trim();
const entrar = async (p) => { await p.locator('button[data-action=guest]').click(); await nav(p, 'eventos'); };
// Hora local fija de hoy (el navegador y Node comparten la zona horaria de la máquina).
const hoy = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };

const web = spawn(process.execPath, [join(REPO, 'deploy/pro/server.js')],
  { env: { ...process.env, PORT: String(WEB), WEB_ROOT: join(REPO, 'web/pro'), DJ_AGENT_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => web.stdout.on('data', (d) => String(d).includes('AUDIT SOUND PRO en') && r()));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.clock.install({ time: hoy(11, 40) });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${WEB}/v06/`);
  await entrar(p);

  // Contenido para los cues: una foto en la biblioteca (por la mezcladora de video, como el resto de pruebas).
  await nav(p, 'video');
  await p.locator('input[data-file="video-A"]').setInputFiles(join(HERE, 'foto_verde.png'));
  ok(await until(async () => (await p.evaluate(() => window.__ASVX.tracks())).some((t) => t.kind === 'image')), 'foto cargada en la biblioteca');
  const fotoId = await p.evaluate(() => window.__ASVX.tracks().find((t) => t.kind === 'image').id);
  await nav(p, 'eventos');
  const crearCue = async (hora, nombre) => {
    await p.fill('form[data-form=cue] input[name=time]', hora);
    await p.fill('form[data-form=cue] input[name=name]', nombre);
    await setSelect(p, 'form[data-form=cue] select[name=item]', fotoId);
    await p.locator('form[data-form=cue] button[type=submit]').click();
    await until(async () => (await vx(p)).cues.some((c) => c.name === nombre));
  };
  await crearCue('11:30', 'Ya pasado');   // antes de activar «Automático»: no debe avisarse
  await crearCue('11:50', 'Discurso');    // vencerá con la consola cerrada
  await crearCue('12:30', 'Cierre');      // todavía no llega

  ok(/NO/.test(await autoTxt(p)), 'por defecto «Automático: NO»');
  await p.locator('button[data-action=vx-cue-auto]').click();
  ok(/SÍ/.test(await autoTxt(p)), 'se activa «Automático: SÍ»');

  // 1) Recarga inmediata: «Automático» se conserva y se avisa.
  await p.reload(); await entrar(p);
  ok(/SÍ/.test(await autoTxt(p)), `tras recargar sigue «Automático: SÍ» (antes volvía a «NO»): «${await autoTxt(p)}»`);
  ok(await until(async () => /Cues automáticos activos/.test(await p.evaluate(() => document.querySelector('#toast')?.textContent || '')), 4000),
    'al volver, un aviso confirma que los cues automáticos siguen activos');
  ok(await p.locator('[data-cues-perdidos]').count() === 0, 'sin cues vencidos: no aparece la lista de cues no ejecutados');

  // 2) La consola queda «cerrada» de 11:40 a 12:00: el cue de las 11:50 vence sin pestaña.
  await p.goto('about:blank');
  await ctx.clock.setSystemTime(hoy(12, 0));
  await p.goto(`http://127.0.0.1:${WEB}/v06/`); await entrar(p);
  ok(/SÍ/.test(await autoTxt(p)), '«Automático: SÍ» se mantiene tras cerrar y volver a abrir');
  const lista = p.locator('[data-cues-perdidos]');
  ok(await lista.count() === 1, 'aparece la lista de cues que vencieron con la consola cerrada');
  const texto = (await lista.textContent()) || '';
  ok(/11:50 · Discurso/.test(texto), `la lista nombra el cue vencido (11:50 · Discurso): «${texto.slice(0, 120)}»`);
  ok(!/Ya pasado/.test(texto) && !/Cierre/.test(texto), 'no lista cues anteriores a la última revisión ni cues futuros');
  ok(await until(async () => /no se ejecutaron/.test(await p.evaluate(() => document.querySelector('#toast')?.textContent || '')), 4000),
    'el aviso dice que hubo cues que no se ejecutaron');
  await sleep(500);
  const cues = (await vx(p)).cues;
  ok(!cues.find((c) => c.name === 'Discurso').lastRun, 'el cue vencido NO se ejecuta solo al volver (podría salir fuera de tiempo)');
  ok((await vx(p)).A.kind !== 'image' && (await vx(p)).B.kind !== 'image', 'el programa no cambió por el cue vencido');

  // 3) «Entendido» retira el aviso; «Ejecutar» sigue funcionando a mano.
  await p.locator('button[data-action=vx-cue-missed-ok]').click();
  ok(await until(async () => (await p.locator('[data-cues-perdidos]').count()) === 0), '«Entendido» retira la lista');
  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'excepción: ' + e.message);
} finally {
  await browser.close(); web.kill();
}
console.log('\n' + (fails ? `${fails} FALLA(S)` : 'TODO OK'));
process.exit(fails ? 1 : 0);
