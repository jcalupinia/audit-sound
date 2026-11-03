// AUDIT SOUND · Command Center — lógica de la consola.
// Reutiliza el MISMO motor de audio del mezclador PRO (WASM + AudioWorklet) y
// conecta la interfaz verde del Command Center. Los módulos nuevos (Video/VJ,
// Presentaciones/Eventos, Generar contenido con IA, doble pantalla, Preview/
// Programa) quedan HABILITADOS en el front como marcadores de posición: la
// interfaz responde y avisa que el backend llega después.
import { AudioBridge } from './audio_bridge.js';
import { Copilot, camelot } from './copilot.js';
import { CTRL } from './ring.js';
import * as LIB from './library.js';
import { SubsonicClient, saveConfig, loadConfig, clearConfig } from './subsonic.js';
import * as OM from './openmusic.js';
import * as IA from './archive.js';
import * as CONV from './converter.js';
import * as CC from './commandcenter.js';

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = (s) => { s=Math.max(0,s|0); return `${(s/60)|0}:${String(s%60).padStart(2,'0')}`; };
const keyName = (k) => camelot(k);

/* ---- Puerta de acceso: ligada al Command Center ---- */
if (!CC.isAuthed()) { location.replace('./login.html'); }
(function setUser(){
  const s = CC.session();
  const av = $('#userAvatar');
  if (av && s.user) av.title = 'Sesión: ' + s.user + ' · clic para salir';
})();
$('#userAvatar')?.addEventListener('click', () => {
  if (confirm('¿Cerrar la sesión del Command Center?')) { CC.logout(); location.replace('./login.html'); }
});

/* ---- Estado del motor ---- */
const bridge = new AudioBridge();
const copilot = new Copilot();
const deckState = [
  {dur:0,pos:0,playing:false,bpm:0,key:-1,energy:0,name:'',beatOffset:0},
  {dur:0,pos:0,playing:false,bpm:0,key:-1,energy:0,name:'',beatOffset:0},
];
const waves = [null,null];
const hot = [[0,0,0,0],[0,0,0,0]];
const eqv = [{low:0,mid:0,high:0},{low:0,mid:0,high:0}];
const loopOn = [false,false];
const copFiles = new Map();
let mode = 'asistido', autoOn = false, libCount = 0, lastRecKey = '';
let libRows = [], started = false;

function toast(msg){
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ---- Arranque (gesto del usuario) ---- */
$('#startBtn').addEventListener('click', async () => {
  const b = $('#startBtn'); b.disabled = true; b.textContent = 'Iniciando…';
  try {
    bridge.onStatus = onStatus;
    bridge.onLoaded = onLoaded;
    bridge.onWaveform = (m) => { if (m.wave){ waves[m.deck]=m.wave; drawWave(m.deck); } };
    bridge.onAnalyzed = onAnalyzed;
    bridge.onError = (e) => console.warn('engine:', e);
    await bridge.start();
    bridge.master(parseFloat($('#master').value));
    started = true;
    $('#ov').classList.add('hide');
    buildMeters();
    requestAnimationFrame(tickUI);
    hydrateLibrary();
    setMode(mode);
  } catch (e) { b.disabled=false; b.textContent='Reintentar'; alert('No se pudo iniciar: '+(e.message||e)); }
});

/* ---- Navegación superior (Consola + páginas) ---- */
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const v = b.dataset.view;
  $$('#nav button').forEach(x => x.classList.toggle('on', x===b));
  $('#viewConsola').classList.toggle('off', v!=='Consola');
  ['Biblioteca','Playlists','Eventos','Generador','Config'].forEach(p =>
    $('#view'+p).classList.toggle('on', 'view'+p === 'view'+v));
});

/* ---- Tipo de contenido (Música / Video / Eventos) ---- */
$('#contentSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#contentSeg button').forEach(x => x.classList.toggle('on', x===b));
  const c = b.dataset.c;
  if (c === 'video') toast('Módulo Video/VJ — interfaz lista, backend de video próximamente.');
  else if (c === 'eventos') toast('Módulo Presentaciones/Eventos — interfaz lista, backend próximamente.');
});

