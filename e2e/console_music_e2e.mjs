// Auditoría empírica de web/pro/console.html (lo que el dueño usa en producción).
// Prueba botón por botón y la mezcla real de DOS canciones. Sin tocar el repo.
import { chromium } from 'playwright';
import path from 'node:path';

const DIR = process.argv[2];                 // carpeta de la auditoría
const BASE = 'http://127.0.0.1:8192';
const A = path.join(DIR, 'cancionA.wav');
const B = path.join(DIR, 'cancionB.wav');
const out = [];
const rec = (nombre, ok, detalle) => { out.push({ nombre, ok, detalle }); console.log((ok?'OK  ':'FALLA ')+nombre+' — '+detalle); };

const browser = await chromium.launch({ args: ['--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext();
// token para pasar la puerta de login
await ctx.addInitScript(() => { try { localStorage.setItem('auditsound.cc.token','test'); localStorage.setItem('auditsound.cc.user','dj@test'); } catch(e){} });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
page.on('console', m => { if (m.type()==='error') errores.push('console.error: '+m.text()); });

await page.goto(BASE + '/console.html', { waitUntil: 'networkidle' });

// 1) La imagen de la consola carga
const imgOk = await page.evaluate(() => { const i = document.querySelector('.frame img'); return !!(i && i.complete && i.naturalWidth > 0); });
rec('Imagen de la consola carga', imgOk, imgOk ? 'landing_consola.webp visible' : 'no cargó la imagen');

// 2) Inventario REAL de controles interactivos existentes en el DOM
const ids = await page.evaluate(() => ['importar','playA','playB','cueA','cueB','xfader','master','hotUser','fileIn','audioA','audioB'].filter(id => document.getElementById(id)));
rec('Controles presentes en el DOM', ids.length>=10, 'existen: '+ids.join(', '));

// 3) ¿Existe ALGÚN control para EQ/SYNC/loops/hotcues/buscador/copiloto? (debe ser NO)
const extras = await page.evaluate(() => {
  const busca = ['eq','hi','mid','low','sync','loop','hotcue','cue1','search','buscar','copilot','bpm','pitch','deck','fx','mic','video','master-ch'];
  const encontrados = [];
  for (const el of document.querySelectorAll('button,input,select,[role=button]')) {
    const t = ((el.id||'')+' '+(el.getAttribute('aria-label')||'')).toLowerCase();
    const conocidos = ['importar','playA','playB','cueA','cueB','xfader','master','hotUser','fileIn'];
    if (conocidos.includes(el.id)) continue;   // controles de música etapa 1, ya contados
    for (const k of busca) if (t.includes(k)) { encontrados.push((el.id||el.getAttribute('aria-label'))); break; }
  }
  return [...new Set(encontrados)];
});
rec('NO hay controles de EQ/SYNC/loops/hotcues/buscador/copiloto', extras.length===0, extras.length? ('existen inesperados: '+extras.join(', ')) : 'confirmado: solo están en la imagen, sin función');

// 4) Cargar DOS canciones (Importar Archivos)
await page.setInputFiles('#fileIn', [A, B]);
await page.waitForTimeout(300);
const carga = await page.evaluate(() => {
  const a = document.getElementById('audioA'), b = document.getElementById('audioB');
  return { aSrc: !!a.src, bSrc: !!b.src, status: document.getElementById('status').textContent };
});
rec('Importar carga 2 canciones (A y B)', carga.aSrc && carga.bSrc, carga.aSrc&&carga.bSrc ? 'A y B con fuente cargada' : ('A='+carga.aSrc+' B='+carga.bSrc));

// esperar a que ambos audios tengan metadatos
await page.evaluate(() => Promise.all(['audioA','audioB'].map(id => new Promise(res => {
  const a = document.getElementById(id);
  if (a.readyState >= 1) return res();
  a.addEventListener('loadedmetadata', res, { once: true });
  setTimeout(res, 2000);
}))));

// 5) PLAY A y PLAY B -> las dos sonando a la vez = MEZCLA
await page.click('#playA'); await page.waitForTimeout(250);
await page.click('#playB'); await page.waitForTimeout(400);
const play = await page.evaluate(() => {
  const a = document.getElementById('audioA'), b = document.getElementById('audioB');
  return { aPlaying: !a.paused && a.currentTime>0, bPlaying: !b.paused && b.currentTime>0, aT:a.currentTime, bT:b.currentTime };
});
rec('Las DOS canciones suenan a la vez (mezcla)', play.aPlaying && play.bPlaying, `A avanza (t=${play.aT.toFixed(2)}s) y B avanza (t=${play.bT.toFixed(2)}s)`);

// 6) Crossfader mezcla A<->B (cambia volúmenes)
const xf = await page.evaluate(async () => {
  const x = document.getElementById('xfader'), a = document.getElementById('audioA'), b = document.getElementById('audioB');
  const set = (v)=>{ x.value=v; x.dispatchEvent(new Event('input',{bubbles:true})); };
  set(0.0); const izq = { a:a.volume, b:b.volume };   // todo A
  set(1.0); const der = { a:a.volume, b:b.volume };   // todo B
  set(0.5); const cen = { a:a.volume, b:b.volume };
  return { izq, der, cen };
});
const xfOk = xf.izq.a > 0.8 && xf.izq.b < 0.05 && xf.der.b > 0.8 && xf.der.a < 0.05;
rec('Crossfader mezcla A↔B', xfOk, `izq(A=${xf.izq.a.toFixed(2)},B=${xf.izq.b.toFixed(2)}) der(A=${xf.der.a.toFixed(2)},B=${xf.der.b.toFixed(2)})`);

// 7) Master escala el volumen de ambos
const mst = await page.evaluate(() => {
  const m = document.getElementById('master'), x = document.getElementById('xfader'), a = document.getElementById('audioA'), b = document.getElementById('audioB');
  x.value=0.5; x.dispatchEvent(new Event('input',{bubbles:true}));
  m.value=1.0; m.dispatchEvent(new Event('input',{bubbles:true})); const alto={a:a.volume,b:b.volume};
  m.value=0.3; m.dispatchEvent(new Event('input',{bubbles:true})); const bajo={a:a.volume,b:b.volume};
  return { alto, bajo };
});
rec('Master baja/sube el volumen de ambos', mst.bajo.a < mst.alto.a && mst.bajo.b < mst.alto.b, `alto(A=${mst.alto.a.toFixed(2)}) bajo(A=${mst.bajo.a.toFixed(2)})`);

// 8) CUE A y CUE B -> pausa y vuelve a 0
const cue = await page.evaluate(() => {
  const a = document.getElementById('audioA');
  document.getElementById('cueA').click();
  return { paused: a.paused, t: a.currentTime };
});
rec('CUE detiene y rebobina', cue.paused && cue.t===0, `A pausado=${cue.paused} t=${cue.t}`);

// 9) hotUser dispara logout (confirm)
let logoutPedido = false;
page.on('dialog', async d => { logoutPedido = true; await d.dismiss(); });
await page.click('#hotUser'); await page.waitForTimeout(200);
rec('Icono usuario pide cerrar sesión', logoutPedido, logoutPedido?'confirm de logout mostrado':'no reaccionó');

// 10) errores de consola/JS
rec('Sin errores JS en la página', errores.length===0, errores.length? errores.slice(0,3).join(' | ') : 'ninguno');

await page.screenshot({ path: path.join(DIR, 'console_prueba.png'), fullPage: false });
await browser.close();

const okN = out.filter(x=>x.ok).length;
console.log(`\nRESULTADO: ${okN}/${out.length} verificaciones OK`);
import fs from 'node:fs';
fs.writeFileSync(path.join(DIR,'resultado.json'), JSON.stringify(out,null,2));
