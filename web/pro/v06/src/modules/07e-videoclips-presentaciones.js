// ===== 07e · V1b videoclips con sonido · V3 fotos, presentaciones y cues de eventos =====
// - Fotos: un deck de video puede mostrar una imagen (se mezcla igual que un video).
// - Presentaciones: un PDF (convertido en el navegador con pdf.js, sin internet) o varias fotos forman
//   una presentación; el deck muestra una diapositiva, con ◀ ▶ y avance automático.
// - Videoclips (DJ de video): el mismo archivo va al deck de audio (sonido) y al deck de video
//   (imagen) del mismo lado. La imagen sigue al audio: play/pausa, posición, saltos y velocidad (pitch);
//   con «crossfader compartido» el crossfader de audio mueve también la mezcla de video.
// - Cues de eventos: cada cue elige un video, foto o presentación; «Ejecutar» lo carga en el deck que
//   no está al aire y lo pasa a programa con la transición elegida. Con «automático», se ejecuta a su hora.
const VX={img:{A:null,B:null},imgId:{A:'',B:''},timer:{A:0,B:0},anim:0};
const VX_PRES_KEY='as.presentations';
for(const d of ['A','B']){const v=state.video[d];if(!v.kind)v.kind='video';if(v.page==null)v.page=0;if(v.auto==null)v.auto=0;v.clip=false}
if(state.clipXfader==null)state.clipXfader=true;
if(state.cueAuto==null)state.cueAuto=false;

// ---------- presentaciones (lista guardada en el navegador; las diapositivas son imágenes de la biblioteca) ----------
function vxPresSave(){try{localStorage.setItem(VX_PRES_KEY,JSON.stringify(state.tracks.filter(t=>t.kind==='presentation').map(t=>({id:t.id,name:t.name,pages:t.pages}))))}catch(e){}}
function vxPresLoad(){let list=[];try{list=JSON.parse(localStorage.getItem(VX_PRES_KEY)||'[]')}catch(e){}
  for(const p of list)if(!state.tracks.some(t=>t.id===p.id))state.tracks.push(vxPresTrack(p.id,p.name,p.pages))}
function vxPresTrack(id,name,pages){return {id,name,artist:`Presentación · ${pages.length} diapositiva(s)`,kind:'presentation',genre:'Presentación',bpm:0,duration:0,src:null,demo:false,pages}}
vxPresLoad();

function vxImageId(deck){const v=state.video[deck];
  if(v.kind==='image')return v.track||'';
  if(v.kind==='slides'){const p=trackFor(v.pres);return p&&p.pages?p.pages[Math.max(0,Math.min(p.pages.length-1,v.page))]||'':''}
  return ''}
function vxImg(deck){const id=vxImageId(deck);if(!id)return null;
  if(VX.imgId[deck]!==id){VX.imgId[deck]=id;const url=mediaUrls.get(id);const im=new Image();if(url)im.src=url;VX.img[deck]=im}
  return VX.img[deck]}

// Fuente del deck: foto o diapositiva si corresponde; si no, el video de siempre.
const vxSourceVideo=vjSource;
vjSource=function(deck){const k=state.video[deck].kind;
  if(k==='image'||k==='slides'){const im=vxImg(deck);if(im&&im.complete&&im.naturalWidth)return {src:im,w:im.naturalWidth,h:im.naturalHeight,video:false};return null}
  return vxSourceVideo(deck)};

function vxSetVisual(deck,patch){
  const v=state.video[deck];
  if(v.clip)vxClipOff(deck,true);
  if(patch.kind!=='video'){vjLoad(deck,null);v.playing=false}
  clearInterval(VX.timer[deck]);VX.timer[deck]=0;
  Object.assign(v,{track:null,pres:null,page:0,auto:0},patch);
  vjStart();
}

