// ===== 06 · Voz y móvil (Fase 6) =====
// Dictado: lo hace el NAVEGADOR (Web Speech API). El texto se escribe en el cuadro de la orden y NUNCA
// se envía solo: la persona lo revisa y pulsa «Enviar». Las acciones críticas siguen exigiendo
// aprobación en el servidor, vengan de voz o de texto. Si el agente está conectado, la orden viaja
// con channel:"voice" para que la auditoría distinga lo dictado.
// Móvil: al volver la pestaña a primer plano o recuperar la red, se reconectan los eventos y se
// resincroniza la sesión (los navegadores móviles cortan los WebSocket en segundo plano).
const VOICE={rec:null,listening:false,base:'',finalText:'',dictated:'',noticed:false};
const VOICE_ERR={
  'not-allowed':'Permiso de micrófono denegado. Actívalo en los ajustes del navegador (en iPhone: Ajustes › Safari › Micrófono).',
  'service-not-allowed':'El navegador no permite el dictado en esta página.',
  'no-speech':'No se oyó nada. Acércate al micrófono y vuelve a intentarlo.',
  'audio-capture':'No se encontró un micrófono en este dispositivo.',
  'network':'El dictado del navegador necesita conexión a internet.',
  'language-not-supported':'El idioma del dictado no está disponible en este navegador.'};

function voiceRecognizer(){return window.SpeechRecognition||window.webkitSpeechRecognition||null}
function voiceTextarea(){return document.querySelector('main form[data-form=agent] textarea[name=message]')||document.querySelector('form[data-form=agent] textarea[name=message]')}
function voiceSecure(){return window.isSecureContext||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)}

function voiceButtons(){
  document.querySelectorAll('button[data-action=agent-voice]').forEach(b=>{
    if(!b.dataset.label)b.dataset.label=b.textContent;
    b.textContent=VOICE.listening?'⏹ Detener dictado':b.dataset.label;
    b.classList.toggle('active',VOICE.listening);
    b.setAttribute('aria-pressed',String(VOICE.listening));
  });
}

function voiceWrite(extra){
  const ta=voiceTextarea();if(!ta)return;
  ta.value=[VOICE.base,(VOICE.finalText+' '+(extra||'')).trim()].filter(Boolean).join(' ').slice(0,1500);
}

function voiceToggle(){
  if(VOICE.listening){try{VOICE.rec&&VOICE.rec.stop()}catch(e){}return}
  const ta=voiceTextarea();
  if(!voiceSecure()){toast('El dictado necesita una conexión segura (HTTPS). Escribe la orden en el cuadro.',true);ta&&ta.focus();return}
  const SR=voiceRecognizer();
  if(!SR){toast('Este navegador no admite dictado. Escribe la orden en el cuadro (en iPhone usa el micrófono del teclado).',true);ta&&ta.focus();return}
  if(!VOICE.noticed){
    VOICE.noticed=true;
    state.chat.push({who:'system',label:'Dictado',text:'El dictado lo hace tu navegador: Chrome y Edge envían el audio a Google o Microsoft, y Safari a Apple. AUDIT SOUND no graba ni guarda el audio. El texto queda en el cuadro para que lo revises antes de enviarlo.'});
    agentRender();
  }
  const rec=new SR();
  rec.lang=(state.settings&&state.settings.voiceLang)||'es-EC';
  rec.interimResults=true;rec.continuous=false;rec.maxAlternatives=1;
  VOICE.rec=rec;VOICE.base=(voiceTextarea()&&voiceTextarea().value.trim())||'';VOICE.finalText='';
  rec.onresult=(e)=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const r=e.results[i];
      if(r.isFinal)VOICE.finalText=(VOICE.finalText+' '+r[0].transcript).trim();else interim+=r[0].transcript;
    }
    voiceWrite(interim);
  };
  rec.onerror=(e)=>{if(e.error!=='aborted')toast(VOICE_ERR[e.error]||('Error de dictado: '+e.error),true)};
  rec.onend=()=>{
    VOICE.listening=false;VOICE.rec=null;voiceButtons();
    if(VOICE.finalText){
      voiceWrite('');VOICE.dictated=VOICE.finalText;
      const t=voiceTextarea();if(t){t.focus();try{t.setSelectionRange(t.value.length,t.value.length)}catch(x){}}
      toast('Dictado listo: revísalo y pulsa «Enviar».');
    }
  };
  try{rec.start()}catch(e){toast('No se pudo iniciar el dictado: '+(e.message||e),true);return}
  VOICE.listening=true;voiceButtons();
  command('agent.voice',{lang:rec.lang},'LOCAL');
  toast('Escuchando… habla y luego revisa el texto.');
}

// Canal de la orden que se va a enviar: «voice» si hubo dictado desde el último envío.
function voiceChannelFor(text){const c=VOICE.dictated&&text.includes(VOICE.dictated)?'voice':'text';VOICE.dictated='';return c}

// --- Móvil: reanudar al volver a primer plano o al recuperar la red ---
// En móvil un WebSocket puede quedar «medio abierto» (figura OPEN pero ya no recibe nada): al volver
// a primer plano o recuperar la red se abre uno NUEVO (el agente reenvía lo perdido con «after»).
function agentReopenWs(){
  if(AGENT.ws){try{AGENT.ws.onclose=null;AGENT.ws.close()}catch(e){}AGENT.ws=null}
  AGENT.wsOk=false;AGENT.retry=0;clearTimeout(AGENT.timer);agentOpenWs();
}
function agentResume(){
  if(!agentLive())return;
  agentReopenWs();
  agentFetch('/sessions/'+AGENT.sid).then(s=>{agentApplySession(s);return agentSyncProposals()}).then(agentRender).catch(()=>{});
}
// Pulso: cada 25 s un «ping»; si en 70 s no llegó ningún mensaje, la conexión está muerta → reabrir.
setInterval(()=>{
  if(!agentLive()||document.visibilityState!=='visible'||!AGENT.ws)return;
  if(AGENT.ws.readyState===1){try{AGENT.ws.send(JSON.stringify({type:'ping'}))}catch(e){}}
  if(AGENT.lastMsg&&Date.now()-AGENT.lastMsg>70000){agentReopenWs();agentRender()}
},25000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')agentResume()});
window.addEventListener('online',agentResume);
window.addEventListener('offline',()=>{if(agentLive()){AGENT.wsOk=false;toast('Sin conexión: el audio del servidor sigue con AutoMix; la consola se reconectará sola.',true);agentRender()}});

render();
})();
