// ===== 05 · Agente DJ en vivo (Fase 5) =====
// Conecta los controles del panel del agente con el servicio dj-agent REAL a través del proxy del
// mismo origen (/api/v1/dj-agent, ver deploy/pro/server.js). Si el servidor no anuncia el agente
// (window.AUDIT_SOUND_AGENT !== true) o no hay token, la interfaz sigue en MODO DEMOSTRACIÓN, igual
// que antes. Reglas:
//  - el servidor es la fuente de verdad: si rechaza un cambio, la interfaz vuelve al estado del servidor;
//  - el token del agente vive solo en sessionStorage de esta pestaña (nunca en localStorage ni en el código);
//  - el audio nunca depende del agente: si se cae, se avisa y AutoMix sigue en el motor.
const AGENT_BASE='/api/v1/dj-agent';
const AGENT_TOKEN_KEY='as.agent.token';
const AGENT_MODE={manual:'MANUAL',hibrido:'HIBRIDO',automatico:'AUTOMATICO'};
const AGENT_MODE_UI={MANUAL:'manual',HIBRIDO:'hibrido',AUTOMATICO:'automatico'};
const AGENT={available:window.AUDIT_SOUND_AGENT===true,connected:false,connecting:false,sid:null,mode:null,
  models:[],engine:null,usage:null,ws:null,wsOk:false,lastSeq:0,retry:0,timer:null,error:''};

// Redibujo por eventos del agente SIN perder lo que el operador está escribiendo: render() reemplaza el
// HTML entero, así que se guardan y restauran los campos de texto (valor, foco y cursor).
function agentRender(){
  const keep=[...document.querySelectorAll('form[data-form] textarea, form[data-form] input[type=text], form[data-form] input[type=password]')]
    .map(el=>({form:el.form&&el.form.dataset.form,name:el.name,value:el.value,focus:document.activeElement===el,
      s:el.selectionStart,e:el.selectionEnd})).filter(k=>k.value||k.focus);
  render();
  for(const k of keep){
    const el=document.querySelector(`form[data-form="${k.form}"] [name="${k.name}"]`);
    if(!el)continue;
    el.value=k.value;
    if(k.focus){el.focus();try{el.setSelectionRange(k.s,k.e)}catch(e){}}
  }
}
function agentLive(){return AGENT.available&&AGENT.connected&&!!AGENT.sid}
// Login unificado (Fase 7): si la persona inició sesión en la consola con su cuenta AUDIT-IA, se usa ese
// mismo token (auditsound.cc.token, lo guarda commandcenter.js); la llave pegada a mano es el respaldo.
const AGENT_CC_TOKEN_KEY='auditsound.cc.token';
const AGENT_OFF_KEY='as.agent.off';
function agentCcToken(){try{return localStorage.getItem(AGENT_CC_TOKEN_KEY)||''}catch(e){return ''}}
function agentGetToken(){try{return sessionStorage.getItem(AGENT_TOKEN_KEY)||agentCcToken()}catch(e){return ''}}
function agentManualOff(v){try{v?sessionStorage.setItem(AGENT_OFF_KEY,'1'):sessionStorage.removeItem(AGENT_OFF_KEY)}catch(e){}}
function agentIsOff(){try{return sessionStorage.getItem(AGENT_OFF_KEY)==='1'}catch(e){return false}}
function agentSetToken(t){try{t?sessionStorage.setItem(AGENT_TOKEN_KEY,t):sessionStorage.removeItem(AGENT_TOKEN_KEY)}catch(e){}}

async function agentFetch(path,{method='GET',body,idem=false}={}){
  const h={'Accept':'application/json','Authorization':'Bearer '+agentGetToken()};
  if(body!==undefined)h['Content-Type']='application/json';
  if(idem)h['Idempotency-Key']=uid('idem');
  let r;
  try{r=await fetch(AGENT_BASE+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)})}
  catch(e){throw Object.assign(Error('Sin conexión con el agente'),{code:'network'})}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok){const er=(j&&j.error)||{};throw Object.assign(Error(er.message||('El agente respondió HTTP '+r.status)),{status:r.status,code:er.code||'',details:er.details||{}})}
  return j;
}

const AGENT_REASON={hybrid_requires_approval:'en HÍBRIDO requiere aprobación',dangerous_action_requires_human:'acción crítica: decide una persona',
  outside_autonomy_level:'fuera del nivel de autonomía',skip_rate_limit:'límite de saltos por hora',mode_manual_observe_only:'modo MANUAL: el agente solo observa',
  automatic_within_autonomy:'automática dentro de la autonomía',hybrid_auto_allowed_by_policy:'automática por política'};
