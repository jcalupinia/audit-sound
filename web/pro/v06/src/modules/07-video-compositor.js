// --- Bloque 2 · V1: compositor de video por GPU (WebGL) y biblioteca de videos persistente ---
// Los reproductores <video> y los lienzos viven FUERA del redibujo de la página (render() reemplaza el
// HTML completo): se "estacionan" en un contenedor oculto antes de cada render y se vuelven a montar en
// los huecos data-vslot después. Así la reproducción no se reinicia al tocar cualquier control.
// La mezcla (fundido, corte, barrido), los efectos (brillo, desenfoque, glitch), el texto y el logo se
// componen en un shader. Sin WebGL hay un respaldo en Canvas 2D. El audio NUNCA depende de esto.
const VJ_W=1280,VJ_H=720;
const VJ={el:{A:null,B:null},host:null,glCanvas:null,gl:null,prog:null,u:{},tex:{},program:null,programCtx:null,
  overlay:null,overlayCtx:null,overlayKey:'',overlayDirty:true,poster:{},logo:{id:'',img:null},mode:'',
  fps:0,frames:0,fpsT:0,raf:0,drawn:0,t0:performance.now()};
for(const [k,v] of Object.entries({videoFx:'none',videoFxAmount:50,videoCaption:'',videoLogo:''}))if(state[k]==null)state[k]=v;
const VJ_FX={none:0,brightness:1,blur:2,glitch:3},VJ_TRANS={fade:0,cut:1,wipe:2};

function vjHostEl(){if(VJ.host)return VJ.host;const h=document.createElement('div');h.id='vj-host';h.setAttribute('aria-hidden','true');
  h.style.cssText='position:fixed;left:-10000px;top:0;width:4px;height:4px;overflow:hidden;opacity:0;pointer-events:none';
  document.body.appendChild(h);VJ.host=h;return h}
function vjVideo(deck){if(VJ.el[deck])return VJ.el[deck];const v=document.createElement('video');v.id='video-src-'+deck;
  v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.preload='auto';v.className='vj-deck-video';
  v.poster=fileAsset('video-poster-'+deck.toLowerCase()+'.jpg');
  v.addEventListener('timeupdate',()=>{if(v.duration){state.video[deck].seek=Math.round(100*v.currentTime/v.duration);
    const s=document.querySelector(`input[data-change="video-seek"][data-deck="${deck}"]`);if(s&&document.activeElement!==s)s.value=state.video[deck].seek}});
  v.addEventListener('ended',()=>{if(!v.loop){state.video[deck].playing=false;render()}});
  vjHostEl().appendChild(v);VJ.el[deck]=v;return v}
function vjHasSource(deck){const v=VJ.el[deck];return !!(v&&v.getAttribute('src'))}
// Asigna (o quita) el archivo de un deck de video. Solo toca el src si cambió: no reinicia lo que suena.
function vjLoad(deck,id){const v=vjVideo(deck),url=id?mediaUrls.get(id):null;
  if(url){if(v.getAttribute('src')!==url){v.pause();v.setAttribute('src',url);v.load()}}
  else if(v.getAttribute('src')){v.pause();v.removeAttribute('src');v.load()}
  v.loop=!!state.video[deck].loop}

// ---------- WebGL ----------
const VJ_VS='attribute vec2 p;varying vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.,1.);}';
const VJ_FS=`precision mediump float;varying vec2 uv;
uniform sampler2D tA,tB,tO;uniform vec4 cA,cB;uniform float mixv,amt,time,hasO;uniform int trans,fx;uniform vec2 px;
vec2 cov(vec4 c,vec2 p){return p*c.xy+c.zw;}
vec4 blur(sampler2D t,vec2 p,float r){vec4 s=vec4(0.);for(int i=-2;i<=2;i++)for(int j=-2;j<=2;j++)s+=texture2D(t,p+vec2(float(i),float(j))*px*r);return s/25.;}
vec4 pick(sampler2D t,vec4 c,vec2 q){vec2 p=cov(c,q);
  if(fx==2)return blur(t,p,1.+amt*5.);
  if(fx==3){float d=.008*amt;return vec4(texture2D(t,p+vec2(d,0.)).r,texture2D(t,p).g,texture2D(t,p-vec2(d,0.)).b,1.);}
  return texture2D(t,p);}
void main(){vec2 q=uv;
  if(fx==3){float band=floor(q.y*24.+time*6.);q.x+=(fract(sin(band*91.7+floor(time*9.))*43758.5)-.5)*.06*amt;q.x=clamp(q.x,0.,1.);}
  vec4 a=pick(tA,cA,q),b=pick(tB,cB,q);float w=mixv;
  if(trans==1)w=step(.5,mixv);
  else if(trans==2){w=mixv<=0.?0.:(mixv>=1.?1.:1.-smoothstep(mixv-.008,mixv+.008,uv.x));}
  vec4 c=mix(a,b,w);
  if(fx==1)c.rgb*=.3+amt*1.4;
  vec4 o=texture2D(tO,uv);c.rgb=mix(c.rgb,o.rgb,o.a*hasO);
  gl_FragColor=vec4(clamp(c.rgb,0.,1.),1.);}`;
