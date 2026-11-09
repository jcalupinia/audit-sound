// ===== 07b · Micrófonos reales y talkover =====
// Hasta ahora los canales de micrófono eran solo controles. Aquí se conectan de verdad:
//  - cada canal habilitado abre su micrófono (getUserMedia) con su ganancia, EQ (graves/agudos) y MUTE;
//  - medidor de nivel en vivo; «Escuchar en la sala» envía la voz a la salida de este equipo (apagado
//    por defecto para evitar acople/feedback);
//  - talkover: Automático (la música baja al hablar), Siempre o Apagado. En este equipo atenúa la música
//    del navegador; en el stream lo aplica el motor del servidor;
//  - «Enviar al stream»: la voz viaja por el agente (/sessions/{id}/voice, solo operador/admin) al motor,
//    que la mezcla con la música antes de Icecast. La música nunca depende de la voz: si se corta, sigue.
const MIC={ctx:null,bus:null,analyser:null,monitor:null,duck:null,ch:{},ws:null,wsOpen:false,node:null,
  pend:[],pendLen:0,level:-120,hold:0,stats:null,error:'',raf:0,sending:false,ducked:false};
const MIC_TALK={auto:2,on:1,off:0};
const MIC_TALK_LABEL={auto:'Automático (baja al hablar)',on:'Siempre (música atenuada)',off:'Apagado'};
// Migración del estado anterior (talkover booleano).
if(typeof state.talkover==='boolean')state.talkover=state.talkover?'on':'auto';
if(!state.talkover)state.talkover='auto';
if(state.micMonitor===undefined)state.micMonitor=false;
if(state.micToStream===undefined)state.micToStream=false;
if(state.micProcessing===undefined)state.micProcessing=true;   // cancelación de eco y supresión de ruido
for(const m of state.mics){if(m.device===undefined)m.device='';m.enabled=false}  // el permiso no persiste entre recargas

function micCtx(){
  if(MIC.ctx)return MIC.ctx;
  const g=initAudio();             // mismo AudioContext que la música del navegador (para el talkover local)
  const ctx=g.ctx;
  MIC.ctx=ctx;
  MIC.bus=ctx.createGain();
  MIC.analyser=ctx.createAnalyser();MIC.analyser.fftSize=1024;
  MIC.monitor=ctx.createGain();MIC.monitor.gain.value=state.micMonitor?1:0;
  MIC.bus.connect(MIC.analyser);MIC.bus.connect(MIC.monitor);MIC.monitor.connect(ctx.destination);
  // Talkover local: la música del navegador pasa por un nodo de atenuación antes de la salida.
  MIC.duck=ctx.createGain();
  try{g.master.disconnect()}catch(e){}
  g.master.connect(MIC.duck);MIC.duck.connect(ctx.destination);
  micLoop();
  return ctx;
}

function micApply(m){
  const c=MIC.ch[m.id];if(!c)return;
  const t=MIC.ctx.currentTime;
  c.gain.gain.setTargetAtTime((m.gain/100)*1.5,t,0.02);   // 0..150 %
  c.low.gain.setTargetAtTime(m.low,t,0.02);
  c.hi.gain.setTargetAtTime(m.hi,t,0.02);
  c.mute.gain.setTargetAtTime(m.mute?0:1,t,0.01);
}

async function micOpen(m){
  if(!navigator.mediaDevices?.getUserMedia)throw Error('El micrófono necesita HTTPS (o localhost) y permiso del navegador.');
  const ctx=micCtx();
  if(ctx.state==='suspended')try{await ctx.resume()}catch(e){}
  const stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:m.device?{exact:m.device}:undefined,
    echoCancellation:state.micProcessing,noiseSuppression:state.micProcessing,autoGainControl:false}});
  const src=ctx.createMediaStreamSource(stream);
  const low=ctx.createBiquadFilter();low.type='lowshelf';low.frequency.value=180;
  const hi=ctx.createBiquadFilter();hi.type='highshelf';hi.frequency.value=5000;
  const gain=ctx.createGain(),mute=ctx.createGain();
  src.connect(low);low.connect(hi);hi.connect(gain);gain.connect(mute);mute.connect(MIC.bus);
  MIC.ch[m.id]={stream,src,low,hi,gain,mute,label:stream.getAudioTracks()[0]?.label||''};
  micApply(m);
}

function micClose(id){
  const c=MIC.ch[id];if(!c)return;
  try{c.mute.disconnect()}catch(e){}
  c.stream.getTracks().forEach(t=>t.stop());
  delete MIC.ch[id];
}