const vxLoadBase=loadToDeck;
loadToDeck=async function(id,deck){const t=trackFor(id);
  if(t&&t.kind==='image'){vxSetVisual(deck,{kind:'image',track:id});command('video.transport',{op:'load-image',id,deck},'LOCAL');toast(`Foto «${t.name}» en el deck de video ${deck}`);render();return}
  if(t&&t.kind==='presentation'){vxSetVisual(deck,{kind:'slides',pres:id,page:0});command('video.transport',{op:'load-slides',id,deck},'LOCAL');toast(`Presentación «${t.name}» en el deck ${deck} (${t.pages.length} diapositivas)`);render();return}
  if(t&&t.kind==='video'&&state.video[deck].kind!=='video')vxSetVisual(deck,{kind:'video'});
  return vxLoadBase(id,deck)};

function vxSlide(deck,delta){const v=state.video[deck],p=trackFor(v.pres);if(!p)return;
  const n=p.pages.length;v.page=((v.page+delta)%n+n)%n;command('video.transport',{op:'slide',deck,page:v.page+1},'LOCAL');vxPaint(deck)}
function vxAuto(deck,secs){const v=state.video[deck];v.auto=secs;clearInterval(VX.timer[deck]);VX.timer[deck]=0;
  if(secs>0)VX.timer[deck]=setInterval(()=>vxSlide(deck,1),secs*1000)}
function vxPaint(deck){const el=document.getElementById('vx-page-'+deck),v=state.video[deck],p=trackFor(v.pres);
  if(el&&p)el.textContent=`Diapositiva ${v.page+1} de ${p.pages.length}`}

// ---------- PDF → diapositivas (pdf.js incluido en /vendor, funciona sin internet) ----------
let VX_PDF=null;
async function vxPdfLib(){if(VX_PDF)return VX_PDF;
  const lib=await import('/vendor/pdfjs/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.min.mjs';VX_PDF=lib;return lib}
async function vxImportPdf(file){
  const lib=await vxPdfLib();
  const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const base=file.name.replace(/\.pdf$/i,''),pages=[];
  toast(`Convirtiendo «${base}» (${doc.numPages} páginas)…`);
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i),vp0=page.getViewport({scale:1}),scale=Math.min(4,1920/vp0.width),vp=page.getViewport({scale});
    const c=document.createElement('canvas');c.width=Math.round(vp.width);c.height=Math.round(vp.height);
    const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:g,viewport:vp,canvas:c}).promise;
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    pages.push(addTrackFromFile(new File([blob],`${base} · ${i} de ${doc.numPages}.png`,{type:'image/png'})).id);
  }
  return vxNewPresentation(base,pages);
}
function vxNewPresentation(name,pages){const t=vxPresTrack(uid('pres'),name,pages);state.tracks.push(t);vxPresSave();
  command('catalog.import',{id:t.id,name,type:'presentation',pages:pages.length},'LOCAL');return t}

const vxUploadBase=handleMediaUpload;
handleMediaUpload=async function(input){const files=[...input.files],key=input.dataset.file||'';
  const pdfs=files.filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name));
  const imgs=files.filter(f=>f.type.startsWith('image/'));
  const deck=/^(video|visual)-[AB]$/.test(key)?key.slice(-1):null;
  if(!pdfs.length&&!(deck&&imgs.length>1))return vxUploadBase(input);
  try{
    let last=null;
    for(const f of pdfs)last=await vxImportPdf(f);
    if(deck&&imgs.length>1&&!pdfs.length)last=vxNewPresentation(imgs.length+' fotos',imgs.map(f=>addTrackFromFile(f).id));
    if(deck&&last)await loadToDeck(last.id,deck);else{render();toast('Presentación añadida a la biblioteca.')}
  }catch(e){toast('No se pudo leer el PDF: '+(e.message||e),true)}
  input.value=''};

// ---------- V1b: videoclips (imagen + sonido sincronizados) ----------
async function vxClipOn(deck){
  const v=state.video[deck],t=trackFor(v.track);
  if(v.kind!=='video'||!t||!mediaUrls.has(t.id)){toast('Carga primero un video en el deck '+deck,true);return}
  if(LIVE.on){toast('Los videoclips con sonido usan el audio del navegador: desactiva el «motor profesional» para usarlos.',true);return}
  const a=audioEls[deck];a.pause();a.src=mediaUrls.get(t.id);a.load();
  Object.assign(state.deck[deck],{track:t.id,playing:false,cues:{},bpm:t.bpm||120});
  try{initAudio()}catch(e){}
  v.clip=true;const el=vjVideo(deck);el.pause();el.currentTime=0;
  command('video.transport',{op:'clip-on',deck,id:t.id},'LOCAL');
  toast(`Videoclip en ${deck}: el sonido va al deck de audio ${deck} y la imagen lo sigue.`);render()}