function vjInitGL(){const c=document.createElement('canvas');c.width=VJ_W;c.height=VJ_H;c.className='vj-canvas';c.dataset.vjCanvas='mix';
  VJ.glCanvas=c;let gl=null;
  try{gl=c.getContext('webgl',{preserveDrawingBuffer:true,antialias:false,premultipliedAlpha:false})}catch(e){gl=null}
  if(gl){try{
    const sh=(t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);if(!gl.getShaderParameter(o,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(o));return o};
    const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,VJ_VS));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,VJ_FS));gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(pr));gl.useProgram(pr);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    for(const n of ['tA','tB','tO','cA','cB','mixv','amt','time','hasO','trans','fx','px'])VJ.u[n]=gl.getUniformLocation(pr,n);
    ['A','B','O'].forEach((k,i)=>{const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);
      for(const [p,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([6,13,19,255]));VJ.tex[k]=t;gl.uniform1i(VJ.u['t'+k],i)});
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.viewport(0,0,VJ_W,VJ_H);gl.uniform2f(VJ.u.px,1/VJ_W,1/VJ_H);
    VJ.gl=gl;VJ.prog=pr;VJ.mode='GPU (WebGL)';
  }catch(e){console.warn('compositor WebGL no disponible:',e);VJ.gl=null}}
  if(!VJ.gl){VJ.mode='Canvas 2D (sin GPU)';VJ.ctx2d=c.getContext('2d')}
  const p=document.createElement('canvas');p.width=VJ_W;p.height=VJ_H;p.className='vj-canvas';p.dataset.vjCanvas='program';VJ.program=p;VJ.programCtx=p.getContext('2d');
  const o=document.createElement('canvas');o.width=VJ_W;o.height=VJ_H;VJ.overlay=o;VJ.overlayCtx=o.getContext('2d');
  for(const d of ['A','B']){const im=new Image();im.onload=()=>{VJ.poster[d].ok=true};im.src=fileAsset('video-poster-'+d.toLowerCase()+'.jpg');VJ.poster[d]={img:im,ok:false}}}

// Fuente de cada deck: el video si ya tiene cuadros; si no, el cartel de referencia.
function vjSource(deck){const v=VJ.el[deck];if(v&&vjHasSource(deck)&&v.readyState>=2&&v.videoWidth)return {src:v,w:v.videoWidth,h:v.videoHeight,video:true};
  const p=VJ.poster[deck];if(p&&p.ok)return {src:p.img,w:p.img.naturalWidth,h:p.img.naturalHeight,video:false};return null}
// Recorte tipo "cover": escala y desplazamiento de coordenadas para no deformar la imagen.
function vjCover(w,h){const ca=VJ_W/VJ_H,va=w/h;return va>ca?[ca/va,1,(1-ca/va)/2,0]:[1,va/ca,0,(1-va/ca)/2]}
function vjOverlay(){const logoId=state.videoLogo||'',key=state.videoCaption+'|'+logoId+'|'+(VJ.logo.img&&VJ.logo.img.complete?1:0);
  if(logoId!==VJ.logo.id){VJ.logo.id=logoId;VJ.logo.img=null;const url=logoId?mediaUrls.get(logoId):null;if(url){const im=new Image();im.onload=()=>{VJ.overlayDirty=true};im.src=url;VJ.logo.img=im}}
  if(key===VJ.overlayKey&&!VJ.overlayDirty)return false;VJ.overlayKey=key;VJ.overlayDirty=false;
  const g=VJ.overlayCtx;g.clearRect(0,0,VJ_W,VJ_H);const cap=(state.videoCaption||'').trim();
  if(cap){g.fillStyle='rgba(4,10,16,.72)';g.fillRect(0,VJ_H-118,VJ_W,86);g.fillStyle='#83f14d';g.fillRect(0,VJ_H-118,10,86);
    g.font='600 44px Inter, "Segoe UI", sans-serif';g.fillStyle='#ffffff';g.textBaseline='middle';
    let t=cap;while(g.measureText(t).width>VJ_W-90&&t.length>1)t=t.slice(0,-2)+'…';g.fillText(t,44,VJ_H-75)}
  const im=VJ.logo.img;if(im&&im.complete&&im.naturalWidth){const h=Math.round(VJ_H*.14),w=Math.round(h*im.naturalWidth/im.naturalHeight);g.globalAlpha=.92;g.drawImage(im,VJ_W-w-36,32,w,h);g.globalAlpha=1}
  return true}