function micAnyOpen(){return Object.keys(MIC.ch).length>0}

// Nivel, talkover local y medidores, sin redibujar la página.
function micLoop(){
  const buf=new Float32Array(1024);
  const tick=()=>{
    MIC.raf=requestAnimationFrame(tick);
    if(!MIC.analyser)return;
    MIC.analyser.getFloatTimeDomainData(buf);
    let s=0;for(let i=0;i<buf.length;i++)s+=buf[i]*buf[i];
    const rms=Math.sqrt(s/buf.length),db=rms>1e-6?20*Math.log10(rms):-120;
    MIC.level=db;
    const now=performance.now();
    if(db>-42)MIC.hold=now+600;
    const duck=micAnyOpen()&&(state.talkover==='on'||(state.talkover==='auto'&&now<MIC.hold));
    if(duck!==MIC.ducked&&MIC.duck){
      MIC.ducked=duck;
      MIC.duck.gain.setTargetAtTime(duck?0.2:1,MIC.ctx.currentTime,duck?0.03:0.12);   // −14 dB
    }
    const pct=Math.max(0,Math.min(100,(db+60)/60*100));
    document.querySelectorAll('[data-mic-vu]').forEach(el=>{el.style.width=pct.toFixed(0)+'%';el.dataset.db=db.toFixed(1)});
    document.querySelectorAll('[data-mic-duck]').forEach(el=>{el.textContent=MIC.ducked?'MÚSICA ATENUADA':'música a volumen normal'});
  };
  tick();
}

// ---------- envío al stream (por el agente) ----------
const MIC_WORKLET=`class AsMicTap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('as-mic-tap',AsMicTap)`;

async function micTap(){
  if(MIC.node)return;
  const ctx=micCtx();
  const onBlock=(f32)=>{
    if(!MIC.wsOpen)return;
    MIC.pend.push(f32);MIC.pendLen+=f32.length;
    if(MIC.pendLen<ctx.sampleRate/10)return;   // bloques de ~100 ms
    const out=new Int16Array(MIC.pendLen);let o=0;
    for(const b of MIC.pend)for(let i=0;i<b.length;i++){const v=Math.max(-1,Math.min(1,b[i]));out[o++]=v<0?v*32768:v*32767}
    MIC.pend=[];MIC.pendLen=0;
    if(MIC.ws&&MIC.ws.readyState===1&&MIC.ws.bufferedAmount<512*1024)MIC.ws.send(out.buffer);
  };
  if(ctx.audioWorklet){
    const url=URL.createObjectURL(new Blob([MIC_WORKLET],{type:'application/javascript'}));
    try{await ctx.audioWorklet.addModule(url)}finally{URL.revokeObjectURL(url)}
    const n=new AudioWorkletNode(ctx,'as-mic-tap',{numberOfInputs:1,numberOfOutputs:0,channelCount:1,channelCountMode:'explicit'});
    n.port.onmessage=(e)=>onBlock(e.data);
    MIC.bus.connect(n);MIC.node=n;
  }else{
    const n=ctx.createScriptProcessor(2048,1,1);
    n.onaudioprocess=(e)=>onBlock(e.inputBuffer.getChannelData(0).slice(0));
    const sink=ctx.createGain();sink.gain.value=0;n.connect(sink);sink.connect(ctx.destination);
    MIC.bus.connect(n);MIC.node=n;
  }
}

function micSendTalkover(){
  if(MIC.ws&&MIC.ws.readyState===1)MIC.ws.send(JSON.stringify({type:'talkover',mode:MIC_TALK[state.talkover]??2}));
}

async function micStreamStart(){
  if(!agentLive())throw Error('Conecta primero el Agente DJ: la voz viaja al stream a través del agente.');
  if(!micAnyOpen())throw Error('Habilita al menos un micrófono antes de enviarlo al stream.');
  await micTap();
  micStreamStop(true);
  const url=(location.protocol==='https:'?'wss://':'ws://')+location.host+`${AGENT_BASE}/sessions/${AGENT.sid}/voice`;
  const ws=new WebSocket(url);ws.binaryType='arraybuffer';
  MIC.ws=ws;MIC.sending=true;MIC.error='';MIC.stats=null;
  ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token:agentGetToken(),sample_rate:Math.round(MIC.ctx.sampleRate)}));
  ws.onmessage=(m)=>{let ev;try{ev=JSON.parse(m.data)}catch(e){return}
    if(ev.type==='voice.ready'){MIC.wsOpen=true;micSendTalkover();toast('Micrófono al aire: tu voz se mezcla en el stream.');micPaint()}
    else if(ev.type==='voice.stats'){MIC.stats=ev;MIC.error=ev.error||'';micPaint()}
    else if(ev.type==='voice.error'){MIC.error=ev.code;micPaint()}};
  ws.onclose=(e)=>{MIC.wsOpen=false;const was=MIC.sending;MIC.sending=false;MIC.ws=null;
    const why={4401:'el agente no reconoció tu sesión',4403:'tu rol no permite hablar al stream (pide rol operador)',
      4404:'la sesión del agente cambió; vuelve a conectar',4409:'este motor no admite micrófonos en vivo'}[e.code];
    if(was&&why){MIC.error=why;toast('Micrófono fuera del stream: '+why+'.',true)}
    state.micToStream=false;save();micPaint()};
}