function vxClipOff(deck,silent){const v=state.video[deck];if(!v.clip)return;v.clip=false;
  const a=audioEls[deck];a.pause();state.deck[deck].playing=false;
  if(!silent){command('video.transport',{op:'clip-off',deck},'LOCAL');toast('Videoclip desvinculado: audio e imagen vuelven a ser independientes.');render()}}
// La imagen sigue al audio en cada cuadro: reproducción, posición (saltos, CUE) y velocidad (pitch).
function vxSync(){requestAnimationFrame(vxSync);
  let any=false;
  for(const d of ['A','B']){const v=state.video[d];if(!v.clip)continue;any=true;
    const a=audioEls[d],el=VJ.el[d];if(!el||!vjHasSource(d)||!(el.readyState>=1))continue;
    const rate=a.playbackRate||1;if(Math.abs(el.playbackRate-rate)>1e-3)el.playbackRate=rate;
    if(a.paused){if(!el.paused)el.pause()}else if(el.paused)el.play().catch(()=>{});
    if(Math.abs(el.currentTime-a.currentTime)>0.08&&el.duration&&a.currentTime<=el.duration)el.currentTime=a.currentTime;
    v.playing=!a.paused}
  if(any&&state.clipXfader&&state.videoMix!==state.audioCross){state.videoMix=state.audioCross;
    const s=document.querySelector('input[data-change="video-cross"]');if(s&&document.activeElement!==s)s.value=state.videoMix}}
requestAnimationFrame(vxSync);

// ---------- pantalla: controles de cada deck de video ----------
videoControls=function(deck){
  const v=state.video[deck],vis=state.tracks.filter(t=>(t.kind==='video'||t.kind==='image'||t.kind==='presentation')&&(t.kind==='presentation'||mediaUrls.has(t.id)));
  const cur=v.kind==='slides'?v.pres:v.track,curT=trackFor(cur);
  const kindTag={video:'VIDEO',image:'FOTO',slides:'PRESENTACIÓN'}[v.kind]||'VIDEO';
  const label=t=>({video:'▷ ',image:'▣ ',presentation:'▤ '}[t.kind]||'')+t.name;
  const p=v.kind==='slides'?trackFor(v.pres):null;
  return `<section class="panel video-controls"><div class="panel-head"><h2>VIDEO DECK ${deck}</h2>${tag(curT?kindTag+(v.clip?' · CON SONIDO':''):'SIN FUENTE',curT?'ok':'pending')}</div>
  <div class="vj-deck-slot" data-vslot="deck-${deck}"></div>
  ${v.kind==='video'?`<div class="pillbar spaced">${v.clip?`<small class="muted">El videoclip sigue al <b>deck de audio ${deck}</b>: usa PLAY, CUE y pitch del deck de audio.</small>`:`${button(v.playing?'❚❚ Pausar':'▶ Reproducir','video-play',{deck},'primary')}${button('CUE','video-cue',{deck})}${button(v.loop?'LOOP ✓':'LOOP','video-loop',{deck},v.loop?'active':'')}`}
    ${curT?button(v.clip?'🔊 Videoclip con sonido: SÍ':'🔇 Videoclip con sonido: NO','vx-clip',{deck},v.clip?'active':''):''}
    ${v.clip?button(state.clipXfader?'⇄ Crossfader compartido: SÍ':'⇄ Crossfader compartido: NO','vx-xlink',{deck},state.clipXfader?'active':''):''}</div>`:''}
  ${p?`<div class="pillbar spaced">${button('◀','vx-prev',{deck})}<span id="vx-page-${deck}" class="micro">Diapositiva ${v.page+1} de ${p.pages.length}</span>${button('▶','vx-next',{deck})}
    <label class="field compact">Avance${sel('vx-auto-'+deck,[['0','Manual'],['5','Cada 5 s'],['10','Cada 10 s'],['20','Cada 20 s'],['30','Cada 30 s']],String(v.auto||0),`data-change="vx-auto" data-deck="${deck}"`)}</label></div>`:''}
  <div class="pillbar spaced"><label class="btn">+ Video, foto o PDF ${deck}<input type="file" data-file="video-${deck}" accept="video/*,image/*,application/pdf,.pdf" multiple hidden></label></div>
  ${vis.length?`<label class="field">Desde la biblioteca${sel('video-pick-'+deck,[['','— elegir —'],...vis.map(t=>[t.id,label(t)])],cur&&vis.some(t=>t.id===cur)?cur:'',`data-change="video-pick" data-deck="${deck}"`)}</label>`:''}
  ${v.kind==='video'&&!v.clip?slider('seek','Posición',v.seek,0,100,`data-change="video-seek" data-deck="${deck}"`):''}
  <small>${esc(curT?curT.name:'Carga un video, una foto o un PDF (presentación). Varias fotos a la vez forman una presentación.')}</small></section>`};

