// ===== 07c · V2 · Pantalla 2 (proyector / TV) =====
// Abre una ventana «Programa» que muestra en vivo la salida Programa del compositor (lo que ve el público).
// Se lleva al segundo monitor o proyector y se pone a pantalla completa; se controla desde la consola:
// «Enviar a programa» (con la transición elegida), «Detener» y «Pánico» (logo fijo al instante).
// Si el navegador permite conocer las pantallas (Window Management API), la ventana se abre directamente
// en la pantalla secundaria. El video viaja dentro del mismo equipo (MediaStream del lienzo): no se transmite.
const P2={win:null,video:null,timer:0,screen:''};
state.programPanic=false;

function p2Open(){return !!(P2.win&&!P2.win.closed)}

async function p2Target(){
  // Pantalla secundaria, si el navegador lo permite (pide permiso la primera vez).
  if(!('getScreenDetails' in window))return null;
  try{const d=await window.getScreenDetails();const s=d.screens.find(x=>!x.isPrimary)||null;
    if(s)return {left:s.availLeft,top:s.availTop,width:s.availWidth,height:s.availHeight,label:s.label||'pantalla secundaria'}}
  catch(e){}
  return null;
}

const P2_HTML=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>AUDIT SOUND · Programa</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}video{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#hint{position:fixed;left:50%;bottom:6%;transform:translateX(-50%);font:600 18px system-ui,sans-serif;color:#cfe;background:#000b;border:1px solid #4a6;
border-radius:12px;padding:12px 18px;transition:opacity .6s;cursor:default}body.quiet #hint{opacity:0}</style></head>
<body><video id="pgm" autoplay muted playsinline></video><div id="hint">Pantalla de programa · doble clic o tecla F: pantalla completa</div>
<script>const fs=()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});else document.exitFullscreen()};
addEventListener('dblclick',fs);addEventListener('keydown',e=>{if(e.key==='f'||e.key==='F')fs()});
setTimeout(()=>document.body.classList.add('quiet'),5000);<\/script></body></html>`;

async function p2Show(){
  if(p2Open()){P2.win.focus();return}
  vjStart();
  const t=await p2Target();
  const feat=t?`popup,left=${t.left},top=${t.top},width=${t.width},height=${t.height}`:'popup,width=1280,height=720';
  const w=window.open('','as-programa',feat);
  if(!w){toast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio y vuelve a intentarlo.',true);return}
  w.document.open();w.document.write(P2_HTML);w.document.close();
  const v=w.document.getElementById('pgm');
  try{v.srcObject=VJ.program.captureStream(30)}catch(e){toast('Este navegador no puede enviar el video a otra ventana.',true);w.close();return}
  v.play().catch(()=>{});
  P2.win=w;P2.video=v;P2.screen=t?t.label:'';
  clearInterval(P2.timer);
  P2.timer=setInterval(()=>{if(!p2Open()){clearInterval(P2.timer);P2.win=null;P2.video=null;command('video.output',{output:'screen-2',open:false},'LOCAL');render()}},1000);
  command('video.output',{output:'screen-2',open:true,screen:P2.screen||'ventana'},'LOCAL');
  toast(t?`Pantalla 2 abierta en ${t.label}. Haz doble clic en ella para pantalla completa.`
         :'Pantalla 2 abierta: arrástrala al proyector y haz doble clic en ella para pantalla completa.');
  render();
}

function p2Close(){if(p2Open())P2.win.close();P2.win=null;P2.video=null;clearInterval(P2.timer);render()}

// Barra de control de la salida (se muestra en «Producción video» y en la consola).
function p2Controls(){
  return `<div class="pillbar spaced">${button(p2Open()?'🖵 Pantalla 2: ABIERTA':'🖵 Abrir pantalla 2 (proyector)','p2-open',{},p2Open()?'active':'primary')}
    ${p2Open()?button('Cerrar pantalla 2','p2-close'):''}
    ${button(state.programPanic?'⚠ PÁNICO ACTIVO · volver':'⚠ Pánico: logo fijo','video-panic',{},state.programPanic?'danger active':'danger')}</div>
    <small class="muted">${p2Open()?`Programa en la pantalla 2${P2.screen?' ('+esc(P2.screen)+')':''}. Lo que envíes a programa se ve allí con la transición elegida.`:'La pantalla 2 muestra solo la salida Programa, sin controles, para el proyector o la TV.'}</small>`;
}

async function p2Action(n){
  switch(n){
    case 'p2-open':await p2Show();break;
    case 'p2-close':p2Close();break;
    case 'video-panic':state.programPanic=!state.programPanic;command('video.program',{op:state.programPanic?'panic':'panic-off'},'LOCAL');
      toast(state.programPanic?'Pánico: el público ve el logo fijo.':'Programa restablecido.');render();break;
  }
}

window.__ASP2={open:p2Open,
  // Pixel del video que muestra la pantalla 2 (para pruebas): lo que realmente ve el público.
  sample(x,y){const v=P2.video;if(!v||!v.videoWidth)return null;const c=P2.win.document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
    const g=c.getContext('2d');g.drawImage(v,0,0);return Array.from(g.getImageData(Math.round(x*c.width),Math.round(y*c.height),1,1).data)},
  size(){const v=P2.video;return v?[v.videoWidth,v.videoHeight]:null}};
