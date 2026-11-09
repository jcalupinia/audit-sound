// ===== 07f · Forma de onda REAL en los decks de audio =====
// Antes, cada deck mostraba un dibujo decorativo fijo (wave(): barras con senos) que no cambiaba con la
// canción ni mostraba por dónde iba. Ahora es la forma de onda de la pista cargada: se decodifica una vez
// (Web Audio), se dibuja rellena y normalizada al pico, con lo ya reproducido atenuado, el cabezal dorado
// y los hot cues. Un clic sobre la onda mueve la reproducción a ese punto.
// Funciona igual con el reproductor del navegador y con el motor profesional (WASM): la posición sale de
// LIVE.pos / LIVE.dur o del <audio> del deck.
const WV={peaks:new Map(),busy:new Set(),err:new Map(),ctx:null,BINS:1200};
const WV_COLORS={A:['#6cfe65','#bbd45d'],B:['#4bd5f8','#7f88ff']};

function wvTrackId(side){return state.deck[side]&&state.deck[side].track||''}
function wvPos(side){if(LIVE.on)return {pos:LIVE.pos[side]||0,dur:LIVE.dur[side]||0};
  const el=audioEls[side];return {pos:el&&el.currentTime||0,dur:el&&isFinite(el.duration)?el.duration:0}}

async function wvBytes(id){
  const f=mediaFiles.get(id);if(f)return await f.arrayBuffer();
  const lib=LIBX();if(lib){try{const b=await lib.getBytes(id);if(b)return b.buffer?b.buffer.slice(b.byteOffset||0,(b.byteOffset||0)+b.byteLength):b}catch(e){}}
  const u=mediaUrls.get(id);if(u){const r=await fetch(u);if(r.ok)return await r.arrayBuffer()}
  return null}

// Mínimo y máximo de cada tramo (mono): WV.BINS valores por pista, se calcula una sola vez.
async function wvAnalyze(id){
  if(!id||WV.peaks.has(id)||WV.busy.has(id)||WV.err.has(id))return;
  const t=trackFor(id);if(!t||t.demo||t.kind!=='audio')return;
  WV.busy.add(id);
  try{
    const bytes=await wvBytes(id);if(!bytes)throw Error('sin audio');
    const AC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    WV.ctx=WV.ctx||new AC(1,1,44100);
    const buf=await WV.ctx.decodeAudioData(bytes.slice?bytes.slice(0):bytes);
    const chs=[];for(let c=0;c<buf.numberOfChannels;c++)chs.push(buf.getChannelData(c));
    const n=buf.length,bins=WV.BINS,min=new Float32Array(bins),max=new Float32Array(bins);
    const step=Math.max(1,Math.floor(n/bins/64));            // submuestreo: rápido aun con canciones largas
    for(let b=0;b<bins;b++){let lo=0,hi=0;const s0=Math.floor(b*n/bins),s1=Math.floor((b+1)*n/bins);
      for(let i=s0;i<s1;i+=step){let v=0;for(const ch of chs)v+=ch[i];v/=chs.length;if(v<lo)lo=v;if(v>hi)hi=v}
      min[b]=lo;max[b]=hi}
    let peak=1e-4;for(let b=0;b<bins;b++)peak=Math.max(peak,max[b],-min[b]);
    WV.peaks.set(id,{min,max,peak,dur:buf.duration});
  }catch(e){WV.err.set(id,String(e&&e.message||e))}
  finally{WV.busy.delete(id)}
}