/* ---- Vista de consola (Sencillo / Profesional) ---- */
$('#viewSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#viewSeg button').forEach(x => x.classList.toggle('on', x===b));
  document.body.classList.toggle('simple', b.dataset.v === 'sencillo');
});

/* ---- Modo de operación (Manual / Híbrido / Automático) ---- */
$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  setMode(b.dataset.m);
});
function setMode(m){
  mode = m;
  $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.m === m));
  const lbl = m==='manual'?'Modo Manual':m==='auto'?'Modo Automático':'Modo Híbrido';
  $('#copModeLbl').textContent = lbl;
  if (m !== 'auto' && autoOn){ bridge.autoEnable(false); autoOn=false; }
  if (m === 'asistido') refreshSuggestions(true);
}

/* ---- Carga por deck (archivo local) ---- */
$$('.loadin').forEach(inp => inp.addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f || !started) { if(!started) toast('Pulsa «Iniciar consola» primero.'); return; }
  const d = +inp.dataset.deck;
  $('#title'+(d?'B':'A')).textContent = 'cargando…';
  await bridge.load(d, f, f.name);
}));
function onLoaded(m){
  const L = m.deck ? 'B':'A';
  $('#title'+L).textContent = m.ok ? m.name : ('error: '+(m.err||'no se pudo cargar'));
  $('#sub'+L).textContent = m.ok ? 'reproduciendo desde el motor WASM' : '';
  if (!m.ok) return;
  $('#bpm'+L).textContent = (m.bpm||0).toFixed(0);
  $('#key'+L).textContent = keyName(m.key);
  const ds=deckState[m.deck]; ds.dur=m.dur||0; ds.bpm=m.bpm||0; ds.key=(m.key??-1)|0; ds.energy=m.energy||0; ds.name=m.name; ds.beatOffset=m.beatOffset||0;
  if (m.wave){ waves[m.deck]=m.wave; }
  hot[m.deck]=[0,0,0,0]; refreshPads(m.deck);
  drawWave(m.deck);
  if (mode === 'asistido') refreshSuggestions(true);
}

/* ---- Transporte / toggles ---- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const d = +el.dataset.deck;
  const act = el.dataset.act;
  if (act === 'play'){ bridge.play(d, !deckState[d].playing); }
  else if (act === 'cue'){ bridge.cue(d); }
  else if (act === 'keylock'){ el.classList.toggle('on'); bridge.keylock(d, el.classList.contains('on')); }
  else if (act === 'sync'){ doSync(d); }
  else if (act === 'bj'){ bridge.beatjump(d, +el.dataset.beats); }
});
function doSync(d){
  const btn = $('.ibtn.sync[data-deck="'+d+'"]'); if (btn) btn.classList.toggle('on');
  const o = 1-d; const bpmO = deckState[o].bpm||0, bpmD = deckState[d].bpm||0;
  if (bpmO>0 && bpmD>0){ const r = bpmO/bpmD; if (r>=0.9 && r<=1.1){ bridge.keylock(d,true); bridge.rate(d,r);
    const pitchEl=$('.pitchin[data-deck="'+d+'"]'); if(pitchEl) pitchEl.value=((r-1)*100).toFixed(1);
    $('#pitch'+(d?'B':'A')).textContent=((r-1)*100).toFixed(1)+'%'; } }
}

/* ---- Hotcues ---- */
$$('.pad').forEach(p => p.addEventListener('click', (e) => {
  const grid = p.closest('.pads'); const d = +grid.dataset.deck; const i = +p.dataset.cue;
  if (e.shiftKey){ hot[d][i]=0; bridge.hotcueClear(d,i); refreshPads(d); return; }
  if (hot[d][i]>0){ bridge.hotcueJump(d,i); }
  else { const pos=deckState[d].pos||0; hot[d][i]=pos||0.0001; bridge.hotcueSet(d,i,pos); refreshPads(d); }
}));
function refreshPads(d){
  const grid = $('.pads[data-deck="'+d+'"]'); if (!grid) return;
  $$('.pad', grid).forEach((p,i) => p.classList.toggle('set', hot[d][i]>0));
}