// ---------- V3: cues de eventos reales ----------
function vxCrossTo(target){cancelAnimationFrame(VX.anim);
  if(state.videoTrans==='cut'||!state.videoLive){state.videoMix=target;return}
  const from=state.videoMix,t0=performance.now(),ms=900;
  const step=()=>{const k=Math.min(1,(performance.now()-t0)/ms);state.videoMix=Math.round(from+(target-from)*k);
    const s=document.querySelector('input[data-change="video-cross"]');if(s)s.value=state.videoMix;if(k<1)VX.anim=requestAnimationFrame(step)};
  VX.anim=requestAnimationFrame(step)}
async function vxRunCue(c,auto){
  const t=trackFor(c.item);
  if(!t){toast(`Cue «${c.name}»: elige qué mostrar (video, foto o presentación).`,true);return false}
  // El cue manda sobre la mezcla de video: si había un videoclip con crossfader compartido, se desvincula
  // (si no, el crossfader de audio devolvería la mezcla a su posición en el siguiente cuadro).
  if(state.clipXfader&&(state.video.A.clip||state.video.B.clip)){state.clipXfader=false;toast('Crossfader de video desvinculado del de audio para el cue.')}
  const deck=state.videoMix<50?'B':'A';             // el deck que NO está al aire
  await loadToDeck(t.id,deck);
  if(t.kind==='video'){const el=vjVideo(deck);el.currentTime=0;try{await el.play();state.video[deck].playing=true}catch(e){}}
  vxCrossTo(deck==='A'?0:100);
  if(!state.videoLive){state.videoLive=true;state.programSource=deck}
  c.lastRun=new Date().toISOString().slice(0,10);
  command('event.cue',{id:c.id,action:'execute',item:t.id,deck,auto:!!auto},'LOCAL');
  toast(`${auto?'Cue automático':'Cue'} «${c.name}»: ${t.name} al aire (deck ${deck}).`);save();render();return true}
// Ejecución automática a la hora del cue (una vez por día).
setInterval(()=>{if(!state.cueAuto)return;const now=new Date(),hm=now.toTimeString().slice(0,5),day=now.toISOString().slice(0,10);
  for(const c of state.cuesheets)if(c.time===hm&&c.item&&c.lastRun!==day)vxRunCue(c,true)},10000);