function agentProposalsToHistory(list){
  const st={PENDING:'pending',APPROVED:'approved',EXECUTED:'approved',REJECTED:'rejected',EXPIRED:'expired',FAILED:'rejected'};
  return list.map(p=>({id:'srv-'+p.id,srv:p.id,text:p.summary+(p.reason?' · '+(AGENT_REASON[p.reason]||p.reason):''),status:st[p.status]||String(p.status).toLowerCase()}));
}

async function agentSyncProposals(){
  if(!agentLive())return;
  try{const list=await agentFetch(`/sessions/${AGENT.sid}/proposals`);state.agentHistory=agentProposalsToHistory(list)}catch(e){}
}

async function agentSyncPrefs(){
  const p=await agentFetch(`/sessions/${AGENT.sid}/preferences`);
  state.agentAutonomy=p.autonomy;state.agentApproval=!!p.approval_required;
  state.agentModel=p.model_route==='rules'?'auto':p.model_route;
  state.agentRules={...state.agentRules,...(p.rules||{})};
}

function agentApplySession(s){
  AGENT.mode=s.mode;AGENT.engine=s.engine||AGENT.engine;
  if(AGENT_MODE_UI[s.mode])state.mode=AGENT_MODE_UI[s.mode];
  if(typeof s.last_sequence==='number')AGENT.lastSeq=Math.max(AGENT.lastSeq,s.last_sequence);
}

async function agentConnect(token){
  if(!AGENT.available){toast('Este servidor no tiene el agente DJ configurado: la consola sigue en modo demostración.',true);return}
  if(token)agentSetToken(token);
  agentManualOff(false);
  if(!agentGetToken()){toast('Ingresa el token de acceso del agente.',true);return}
  AGENT.connecting=true;AGENT.error='';agentRender();
  try{
    await agentFetch('/health');
    const sessions=await agentFetch('/sessions');
    let s=sessions.find(x=>!['STOPPED','FAILED'].includes(x.state));
    if(!s){
      try{s=await agentFetch('/sessions',{method:'POST',body:{name:'Consola v0.6',mode:AGENT_MODE[state.mode]||'HIBRIDO'}})}
      catch(e){if(e.code==='engine_busy'&&e.details&&e.details.session_id)s=await agentFetch('/sessions/'+e.details.session_id);else throw e}
    }
    AGENT.sid=s.id;AGENT.connected=true;agentApplySession(s);
    try{await agentSyncPrefs()}catch(e){/* rol sin permiso de preferencias: se muestran las locales */}
    await agentSyncProposals();await agentRefreshStatus();
    state.chat.push({who:'system',label:'Agente DJ',text:`Conectado al agente real (sesión ${s.name||s.id.slice(0,8)}). Modo ${s.mode}. Las órdenes ya se ejecutan en el servidor.`});
    agentOpenWs();
    toast('Agente DJ conectado.');
  }catch(e){
    AGENT.connected=false;AGENT.sid=null;AGENT.error=e.message;
    if(e.status===401||e.status===403){let manual=false;try{manual=!!sessionStorage.getItem(AGENT_TOKEN_KEY)}catch(x){}agentSetToken('');if(!manual&&agentCcToken())ccAgentRejected()}
    toast('No se pudo conectar al agente: '+e.message,true);
  }finally{AGENT.connecting=false;agentRender()}
}

function agentDisconnect(){
  AGENT.connected=false;AGENT.sid=null;AGENT.wsOk=false;clearTimeout(AGENT.timer);
  if(AGENT.ws){try{AGENT.ws.onclose=null;AGENT.ws.close()}catch(e){}AGENT.ws=null}
  agentSetToken('');agentManualOff(true);state.agentHistory=[];
  state.chat.push({who:'system',text:'Agente desconectado. La consola vuelve al modo demostración; el audio del servidor sigue con AutoMix.'});
  agentRender();toast('Agente desconectado.');
}

async function agentRefreshStatus(){
  if(!agentLive())return;
  try{AGENT.models=await agentFetch('/models/status')}catch(e){}
  try{AGENT.usage=await agentFetch('/usage')}catch(e){AGENT.usage=null}   // solo supervisor/admin
}

function agentOpenWs(){
  if(!agentLive())return;
  const url=(location.protocol==='https:'?'wss://':'ws://')+location.host+`${AGENT_BASE}/sessions/${AGENT.sid}/events`;
  let ws;try{ws=new WebSocket(url)}catch(e){return agentScheduleWs()}
  AGENT.ws=ws;
  ws.onopen=()=>{AGENT.lastMsg=Date.now();ws.send(JSON.stringify({type:'auth',token:agentGetToken(),after:AGENT.lastSeq}))};
  ws.onmessage=(m)=>{AGENT.lastMsg=Date.now();let ev;try{ev=JSON.parse(m.data)}catch(e){return}agentOnEvent(ev)};
  ws.onclose=(e)=>{AGENT.wsOk=false;if(e.code===4401||e.code===4403){toast('El agente rechazó el token de eventos.',true);return}agentScheduleWs();agentRender()};
}