function wvDraw(cv){
  const side=cv.dataset.waveDeck,id=wvTrackId(side),dpr=window.devicePixelRatio||1;
  const w=Math.max(1,Math.round(cv.clientWidth*dpr)),h=Math.max(1,Math.round(cv.clientHeight*dpr));
  if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h}
  const g=cv.getContext('2d');g.clearRect(0,0,w,h);
  const mid=h/2,[c1,c2]=WV_COLORS[side]||WV_COLORS.A;
  g.fillStyle='#93acb8';g.font=`${10*dpr}px system-ui,sans-serif`;g.textBaseline='middle';
  const t=id&&trackFor(id);
  if(!t){g.fillText('Sin pista cargada',8*dpr,mid);return}
  if(t.demo){g.fillText('Pista demo sin audio: no hay forma de onda',8*dpr,mid);return}
  const pk=WV.peaks.get(id);
  if(!pk){wvAnalyze(id);g.fillText(WV.err.has(id)?'No se pudo leer el audio de esta pista':'Analizando la forma de onda…',8*dpr,mid);return}
  const {pos,dur:d0}=wvPos(side),dur=d0||pk.dur,sc=(mid*0.92)/pk.peak,bins=pk.min.length;
  // Envolvente rellena (un punto por píxel) con degradado del color del deck.
  const grad=g.createLinearGradient(0,0,0,h);grad.addColorStop(0,c2);grad.addColorStop(0.5,c1);grad.addColorStop(1,c2);
  g.beginPath();
  for(let x=0;x<w;x++){const b=Math.min(bins-1,Math.floor(x/w*bins));g.lineTo(x,mid-pk.max[b]*sc)}
  for(let x=w-1;x>=0;x--){const b=Math.min(bins-1,Math.floor(x/w*bins));g.lineTo(x,mid-pk.min[b]*sc)}
  g.closePath();g.fillStyle=grad;g.globalAlpha=.85;g.fill();g.globalAlpha=1;
  g.strokeStyle='rgba(255,255,255,.10)';g.lineWidth=1;g.beginPath();g.moveTo(0,mid);g.lineTo(w,mid);g.stroke();
  if(dur>0){
    const px=Math.max(0,Math.min(w,pos/dur*w));
    g.fillStyle='rgba(4,10,16,.55)';g.fillRect(0,0,px,h);                         // lo ya reproducido
    const cues=state.deck[side].cues||{};g.fillStyle='#ff9f43';
    for(const k of Object.keys(cues)){const v=cues[k];if(typeof v==='number'&&v>=0){const cx=v/dur*w;g.fillRect(cx-dpr,0,2*dpr,h*.28)}}
    g.strokeStyle='#f8c45e';g.lineWidth=2*dpr;g.beginPath();g.moveTo(px,0);g.lineTo(px,h);g.stroke();
    cv.dataset.playhead=String(Math.round(px/dpr));
  }
}

// Contador «transcurrido / duración · BPM» del deck, al día en cada cuadro (antes solo cambiaba cuando la
// pantalla se redibujaba, así que mientras sonaba la canción se quedaba en 00:00).
function wvTime(el){const side=el.dataset.deckTime,{pos,dur}=wvPos(side),pk=WV.peaks.get(wvTrackId(side));
  const t=`${fmt(pos)} / ${fmt(dur||(pk&&pk.dur)||NaN)} · ${state.deck[side].bpm} BPM`;if(el.textContent!==t)el.textContent=t}
function wvFrame(){for(const cv of document.querySelectorAll('canvas[data-wave-deck]'))if(cv.isConnected&&cv.clientWidth)wvDraw(cv);
  for(const el of document.querySelectorAll('[data-deck-time]'))wvTime(el);requestAnimationFrame(wvFrame)}
requestAnimationFrame(wvFrame);

// Clic sobre la onda: lleva la reproducción a ese punto.
document.addEventListener('click',e=>{const cv=e.target.closest&&e.target.closest('canvas[data-wave-deck]');if(!cv)return;
  const side=cv.dataset.waveDeck,id=wvTrackId(side),pk=WV.peaks.get(id);if(!pk)return;
  const r=cv.getBoundingClientRect(),f=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
  const {dur:d0}=wvPos(side),s=f*(d0||pk.dur);
  if(LIVE.on&&LIVE.bridge&&LIVE.bridge.seek)LIVE.bridge.seek(DECK_IDX[side],s);else if(audioEls[side])audioEls[side].currentTime=s;
  command('transport.seek',{deck:side,position:Math.round(s*10)/10},'LOCAL')});

// El deck dibuja un lienzo en lugar del dibujo decorativo.
const wvDeckCardBase=deckCard;
deckCard=function(side){const html=wvDeckCardBase(side),deco=wave(side==='B'?'b':'');
  return html.replace('<div class="right"><div class="micro">','<div class="right"><div class="micro" data-deck-name="'+side+'">')
    .replace(/(<div class="micro" data-deck-name="[AB]">[\s\S]*?<\/div>)<small>/,`$1<small data-deck-time="${side}">`)
    .replace(deco,`<canvas class="wave-real" data-wave-deck="${side}" title="Forma de onda: haz clic para ir a ese punto" aria-label="Forma de onda del deck ${side}"></canvas>`)};

window.__ASWAVE={live:()=>LIVE.on,peaks:(side)=>{const p=WV.peaks.get(wvTrackId(side));return p?p.min.length:0},
  busy:(side)=>WV.busy.has(wvTrackId(side)),playhead:(side)=>{const cv=document.querySelector(`canvas[data-wave-deck="${side}"]`);return cv?Number(cv.dataset.playhead||-1):-1},
  error:(side)=>WV.err.get(wvTrackId(side))||'',time:(side)=>{const el=document.querySelector(`[data-deck-time="${side}"]`);return el?el.textContent:''}};