eventPage=function(){
  const items=state.tracks.filter(t=>(t.kind==='video'&&mediaUrls.has(t.id))||(t.kind==='image'&&mediaUrls.has(t.id))||t.kind==='presentation');
  const opt=[['','— qué mostrar —'],...items.map(t=>[t.id,({video:'▷ ',image:'▣ ',presentation:'▤ '}[t.kind])+t.name])];
  return `${pageTitle('Eventos y presentaciones','Organiza el evento: cada cue muestra un video, una foto o una presentación a su hora.')}<div class="grid2"><section class="panel"><h2>Calendario de eventos</h2><form data-form="event"><div class="formrow">${field('name','Nombre de evento','','text','required')}${field('date','Fecha','','date','required')}${field('venue','Lugar','', 'text','required')}${field('start','Hora de inicio','18:00','time','required')}</div><button class="primary" type="submit">+ Crear evento</button></form><div class="divider"></div>${state.events.map(e=>`<div class="listrow"><div><strong>${esc(e.name)}</strong><small>${esc(e.date)} · ${esc(e.start)} · ${esc(e.venue)}</small></div>${button('Eliminar','event-delete',{id:e.id},'danger')}</div>`).join('')||'<div class="empty">Sin eventos programados.</div>'}</section>
  <section class="panel"><div class="panel-head"><h2>Cues del evento</h2>${button(state.cueAuto?'⏰ Automático: SÍ':'⏰ Automático: NO','vx-cue-auto',{},state.cueAuto?'active':'')}</div>
  <form data-form="cue"><div class="formrow">${field('time','Hora','19:15','time','required')}${field('name','Escena','','text','required')}<label class="field">Mostrar${sel('item',opt,'')}</label></div><button type="submit" class="primary">+ Agregar cue</button></form><div class="divider"></div>
  ${state.cuesheets.map(c=>{const t=trackFor(c.item);return `<div class="listrow"><div><strong>${esc(c.time)} · ${esc(c.name)}</strong><small>${t?esc(({video:'Video',image:'Foto',presentation:'Presentación'}[t.kind]||'')+' · '+t.name):'Sin contenido elegido'}${c.lastRun?' · ejecutado '+esc(c.lastRun):''}</small></div><div class="actions">${button('Ejecutar','cue-execute',{id:c.id},'primary')}${button('×','cue-delete',{id:c.id},'danger')}</div></div>`}).join('')||'<p class="muted">Sin cues. Agrega escenas para el evento.</p>'}
  <div class="callout spaced">«Ejecutar» carga el contenido en el deck que no está al aire y lo pasa a programa con la transición elegida en «Producción video». Con «Automático: SÍ» cada cue se ejecuta solo a su hora (con esta pestaña abierta).</div></section></div>
  <section class="panel spaced"><h2>Recursos audiovisuales</h2><div class="pillbar">${button('Mezcladora de video','navigate',{page:'video'})}${button('Biblioteca multimedia','navigate',{page:'biblioteca'})}</div></section>`};

async function vxAction(n,a){switch(n){
  case 'vx-clip':{const d=a.deck;state.video[d].clip?vxClipOff(d):await vxClipOn(d);break}
  case 'vx-xlink':state.clipXfader=!state.clipXfader;toast(state.clipXfader?'El crossfader de audio mueve también la mezcla de video.':'Crossfader de video independiente.');render();break;
  case 'vx-prev':vxSlide(a.deck,-1);break;
  case 'vx-next':vxSlide(a.deck,1);break;
  case 'vx-cue-auto':state.cueAuto=!state.cueAuto;toast(state.cueAuto?'Los cues se ejecutarán solos a su hora (deja esta pestaña abierta).':'Cues en modo manual.');save();render();break;
  case 'cue-execute':{const c=state.cuesheets.find(c=>c.id===a.id);if(c)await vxRunCue(c,false);break}
}}

window.__ASVX={state:()=>({A:{...state.video.A},B:{...state.video.B},mix:state.videoMix,live:state.videoLive,xlink:state.clipXfader,
  pres:state.tracks.filter(t=>t.kind==='presentation').map(t=>({id:t.id,name:t.name,pages:t.pages.length})),cues:state.cuesheets.map(c=>({...c}))}),
  runCue:(id)=>{const c=state.cuesheets.find(c=>c.id===id);return c?vxRunCue(c,true):false},
  seekAudio:(d,t)=>{audioEls[d].currentTime=t},
  tracks:()=>state.tracks.map(t=>({id:t.id,name:t.name,kind:t.kind})),
  clipSync:(d)=>{const a=audioEls[d],el=VJ.el[d];return el?{audio:a.currentTime,video:el.currentTime,aPaused:a.paused,vPaused:el.paused,rate:el.playbackRate}:null}};