function vjHasOverlay(){return !!((state.videoCaption||'').trim()||(VJ.logo.img&&VJ.logo.img.complete&&VJ.logo.img.naturalWidth))}
function vjDrawGL(t){const gl=VJ.gl,u=VJ.u;
  for(const [i,d] of [[0,'A'],[1,'B']]){const s=vjSource(d);gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,VJ.tex[d]);
    if(s){try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,s.src)}catch(e){}gl.uniform4fv(u['c'+d],vjCover(s.w,s.h))}else gl.uniform4fv(u['c'+d],[1,1,0,0])}
  if(vjOverlay()){gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,VJ.tex.O);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,VJ.overlay)}
  gl.uniform1f(u.mixv,state.videoMix/100);gl.uniform1f(u.amt,state.videoFxAmount/100);gl.uniform1f(u.time,t/1000);gl.uniform1f(u.hasO,vjHasOverlay()?1:0);
  gl.uniform1i(u.trans,VJ_TRANS[state.videoTrans]??0);gl.uniform1i(u.fx,VJ_FX[state.videoFx]??0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4)}
function vjDraw2D(){const g=VJ.ctx2d,m=state.videoMix/100,tr=state.videoTrans;g.fillStyle='#060d13';g.fillRect(0,0,VJ_W,VJ_H);
  const f=state.videoFx,a=state.videoFxAmount/100;g.filter=f==='brightness'?`brightness(${.3+a*1.4})`:f==='blur'?`blur(${1+a*5}px)`:'none';
  const draw=(d,alpha,clip)=>{const s=vjSource(d);if(!s||alpha<=0)return;const [sx,sy,ox,oy]=vjCover(s.w,s.h);g.save();g.globalAlpha=alpha;
    if(clip!=null){g.beginPath();g.rect(0,0,VJ_W*clip,VJ_H);g.clip()}g.drawImage(s.src,ox*s.w,oy*s.h,sx*s.w,sy*s.h,0,0,VJ_W,VJ_H);g.restore()};
  if(tr==='cut')draw(m<.5?'A':'B',1);else if(tr==='wipe'){draw('A',1);draw('B',1,m)}else{draw('A',1);draw('B',m)}
  g.filter='none';vjOverlay();if(vjHasOverlay())g.drawImage(VJ.overlay,0,0)}
function vjDrawProgram(){const g=VJ.programCtx;if(state.videoLive){g.drawImage(VJ.glCanvas,0,0);return}
  if(VJ.programIdle)return;VJ.programIdle=true;g.fillStyle='#03070b';g.fillRect(0,0,VJ_W,VJ_H);g.fillStyle='#91a7b4';g.font='600 34px Inter, sans-serif';
  g.textAlign='center';g.textBaseline='middle';g.fillText('PROGRAMA DETENIDO',VJ_W/2,VJ_H/2);g.textAlign='start'}
function vjFrame(t){VJ.raf=requestAnimationFrame(vjFrame);
  const visible=VJ.glCanvas.isConnected&&VJ.glCanvas.parentElement!==VJ.host;
  if(!visible&&!state.videoLive)return;
  if(VJ.gl)vjDrawGL(t);else vjDraw2D();
  if(state.videoLive)VJ.programIdle=false;vjDrawProgram();
  VJ.frames++;VJ.drawn++;if(t-VJ.fpsT>=1000){VJ.fps=Math.round(VJ.frames*1000/(t-VJ.fpsT||1000));VJ.frames=0;VJ.fpsT=t;
    const e=document.getElementById('vj-fps');if(e)e.textContent=VJ.fps+' cuadros/s'}}