function micStreamStop(silent){
  const ws=MIC.ws;MIC.ws=null;MIC.wsOpen=false;MIC.sending=false;MIC.pend=[];MIC.pendLen=0;
  if(ws)try{ws.close(1000)}catch(e){}
  if(!silent)toast('Micrófono fuera del stream.');
}

// Repinta solo la tarjeta de estado del micrófono (no toda la página) para no perder el foco.
function micPaint(){
  const el=document.getElementById('mic-status');
  if(el)el.innerHTML=micStatusHtml();
  else if(state.page==='microfonos')render();
}

function micStatusHtml(){
  const sending=MIC.sending&&MIC.wsOpen;
  const st=MIC.stats;
  const parts=[];
  parts.push(sending?tag('AL AIRE EN EL STREAM','ok'):tag(agentLive()?'SOLO EN ESTE EQUIPO':'AGENTE NO CONECTADO',agentLive()?'pending':'demo'));
  if(sending&&st)parts.push(`<small>${st.sent_s.toFixed(1)} s enviados · búfer del motor ${st.engine_buffer_ms} ms${st.dropped_s?` · ${st.dropped_s} s descartados por retraso`:''}</small>`);
  if(MIC.error)parts.push(`<small class="red">Aviso: ${esc(MIC.error)}</small>`);
  return parts.join(' ');
}

// ---------- acciones (las llama el despachador de 03/04) ----------
async function micAction(action,id,value){
  const m=id!=null?state.mics.find(x=>x.id===Number(id)):null;
  switch(action){
    case 'mic-enable':{
      if(!m)return;
      if(m.enabled){micClose(m.id);m.enabled=false;if(!micAnyOpen()&&MIC.sending)micStreamStop()}
      else{try{await micOpen(m);m.enabled=true;m.mute=false;micApply(m)}catch(e){toast(micErr(e),true)}}
      command('mic.channel',{id:m.id,enabled:m.enabled},'LOCAL');save();render();break}
    case 'mic-mute':{if(!m)return;m.mute=!m.mute;micApply(m);command('mic.channel',{id:m.id,mute:m.mute},'LOCAL');save();render();break}
    case 'mic-param':{if(!m)return;m[value.field]=value.n;micApply(m);save();break}
    case 'mic-device':{if(!m)return;m.device=value||'';if(m.enabled){micClose(m.id);try{await micOpen(m)}catch(e){m.enabled=false;toast(micErr(e),true)}}save();render();break}
    case 'talkover':{const order=['auto','on','off'];state.talkover=value&&MIC_TALK[value]!==undefined?value:order[(order.indexOf(state.talkover)+1)%3];
      micSendTalkover();command('mic.talkover',{mode:state.talkover},'LOCAL');save();render();break}
    case 'mic-monitor':{state.micMonitor=!state.micMonitor;if(MIC.monitor)MIC.monitor.gain.setTargetAtTime(state.micMonitor?1:0,MIC.ctx.currentTime,0.02);
      if(state.micMonitor)toast('Escucha en la sala activada: si hay parlantes cerca del micrófono puede acoplarse (pitido).');save();render();break}
    case 'mic-stream':{
      if(MIC.sending){micStreamStop();state.micToStream=false}
      else{try{await micStreamStart();state.micToStream=true}catch(e){toast(e.message,true)}}
      save();render();break}
    case 'mic-processing':{state.micProcessing=!state.micProcessing;
      for(const x of state.mics)if(x.enabled){micClose(x.id);try{await micOpen(x)}catch(e){x.enabled=false;toast(micErr(e),true)}}
      save();render();break}
    case 'mic-permission':case 'devices-list':{await micListDevices(action==='mic-permission');break}
  }
}