function agentScheduleWs(){
  if(!agentLive())return;
  clearTimeout(AGENT.timer);
  const wait=Math.min(30000,1000*Math.pow(2,AGENT.retry++));
  AGENT.timer=setTimeout(agentOpenWs,wait);
}

function agentOnEvent(ev){
  if(typeof ev.sequence==='number')AGENT.lastSeq=Math.max(AGENT.lastSeq,ev.sequence);
  const p=ev.payload||{};
  switch(ev.type){
    case 'session.snapshot':AGENT.wsOk=true;AGENT.retry=0;agentApplySession(p);break;
    case 'mode.changed':if(p.to&&AGENT_MODE_UI[p.to]){AGENT.mode=p.to;state.mode=AGENT_MODE_UI[p.to]}break;
    case 'agent.proposal.created':case 'agent.proposal.decided':case 'agent.proposal.expired':
      agentSyncProposals().then(agentRender);return;
    case 'preferences.updated':agentSyncPrefs().then(agentRender).catch(()=>{});return;
    case 'plan.created':state.chat.push({who:'system',label:'Agente DJ',text:`Plan v${p.version} creado con ${p.items} pistas del catálogo.`});break;
    case 'agent.degraded':state.chat.push({who:'system',label:'Agente DJ',text:'El agente opera degradado: '+(p.reason||'motor no disponible')+'. El audio no depende del agente.'});break;
    case 'resync_required':case 'replay_truncated':agentFetch('/sessions/'+AGENT.sid).then(s=>{agentApplySession(s);agentRender()}).catch(()=>{});return;
    default:return;
  }
  agentRender();
}

// --- Acciones del panel cuando hay agente ---
async function agentSetMode(uiMode){
  try{const s=await agentFetch(`/sessions/${AGENT.sid}/mode`,{method:'POST',idem:true,body:{mode:AGENT_MODE[uiMode],reason:'consola v0.6'}});
    agentApplySession(s);toast('Modo '+s.mode+' aplicado en el servidor, sin reiniciar el audio.')}
  catch(e){state.mode=AGENT_MODE_UI[AGENT.mode]||state.mode;toast('El servidor no cambió el modo: '+e.message,true)}  // manda el servidor
  agentRender();
}

async function agentIntent(text,idx){
  try{const r=await agentFetch(`/sessions/${AGENT.sid}/intent`,{method:'POST',body:{text,channel:voiceChannelFor(text)}});
    const src={rules:'reglas',qwen:'Qwen',deepseek:'DeepSeek'}[r.source]||r.source;
    let msg=r.message||'';
    if(r.plan&&r.plan.items&&r.plan.items.length)msg+=` Plan: ${r.plan.items.length} pistas (${[...new Set(r.plan.items.map(i=>i.genre).filter(Boolean))].join(' → ')}).`;
    state.chat[idx]={who:'system',label:'Agente DJ · '+src,text:msg.trim()||'Orden recibida.'};
    if(r.mode&&AGENT_MODE_UI[r.mode]){AGENT.mode=r.mode;state.mode=AGENT_MODE_UI[r.mode]}
    if(r.proposal)await agentSyncProposals();
  }catch(e){state.chat[idx]={who:'system',label:'Agente DJ · error',text:'El agente no procesó la orden: '+e.message}}
  save();agentRender();
}

async function agentSetPolicy(payload){
  const b={};
  if('rule' in payload)b.rules={[payload.rule]:!!payload.enabled};
  if('autonomy' in payload)b.autonomy=Number(payload.autonomy);
  if('model' in payload)b.model_route=payload.model;
  if('approval' in payload)b.approval_required=!!payload.approval;
  try{await agentFetch(`/sessions/${AGENT.sid}/preferences`,{method:'PUT',body:b});toast('Política guardada en el servidor.')}
  catch(e){toast('El servidor rechazó el cambio: '+e.message,true);try{await agentSyncPrefs()}catch(x){}agentRender()}
}