/* ---- Loops (selector de beats + IN/OUT/toggle) ---- */
function loopBeats(d){ const s=$('.loopsel[data-deck="'+d+'"]'); return parseInt(s&&s.value,10)||4; }
function setLoop(d, on){ loopOn[d]=on; bridge.loop(d, on, loopBeats(d)); $('.loopb-tog[data-deck="'+d+'"]').classList.toggle('on', on); }
$$('.loopb-tog').forEach(b => b.addEventListener('click', ()=> setLoop(+b.dataset.deck, !loopOn[+b.dataset.deck])));
$$('.loopb').forEach(b => b.addEventListener('click', ()=> setLoop(+b.dataset.deck, true)));
$$('.loopb-out').forEach(b => b.addEventListener('click', ()=> setLoop(+b.dataset.deck, false)));

/* ---- Pitch / faders / crossfader / master ---- */
$$('.pitchin').forEach(inp => inp.addEventListener('input', () => {
  const d=+inp.dataset.deck; const pct=parseFloat(inp.value); bridge.rate(d, 1+pct/100);
  $('#pitch'+(d?'B':'A')).textContent = pct.toFixed(1)+'%';
}));
$$('.chfader').forEach(inp => inp.addEventListener('input', () => bridge.fader(+inp.dataset.deck, parseFloat(inp.value))));
$('#xfader').addEventListener('input', (e) => bridge.xfader(parseFloat(e.target.value)));
$('#master').addEventListener('input', (e) => { if(started) bridge.master(parseFloat(e.target.value)); });

/* ---- Knobs EQ (HI/MID/LOW) ---- */
$$('.knob').forEach(k => setupKnob(k));
function setupKnob(k){
  const min=+k.dataset.min, max=+k.dataset.max; let val=+k.dataset.val;
  const render=()=>{ const t=(val-min)/(max-min); k.style.setProperty('--rot',(-135+t*270)+'deg'); };
  const apply=()=>{ const d=+k.dataset.deck, kind=k.dataset.k; eqv[d][kind]=val; if(started) bridge.eq(d, eqv[d].low, eqv[d].mid, eqv[d].high); };
  render();
  let drag=false, y0=0, v0=0;
  k.addEventListener('pointerdown',(e)=>{drag=true;y0=e.clientY;v0=val;k.setPointerCapture(e.pointerId);});
  k.addEventListener('pointermove',(e)=>{ if(!drag)return; const dv=(y0-e.clientY)/120*(max-min); val=Math.min(max,Math.max(min,v0+dv)); render(); apply(); });
  k.addEventListener('pointerup',()=>{drag=false;});
  k.addEventListener('dblclick',()=>{ val=0; render(); apply(); });
}

/* ---- Copiloto IA ---- */
function onAnalyzed(m){
  copilot.addTrack({ name:m.name, bpm:m.bpm, key:m.key, energy:m.energy });
  if (mode==='asistido') refreshSuggestions(true);
}
$('#copTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#copTabs button').forEach(x => x.classList.toggle('on', x===b));
  if (b.dataset.t !== 'sug') toast(b.dataset.t==='trans' ? 'Transiciones asistidas — interfaz lista, afinado con el backend.' : 'Contenido IA — generación de video/imagen/presentación próximamente.');
});
$$('.genbtn').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.gen;
  toast('Generar '+(g==='video'?'video':g==='imagen'?'imagen':'presentación')+' con IA — interfaz lista, motor de IA próximamente.');
}));
$('#nextGo').addEventListener('click', () => { if (nextRec && nextCur) prepare(nextRec, 1-nextCur.deck, nextCur); });

let nextRec=null, nextCur=null;
function playingDeck(){ return deckState[0].playing ? 0 : (deckState[1].playing ? 1 : -1); }
function current(){ const d=playingDeck(); if (d<0) return null; const s=deckState[d];
  return s.name ? {name:s.name,bpm:s.bpm,key:s.key,energy:s.energy,deck:d} : null; }