function vjStart(){if(VJ.glCanvas)return;vjInitGL();vjVideo('A');vjVideo('B');VJ.fpsT=performance.now();VJ.raf=requestAnimationFrame(vjFrame)}

// Antes de redibujar: devolver reproductores y lienzos al contenedor (siguen sonando y dibujando).
function vjPark(){if(!VJ.host)return;for(const n of [VJ.el.A,VJ.el.B,VJ.glCanvas,VJ.program])if(n&&n.parentElement!==VJ.host)VJ.host.appendChild(n)}
// Después de redibujar: montar cada pieza en su hueco de la página.
function vjMount(){if(!state.logged)return;vjStart();
  const map={'deck-A':VJ.el.A,'deck-B':VJ.el.B,preview:VJ.glCanvas,program:VJ.program};
  for(const slot of root.querySelectorAll('[data-vslot]')){const n=map[slot.dataset.vslot];if(n)slot.appendChild(n)}
  const m=document.getElementById('vj-mode');if(m)m.textContent=VJ.mode;const f=document.getElementById('vj-fps');if(f&&VJ.fps)f.textContent=VJ.fps+' cuadros/s'}
const vjRenderBase=render;
render=function(){vjPark();vjRenderBase();vjMount()};

// Crossfader y cantidad de efecto en vivo mientras se arrastra (sin redibujar la página).
root.addEventListener('input',e=>{const el=e.target;if(el.dataset.change==='video-cross')state.videoMix=Number(el.value);else if(el.dataset.change==='video-fx-amount')state.videoFxAmount=Number(el.value)});

// ---------- Biblioteca de videos e imágenes persistente (IndexedDB propia) ----------
const VDB={p:null,hydrated:false};
function vdbOpen(){if(VDB.p)return VDB.p;VDB.p=new Promise((res,rej)=>{if(typeof indexedDB==='undefined'){rej(Error('IndexedDB no disponible'));return}
  const r=indexedDB.open('auditsound-video',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('media'))r.result.createObjectStore('media',{keyPath:'id'})};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});VDB.p.catch(()=>{VDB.p=null});return VDB.p}
function vdbTx(mode,fn){return vdbOpen().then(db=>new Promise((res,rej)=>{const tx=db.transaction('media',mode),req=fn(tx.objectStore('media'));
  tx.oncomplete=()=>res(req?req.result:undefined);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)}))}
async function videoLibPut(item,file){try{await vdbTx('readwrite',st=>st.put({id:item.id,name:item.name,kind:item.kind,type:file.type,size:file.size,blob:file,created:Date.now()}));
  item.persisted=true;if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{})}
  catch(e){toast('No se pudo guardar «'+item.name+'» en la biblioteca del navegador (espacio insuficiente o modo privado). Se usará solo en esta sesión.',true)}}
async function videoLibDelete(id){try{await vdbTx('readwrite',st=>st.delete(id))}catch(e){}}
async function videoLibHydrate(){if(VDB.hydrated)return;VDB.hydrated=true;
  try{const rows=await vdbTx('readonly',st=>st.getAll());let n=0;
    for(const r of rows||[]){if(state.tracks.some(t=>t.id===r.id))continue;mediaUrls.set(r.id,URL.createObjectURL(r.blob));
      state.tracks.push({id:r.id,name:r.name,artist:'Biblioteca de video',kind:r.kind||'video',genre:'Local',bpm:0,duration:0,src:null,demo:false,persisted:true});n++}
    if(n)render()}catch(e){}}
const vjHydrateBase=hydrateLibrary;
hydrateLibrary=function(){videoLibHydrate();return vjHydrateBase()};

// Ayudas para pruebas automáticas (sin efectos en la operación).
window.__ASVJ={get mode(){return VJ.mode},get fps(){return VJ.fps},get drawn(){return VJ.drawn},
  sample(which,x,y){const c=which==='program'?VJ.program:VJ.glCanvas;if(!c)return null;const t=document.createElement('canvas');t.width=c.width;t.height=c.height;
    const g=t.getContext('2d');g.drawImage(c,0,0);return Array.from(g.getImageData(Math.round(x*c.width),Math.round(y*c.height),1,1).data)},
  video(deck){const v=VJ.el[deck];return v?{src:!!v.getAttribute('src'),paused:v.paused,time:v.currentTime,ready:v.readyState,connected:v.isConnected}:null}};

render();
})();
