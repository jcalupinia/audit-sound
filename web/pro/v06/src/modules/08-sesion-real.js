// --- Sesión real del Command Center (AUDIT-IA) para la consola v0.6 ---
// Con AUDIT_SOUND_CC_API configurado (producción), la v0.6 NO ofrece la entrada de demostración:
// usa la sesión iniciada en ../login.html, la comprueba con GET /apps/auth/me y, si falta o caducó,
// vuelve a ../login.html explicando el motivo. Sin Command Center (desarrollo y pruebas) o con
// AUDIT_SOUND_ALLOW_DEMO habilitado a propósito, la consola sigue con su demostración de siempre.
const CC_CFG={api:String(window.AUDIT_SOUND_CC_API||'').replace(/\/+$/,''),me:window.AUDIT_SOUND_CC_ME_PATH||'/apps/auth/me',app:window.AUDIT_SOUND_CC_APP||'audit_sound'};
function ccEnabled(){const d=window.AUDIT_SOUND_ALLOW_DEMO;return !!CC_CFG.api&&!(d===true||d===1||d==='1'||d==='true')}
function ccClear(){try{for(const k of ['auditsound.cc.token','auditsound.cc.user','auditsound.cc.apps']){localStorage.removeItem(k);sessionStorage.removeItem(k)}}catch(e){}}
function ccToLogin(reason){ccClear();location.replace('../login.html'+(reason?'?motivo='+encodeURIComponent(reason):''))}
async function ccCheck(){const tok=agentCcToken();if(!tok)return {ok:false,reason:'sin_sesion'};
  let r;const ac=typeof AbortController!=='undefined'?new AbortController():null,tm=ac?setTimeout(()=>ac.abort(),6000):null;
  try{r=await fetch(CC_CFG.api+CC_CFG.me,{headers:{Authorization:'Bearer '+tok},cache:'no-store',signal:ac?ac.signal:undefined})}catch(e){return {ok:false,network:true}}finally{if(tm)clearTimeout(tm)}
  if(r.status===401||r.status===403)return {ok:false,reason:'caducada'};
  if(!r.ok)return {ok:false,network:true,status:r.status};
  let me={};try{me=await r.json()}catch(e){}
  if(Array.isArray(me.apps)&&!me.apps.includes(CC_CFG.app))return {ok:false,reason:'sin_acceso'};
  if(me.password_reset_required)return {ok:false,reason:'cambiar_clave'};
  return {ok:true,me}}
async function ccEnter(){const c=await ccCheck();
  if(!c.ok&&!c.network){ccToLogin(c.reason);return}
  state.logged=true;state.ccUser=(c.me&&(c.me.display_name||c.me.email))||'';state.page='inicio';
  render();hydrateLibrary();
  if(c.network)toast('No se pudo comprobar tu sesión con el Command Center (sin conexión). Se volverá a comprobar al conectar el agente.',true)}
// El agente rechazó la sesión: ¿caducó o falta configurar el agente?
async function ccAgentRejected(){if(!CC_CFG.api)return;const c=await ccCheck();
  if(!c.ok&&!c.network){toast('Tu sesión AUDIT-IA caducó. Vuelve a iniciar sesión.',true);setTimeout(()=>ccToLogin(c.reason),1800);return}
  if(c.ok)toast('Tu sesión AUDIT-IA es válida, pero el agente no la aceptó: revisa DJ_AGENT_CC_API en el servidor del agente.',true)}
function ccLogout(){for(const s of ['A','B']){try{audioEls[s].pause();if(LIVE.on&&LIVE.bridge)LIVE.bridge.play(DECK_IDX[s],false)}catch(e){}}ccToLogin('')}

// «Escuchar en vivo»: el reproductor vive FUERA de la página (render() reconstruye el HTML y antes
// destruía el <audio> que acababa de arrancar: nunca sonaba). Uno solo para toda la sesión.
let LIVE_AUDIO=null;
function liveAudio(){if(!LIVE_AUDIO){LIVE_AUDIO=new Audio();LIVE_AUDIO.preload='none';
  LIVE_AUDIO.addEventListener('error',()=>{if(!LIVE_AUDIO.getAttribute('src'))return;state.streamConnected=false;if(state.page==='en-vivo')render();toast('La transmisión no responde. Revisa la URL o inténtalo de nuevo.',true)})}
  return LIVE_AUDIO}
window.__ASLIVE={time:()=>LIVE_AUDIO?LIVE_AUDIO.currentTime:0,paused:()=>!LIVE_AUDIO||LIVE_AUDIO.paused,src:()=>LIVE_AUDIO?LIVE_AUDIO.src:''};
// «Escuchar en vivo»: sin URL guardada, se usa la del stream real del servidor (config.js).
if(!state.streamUrl&&typeof window.AUDIT_SOUND_STREAM==='string'&&safeUrl(window.AUDIT_SOUND_STREAM))state.streamUrl=window.AUDIT_SOUND_STREAM;
if(ccEnabled()){root.innerHTML='<main class="cc-gate" role="status">Comprobando tu sesión AUDIT-IA…</main>';ccEnter()}
else render();
})();