function refreshSuggestions(force){
  const cur = current();
  const sig = cur ? (cur.name+'|'+cur.bpm.toFixed(1)) : 'none';
  if (!force && sig===lastRecKey) return; lastRecKey=sig;
  const checks = $('#copChecks'); checks.innerHTML='';
  if (!cur){
    $('#nextNm').textContent = '—';
    $('#nextMt').textContent = copilot.size()? 'reproduce una pista para recibir sugerencias' : 'carga tu biblioteca y reproduce una pista';
    nextRec=null; nextCur=null; return;
  }
  nextCur = cur;
  const recs = copilot.recommend(cur, 5);
  if (!recs.length){
    $('#nextNm').textContent='—'; $('#nextMt').textContent='añade pistas a la biblioteca para recibir recomendaciones'; nextRec=null;
    return;
  }
  nextRec = recs[0];
  $('#nextNm').textContent = nextRec.track.name;
  $('#nextMt').innerHTML = `${camelot(nextRec.track.key)} · ${nextRec.track.bpm.toFixed(0)} BPM · ${(nextRec.score*100|0)}% · ${copilot.suggestTransition(cur,nextRec)}`;
  recs.slice(0,4).forEach(r => {
    const row=document.createElement('div'); row.className='chk';
    row.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`+
      `<span><b style="color:var(--text)">${r.track.name}</b> · ${camelot(r.track.key)} · ${r.track.bpm.toFixed(0)} BPM</span>`;
    checks.appendChild(row);
  });
}
async function prepare(rec, deck, cur){
  const src = copFiles.get(rec.track.name); if (!src){ toast('Esa pista no está en la biblioteca de esta sesión.'); return; }
  let bytes = src;
  if (!(src instanceof File) && src && src.lib){ bytes = await LIB.getBytes(src.lib); if (!bytes) return; }
  $('#title'+(deck?'B':'A')).textContent = 'preparando…';
  await bridge.load(deck, bytes, rec.track.name);
  copilot.accept(cur, rec);
  toast('Preparada en deck '+(deck?'B':'A')+': '+rec.track.name);
}

/* ---- Preview / Programa (video — backend después) ---- */
$('#sendLive').addEventListener('click', ()=> toast('«Enviar a vivo» (Preview→Programa) — interfaz lista, backend de video próximamente.'));
$('#transSel').addEventListener('change', ()=> toast('Transición de video — se aplicará con el backend de video.'));

/* ---- Barra inferior ---- */
$('#micSw').addEventListener('click', (e)=>{ e.currentTarget.classList.toggle('on'); toast('Micrófono — interfaz lista, entrada de micro próximamente.'); });
$('#talkSw').addEventListener('click', (e)=>{ e.currentTarget.classList.toggle('on'); toast('Talkover — interfaz lista, atenuación automática próximamente.'); });
$('#fsBtn').addEventListener('click', ()=>{
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{});
  else document.exitFullscreen?.();
});

/* ---- Estado del motor (viene del Worker ~5/s) ---- */
function onStatus(m){
  m.decks.forEach(dk => {
    deckState[dk.deck].pos = dk.pos; deckState[dk.deck].dur = dk.dur; deckState[dk.deck].playing = !!dk.playing;
    const L = dk.deck?'B':'A';
    const pb = $('.play[data-deck="'+dk.deck+'"]'); if (pb) pb.textContent = dk.playing?'❚❚':'▶';
    const jog = $('#jog'+L); if (jog) jog.classList.toggle('spin', !!dk.playing);
  });
  const pd = playingDeck();
  if (pd>=0){
    const s=deckState[pd];
    $('#nowPlaying').textContent = s.name || 'reproduciendo';
    $('#stBpm').textContent = (s.bpm||0).toFixed(0);
    $('#stKey').textContent = keyName(s.key);
    $('#stTime').textContent = fmt(s.pos)+' / '+fmt(s.dur);
    $('#progTime').textContent = fmt(s.pos)+' / '+fmt(s.dur);
  } else {
    $('#nowPlaying').textContent = 'en espera';
  }
  if (mode==='auto'){ m.decks.forEach(dk => { if (dk.loaded && !waves[dk.deck]) bridge.requestWaveform(dk.deck); }); }
  if (mode==='asistido') refreshSuggestions(false);
}

/* ---- Formas de onda ---- */
function drawWave(d){
  const cv = d?$('#waveB'):$('#waveA'); if (!cv) return; const ctx=cv.getContext('2d');
  const w=cv.width=cv.clientWidth*devicePixelRatio, h=cv.height=cv.clientHeight*devicePixelRatio;
  ctx.clearRect(0,0,w,h);
  const col = d? '#39b7ff':'#39e66b';
  const wv = waves[d]; if (!wv) return;
  const n=wv.bins, mid=h/2; const st=deckState[d];
  if (st.bpm>0 && st.dur>0){
    const beat=60/st.bpm, off=((st.beatOffset%beat)+beat)%beat;
    for (let t=off, k=0; t<st.dur; t+=beat, k++){
      const x=(t/st.dur)*w, downbeat=(k%4===0);
      ctx.strokeStyle = downbeat ? 'rgba(199,168,60,.45)' : 'rgba(255,255,255,.08)';
      ctx.lineWidth = downbeat ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    }
  }
  ctx.strokeStyle=col; ctx.globalAlpha=.92; ctx.lineWidth=1; ctx.beginPath();
  for (let i=0;i<n;i++){ const x=i/n*w; ctx.moveTo(x, mid - wv.max[i]*mid*0.95); ctx.lineTo(x, mid - wv.min[i]*mid*0.95); }
  ctx.stroke(); ctx.globalAlpha=1;
}
function drawPlayhead(d){
  const cv = d?$('#waveB'):$('#waveA'); if (!cv) return; const ctx=cv.getContext('2d');
  const st=deckState[d]; if (!waves[d]||!st.dur) return;
  const x = (st.pos/st.dur)*cv.width;
  ctx.strokeStyle='#C7A83C'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,cv.height); ctx.stroke();
}

/* ---- Medidores (VU por canal + Cue/Master abajo) ---- */
function buildMeters(){
  const mk = (host,n)=>{ if(!host) return; host.innerHTML=''; for(let i=0;i<n;i++){ host.appendChild(document.createElement('i')); } };
  mk($('#cueMeter'),10); mk($('#masterMeter'),10);
}
let vuCtrl=null; try { vuCtrl = new Int32Array(bridge._buffers.ctrl); } catch(e){}
let vuLevel = 0;
function litBars(host, level){
  if (!host) return; const bars=$$('i',host); const on=Math.round(level*bars.length);
  bars.forEach((b,i)=>{ b.className = i<on ? (i>=bars.length-2?'hot':'on') : ''; });
}
function tickUI(){
  for (let d=0; d<2; d++){ if (waves[d]){ drawWave(d); drawPlayhead(d); } }
  let peak = 0; try { if(vuCtrl){ peak=(Atomics.load(vuCtrl, CTRL.PEAK)||0)/1e6; Atomics.store(vuCtrl, CTRL.PEAK, 0); } } catch(e){}
  vuLevel = Math.max(peak, vuLevel*0.86);
  const lv = Math.min(1, vuLevel);
  // VU por canal: aproximado según el deck que suena y su fader.
  const fA = parseFloat($('.chfader[data-deck="0"]').value)||0, fB = parseFloat($('.chfader[data-deck="1"]').value)||0;
  const la = deckState[0].playing ? lv*fA : la0*0.9; const lb = deckState[1].playing ? lv*fB : lb0*0.9;
  vuBar('#vuA0', la); vuBar('#vuA1', la*0.92); vuBar('#vuB0', lb); vuBar('#vuB1', lb*0.92);
  la0=la; lb0=lb;
  litBars($('#masterMeter'), lv);
  litBars($('#cueMeter'), lv*0.7);
  requestAnimationFrame(tickUI);
}
let la0=0, lb0=0;
function vuBar(sel, level){ const el=$(sel); if (el) el.style.height = Math.min(100, level*100).toFixed(0)+'%'; }
window.addEventListener('resize', ()=>{ drawWave(0); drawWave(1); });

/* ---- Biblioteca persistente (IndexedDB) ---- */
async function hydrateLibrary(){
  if (!LIB.available()){ renderMedia(); return; }
  try { libRows = await LIB.listTracks(); } catch(e){ renderMedia(); return; }
  for (const t of libRows){
    copilot.addTrack({ name:t.name, bpm:t.bpm, key:t.key, energy:t.energy });
    copFiles.set(t.name, { lib:t.id });
  }
  renderMedia();
  if (mode==='asistido') refreshSuggestions(true);
}
function convertOnSave(){ return $('#ocOpus').checked && CONV.available(); }
async function addToLibrary(name, bytes, size, type){
  if (convertOnSave() && !/\.opus$/i.test(name)){
    try { const r = await CONV.toOpus(bytes, name, { bitrate:160000 }); bytes=r.bytes; name=r.name; type='audio/ogg'; size=bytes.byteLength; }
    catch(e){ toast('No se pudo convertir a Opus; se guarda el original.'); }
  }
  const a = await bridge.analyzeAwait(bytes.slice(0), name);
  const meta = await LIB.putTrack({ name, bpm:a.bpm, key:a.key, energy:a.energy, size:size||bytes.byteLength, type:type||'', bytes });
  libRows = libRows.filter(r => r.id !== meta.id).concat(meta);
  copilot.addTrack({ name:meta.name, bpm:meta.bpm, key:meta.key, energy:meta.energy });
  copFiles.set(meta.name, { lib:meta.id });
  return meta;
}

/* ---- Biblioteca multimedia (rejilla) ---- */
let activeCat = 'todo';
$$('.libcats .cat[data-cat]').forEach(c => c.addEventListener('click', () => {
  activeCat = c.dataset.cat;
  $$('.libcats .cat').forEach(x => x.classList.toggle('on', x===c));
  renderMedia();
}));
function tileAudio(t){
  const el = document.createElement('div'); el.className='mtile';
  el.innerHTML = `<div class="th"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></div>`+
    `<div class="cap"><div class="t" title="${t.name}">${t.name}</div><div class="s">${(t.bpm||0).toFixed(0)} BPM · ${camelot(t.key)}</div></div>`;
  el.addEventListener('click', ()=> loadFromLib(t, playingDeck()===0?1:0));
  el.title = 'Clic: cargar en el deck libre';
  return el;
}
function renderMedia(){
  const grid = $('#mediaGrid'); if (!grid) return; grid.innerHTML='';
  if (activeCat==='todo' || activeCat==='musica'){
    libRows.forEach(t => grid.appendChild(tileAudio(t)));
    const add = document.createElement('div'); add.className='mtile add';
    add.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Importar música</span>`;
    add.addEventListener('click', ()=> $('#importIn').click());
    grid.appendChild(add);
    if (!libRows.length){
      const e=document.createElement('div'); e.style.cssText='grid-column:1/-1;color:var(--muted);padding:20px;text-align:center';
      e.textContent='Tu biblioteca está vacía. Importa música o búscala en Navidrome / Libre / Archive.';
      grid.insertBefore(e, add);
    }
  } else {
    const names = {videos:'Videos',imagenes:'Imágenes',present:'Presentaciones',ia:'Generados por IA',fav:'Favoritos'};
    const e=document.createElement('div'); e.style.cssText='grid-column:1/-1;color:var(--muted);padding:30px;text-align:center';
    e.innerHTML = `<b style="color:var(--text)">${names[activeCat]||''}</b><br>Interfaz lista · el backend de este módulo llega después.`;
    grid.appendChild(e);
  }
}
async function loadFromLib(t, deck){
  if (!started){ toast('Pulsa «Iniciar consola» primero.'); return; }
  const bytes = await LIB.getBytes(t.id); if (!bytes){ toast('No se encontró la pista.'); return; }
  $('#title'+(deck?'B':'A')).textContent='cargando…';
  await bridge.load(deck, bytes, t.name);
  toast('Cargada en deck '+(deck?'B':'A')+': '+t.name);
}
$('#importIn').addEventListener('change', async (e)=>{
  if (!LIB.available()){ toast('Este navegador no permite guardar la biblioteca.'); return; }
  const files = Array.from(e.target.files); e.target.value='';
  for (const f of files){
    toast('analizando «'+f.name+'»…');
    try { await addToLibrary(f.name, await f.arrayBuffer(), f.size, f.type); } catch(err){ toast('No se pudo añadir «'+f.name+'».'); }
  }
  renderMedia(); if (mode==='asistido') refreshSuggestions(true); toast('Biblioteca actualizada.');
});

/* ---- Fuentes de música: Navidrome / Libre / Archive ---- */
let source = null, results = [];
function srcStatus(text, cls){ const el=$('#srcStatus'); el.textContent=text||''; el.style.color = cls==='err'?'#ff7a7a':cls==='ok'?'var(--green)':'var(--muted)'; }
let nd = new SubsonicClient();
function selectSource(s){
  source = s; results = [];
  $$('#srcNav,#srcLibre,#srcArchive').forEach(b=>b.classList.remove('on'));
  ({nav:'#srcNav',libre:'#srcLibre',archive:'#srcArchive'})[s] && $(({nav:'#srcNav',libre:'#srcLibre',archive:'#srcArchive'})[s]).classList.add('on');
  $('#srcRow').style.display='flex';
  if (s==='nav'){
    const c=loadConfig();
    if (c){ nd=new SubsonicClient(c); srcStatus('Navidrome: usando la conexión guardada. Busca por artista/género.'); }
    else srcStatus('Navidrome no está configurado. Configúralo en el mezclador PRO o en Configuración.', 'err');
  } else if (s==='libre'){ srcStatus(OM.enabled()? 'Música libre (Jamendo). Busca por artista/estilo.' : 'Música libre desactivada (falta JAMENDO_CLIENT_ID en el servidor).', OM.enabled()?'':'err'); }
  else { srcStatus(IA.enabled()? 'Internet Archive. Busca por artista/colección.' : 'Internet Archive desactivado en el servidor.', IA.enabled()?'':'err'); }
}
$('#srcNav').addEventListener('click', ()=>selectSource('nav'));
$('#srcLibre').addEventListener('click', ()=>selectSource('libre'));
$('#srcArchive').addEventListener('click', ()=>selectSource('archive'));

function renderResults(){
  const grid=$('#mediaGrid'); grid.innerHTML='';
  if (!results.length){ const e=document.createElement('div'); e.style.cssText='grid-column:1/-1;color:var(--muted);padding:20px;text-align:center'; e.textContent='Sin resultados.'; grid.appendChild(e); return; }
  results.forEach(song => {
    const name = source==='nav'?SubsonicClient.filename(song):source==='libre'?OM.filename(song):IA.filename(song);
    const el=document.createElement('div'); el.className='mtile';
    const tag = source==='nav'?(song.suffix||'☁'):source==='libre'?'CC':'IA';
    el.innerHTML = `<div class="th"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></div>`+
      `<div class="cap"><div class="t" title="${name}">${song.title||name}</div><div class="s">${song.artist?song.artist+' · ':''}${tag}</div></div>`;
    el.addEventListener('click', ()=> loadSong(song));
    grid.appendChild(el);
  });
}
async function fetchBytes(song){
  if (source==='nav') return nd.getBytes(song.id);
  if (source==='libre') return OM.getBytes(song.audio);
  return IA.getBytes(song.id);
}
function nameOf(song){ return source==='nav'?SubsonicClient.filename(song):source==='libre'?OM.filename(song):IA.filename(song); }
async function loadSong(song){
  if (!started){ toast('Pulsa «Iniciar consola» primero.'); return; }
  const deck = playingDeck()===0?1:0;
  try { srcStatus('cargando…'); const bytes=await fetchBytes(song); $('#title'+(deck?'B':'A')).textContent='cargando…'; await bridge.load(deck, bytes, nameOf(song)); srcStatus('cargada en deck '+(deck?'B':'A'),'ok'); }
  catch(e){ srcStatus('no se pudo cargar: '+(e.message||e),'err'); }
}
$('#btnSearch').addEventListener('click', doSearch);
$('#libQuery').addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ if(!source) selectSource('libre'); doSearch(); } });
async function doSearch(){
  if (!source){ selectSource('libre'); }
  const q = $('#libQuery').value.trim();
  srcStatus('buscando…');
  try {
    if (source==='nav'){ if(!nd.configured){ srcStatus('Navidrome no configurado.','err'); return; } results = await nd.search(q, 30); }
    else if (source==='libre'){ if(!OM.enabled()){ srcStatus('Música libre desactivada.','err'); return; } results = await OM.search(q, 30); }
    else { if(!IA.enabled()){ srcStatus('Internet Archive desactivado.','err'); return; } results = await IA.search(q, 30); }
    srcStatus(results.length+' resultado(s)', results.length?'ok':''); renderResults();
  } catch(e){ srcStatus('error: '+(e.message||e),'err'); }
}