async function agentDecide(id,status){
  const h=state.agentHistory.find(x=>x.id===id);
  if(!h||!h.srv)return;
  try{const r=await agentFetch(`/sessions/${AGENT.sid}/proposals/${h.srv}/decision`,{method:'POST',idem:true,body:{decision:status==='approved'?'approve':'reject'}});
    toast(status==='approved'?'Propuesta aprobada · estado '+((r.proposal&&r.proposal.status)||'')+'.':'Propuesta rechazada.')}
  catch(e){toast('No se registró la decisión: '+e.message,true)}
  await agentSyncProposals();agentRender();
}

async function agentTestProposal(){
  try{const r=await agentFetch(`/sessions/${AGENT.sid}/plans`,{method:'POST',idem:true,body:{count:4,energy_trend:'steady'}});
    toast(r.outcome==='proposal'?'Propuesta creada en el servidor: espera tu aprobación.':(r.message||'Plan procesado por el agente.'))}
  catch(e){toast('El agente no creó la propuesta: '+e.message,true)}
  await agentSyncProposals();agentRender();
}

// Escucha los comandos que ya emite la consola (contrato v0.6) y los lleva al agente real.
window.addEventListener('auditsound:command',(e)=>{
  const {name,payload}=e.detail||{};
  if(!agentLive())return;
  if(name==='agent.mode')agentSetMode(payload.mode);
  else if(name==='agent.policy')agentSetPolicy(payload);
  else if(name==='agent.approval')agentDecide(payload.id,payload.status);
});

// Estado visible en la pantalla del agente (sustituye las etiquetas fijas «DESCONECTADO»).
function agentStatusHtml(){
  const fixed=`<div>Modelo operativo <b>Qwen</b> ${tag('DESCONECTADO','pending')}</div><div>Razonamiento <b>DeepSeek</b> ${tag('DESCONECTADO','pending')}</div><div>Gateway y presupuesto ${tag('PENDIENTE','pending')}</div><div>Motor de mezcla <b>C++</b> ${tag('DESCONECTADO','pending')}</div><div>Tokens facturables <b>0</b> ${tag('SIN LLAMADAS','ok')}</div>`;
  if(!AGENT.available)return `<div class="statuslist">${fixed}<div>Agente DJ ${tag('NO CONFIGURADO EN ESTE SERVIDOR','demo')}</div></div>`;
  if(!agentLive())return `<div class="statuslist">${fixed}</div>${agentCcToken()?`<div class="pillbar spaced">${button(AGENT.connecting?'Conectando…':'Conectar con mi sesión AUDIT-IA','agent-connect-cc',{},'primary')}</div><p class="muted">O usa una llave de acceso del administrador:</p>`:''}<form data-form="agent-link" class="spaced"><label class="field">Token de acceso al agente<input name="token" type="password" autocomplete="off" required placeholder="Lo entrega el administrador"></label><div class="pillbar"><button type="submit" class="primary" ${AGENT.connecting?'disabled':''}>${AGENT.connecting?'Conectando…':'Conectar agente'}</button></div>${AGENT.error?`<p class="muted">${esc(AGENT.error)}</p>`:''}</form>`;
  const m=n=>AGENT.models.find(x=>x.name===n);
  const mt=n=>{const x=m(n);return !x||!x.configured?tag('SIN CONFIGURAR','pending'):x.breaker==='open'?tag('EN PAUSA (FALLOS)','pending'):tag('CONECTADO'+(x.model?' · '+x.model:''),'ok')};
  const eng=AGENT.engine&&AGENT.engine.reachable;
  const u=AGENT.usage;
  return `<div class="statuslist"><div>Agente DJ ${tag('CONECTADO · '+(AGENT.mode||''),'ok')} ${AGENT.wsOk?tag('EVENTOS EN VIVO','ok'):tag('RECONECTANDO EVENTOS','pending')}</div><div>Modelo operativo <b>Qwen</b> ${mt('qwen')}</div><div>Razonamiento <b>DeepSeek</b> ${mt('deepseek')}</div><div>Motor de mezcla <b>C++</b> ${eng?tag('ALCANZABLE','ok'):tag('NO ALCANZABLE','pending')}</div><div>Consumo IA 24 h <b>${u?('US$ '+Number(u.cost_estimated_usd_24h).toFixed(4)):'—'}</b> ${u?tag('ESTIMACIÓN','demo'):tag('SOLO SUPERVISOR','demo')}</div></div><div class="pillbar spaced">${button('Actualizar estado','agent-refresh')}${button('Desconectar agente','agent-disconnect',{},'danger')}</div>`;
}

// Arranque: si el servidor anuncia el agente y la pestaña ya tiene token, se reconecta sola.
if(AGENT.available&&agentGetToken()&&!agentIsOff())setTimeout(()=>agentConnect(),0);
// (el cierre del módulo y el primer render están al final de 06-voice-mobile.js)