function micErr(e){
  const n=e&&e.name;
  if(n==='NotAllowedError')return 'El navegador bloqueó el micrófono: permite el acceso en el candado de la barra de direcciones.';
  if(n==='NotFoundError'||n==='OverconstrainedError')return 'No se encontró ese micrófono. Conéctalo o elige otro.';
  if(n==='NotReadableError')return 'Otro programa está usando el micrófono.';
  return e&&e.message||'No se pudo abrir el micrófono.';
}

let MIC_DEVICES=[];
async function micListDevices(ask){
  if(!navigator.mediaDevices?.enumerateDevices){toast('Este navegador no permite listar micrófonos (necesita HTTPS).',true);return}
  if(ask){try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop())}catch(e){toast(micErr(e),true);return}}
  MIC_DEVICES=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput');
  toast(MIC_DEVICES.length?`${MIC_DEVICES.length} micrófono(s) detectado(s).`:'No hay micrófonos conectados.');
  render();
}

// ---------- pantalla ----------
microphonesPage=function(){
  const devs=[['','Micrófono predeterminado'],...MIC_DEVICES.map((d,i)=>[d.deviceId,d.label||('Micrófono '+(i+1))])];
  const live=agentLive();
  return `${pageTitle('Micrófonos y talkover','Tu voz entra a la mezcla: en este equipo y, si quieres, en el stream en vivo.')}
  <section class="panel"><div class="panel-head"><h2>Nivel de voz</h2><span data-mic-duck class="micro muted">música a volumen normal</span></div>
    <div class="micvu"><div class="micvu-bar" data-mic-vu style="width:0%"></div></div>
    <div class="pillbar spaced">
      ${button(MIC.sending?'⏹ Quitar del stream':'📡 Enviar al stream','mic-stream',{},MIC.sending?'active':'primary')}
      ${button(state.micMonitor?'🔊 Escuchar en la sala: SÍ':'🔈 Escuchar en la sala: NO','mic-monitor',{},state.micMonitor?'active':'')}
      ${button(state.micProcessing?'Procesamiento de voz: SÍ':'Procesamiento de voz: NO','mic-processing',{},state.micProcessing?'active':'')}
      <label class="field compact">Talkover${sel('talkover',Object.entries(MIC_TALK_LABEL),state.talkover,'data-change="talkover-mode"')}</label>
    </div>
    <div id="mic-status" class="spaced">${micStatusHtml()}</div>
    ${live?'':'<div class="callout spaced">Para que tu voz salga en el stream conecta primero el <strong>Agente DJ</strong> (con tu sesión AUDIT-IA). Sin agente, el micrófono funciona solo en este equipo.</div>'}
  </section>
  <div class="grid2 spaced">${state.mics.map(m=>`<section class="panel"><div class="panel-head"><h2>🎙 ${esc(m.name)}</h2>${tag(m.enabled?(m.mute?'ABIERTO · MUTE':'ABIERTO'):'CERRADO',m.enabled&&!m.mute?'ok':'pending')}</div>
    <div class="stack-sm">
      <label class="field">Entrada${sel('device',devs,m.device,`data-change="mic-device" data-id="${m.id}"`)}</label>
      ${slider('gain','Ganancia',m.gain,0,100,`data-change="mic-gain" data-id="${m.id}"`)}
      ${slider('hi','Agudos (dB)',m.hi,-12,12,`data-change="mic-hi" data-id="${m.id}"`)}
      ${slider('low','Graves (dB)',m.low,-12,12,`data-change="mic-low" data-id="${m.id}"`)}
      <div class="pillbar">${button(m.enabled?'Cerrar micrófono':'Abrir micrófono','mic-enable',{id:m.id},m.enabled?'active':'primary')}${button(m.mute?'MUTE ACTIVO':'MUTE OFF','mic-mute',{id:m.id},m.mute?'':'active')}</div>
      ${MIC.ch[m.id]?.label?`<small class="muted">${esc(MIC.ch[m.id].label)}</small>`:''}
    </div></section>`).join('')}</div>
  <section class="panel spaced"><h2>Dispositivos</h2><div class="pillbar">${button('Detectar micrófonos','mic-permission',{},'primary')}</div>
    <p class="muted spaced">El navegador pide permiso la primera vez. «Procesamiento de voz» aplica cancelación de eco y supresión de ruido; apágalo si tu micrófono ya pasa por una mezcladora. «Escuchar en la sala» queda apagado por defecto para evitar acoples con los parlantes.</p></section>`;
};

window.__ASMIC={state:()=>({open:Object.keys(MIC.ch).map(Number),level:MIC.level,ducked:MIC.ducked,sending:MIC.sending,wsOpen:MIC.wsOpen,stats:MIC.stats,error:MIC.error,talkover:state.talkover})};