/* ---- Armar set y mezclar (motor común) ---- */
async function runSet(songs, setStatus){
  if (!songs.length){ setStatus('sin resultados','err'); return; }
  setMode('auto'); let added=0;
  for (const s of songs){
    setStatus('añadiendo '+(added+1)+'/'+songs.length+'…');
    try { const bytes = await fetchBytes(s); await bridge.autoAdd(bytes, nameOf(s)); added++; libCount++; } catch(e){}
    if (added===2 && !autoOn){ autoOn=true; bridge.autoEnable(true); }
  }
  if (added>0 && !autoOn){ autoOn=true; bridge.autoEnable(true); }
  setStatus(added? ('set en marcha: '+added+' pistas en AUTO') : 'no se pudo cargar ninguna pista', added?'ok':'err');
}
$('#btnSet').addEventListener('click', async ()=>{
  if (!started){ toast('Pulsa «Iniciar consola» primero.'); return; }
  if (!source){ selectSource('libre'); }
  const n = Math.min(30, Math.max(2, parseInt($('#setCount').value,10)||10));
  const q = $('#libQuery').value.trim();
  srcStatus('armando set…');
  try {
    let songs=[];
    if (source==='nav'){ if(!nd.configured){ srcStatus('Navidrome no configurado.','err'); return; }
      const byText=await nd.search(q,n); let byGenre=[]; if(q){ try{ byGenre=await nd.songsByGenre(q,n);}catch(e){} }
      const seen=new Set(); songs=[...byText,...byGenre].filter(s=>{ if(!s.id||seen.has(s.id))return false; seen.add(s.id); return true; }).slice(0,n); }
    else if (source==='libre'){ if(!OM.enabled()){ srcStatus('Música libre desactivada.','err'); return; } songs = await OM.search(q,n); }
    else { if(!IA.enabled()){ srcStatus('Internet Archive desactivado.','err'); return; } songs = await IA.search(q,n); }
    await runSet(songs, srcStatus);
  } catch(e){ srcStatus('error: '+(e.message||e),'err'); }
}
);

if (!CONV.available()){ $('#ocOpus').checked=false; $('#ocOpus').disabled=true; }

renderMedia();

/* ---- Para pruebas automatizadas (Playwright) ---- */
window.__auditSound = { bridge, copilot, deckState, waves, getMode:()=>mode, autoOn:()=>autoOn,
  refreshSuggestions, lib:LIB, libRows:()=>libRows, selectSource, doSearch, runSetBtn:()=>$('#btnSet').click(),
  results:()=>results, subsonic:{ SubsonicClient, client:()=>nd }, openmusic:OM, archive:IA, converter:CONV, cc:CC };
