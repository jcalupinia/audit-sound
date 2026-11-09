// ===== 07d · Efectos de audio reales (motor del stream) =====
// Los dos bancos FX controlan los efectos del MOTOR (engine/fx/fx_rack.hpp) a través del agente
// (comando «fx», solo operador/admin con control de la sesión). Lo que se oye en el stream cambia de
// verdad. Sin agente conectado, los bancos solo guardan la configuración (se avisa en pantalla).
const FX_TYPES=[['Echo','echo','Eco'],['Delay','delay','Delay ping-pong'],['Reverb','reverb','Reverb'],['Filter','filter','Filtro DJ'],
  ['Flanger','flanger','Flanger'],['Phaser','phaser','Phaser'],['Bitcrusher','crush','Bitcrusher']];
const FX_ENGINE=Object.fromEntries(FX_TYPES.map(([ui,en])=>[ui,en]));
const FX_TARGETS=[['A','A','Deck A'],['B','B','Deck B'],['Master','master','Salida general']];
const FX_TARGET=Object.fromEntries(FX_TARGETS.map(([ui,en])=>[ui,en]));
const FX_PARAM_LABEL={Echo:'Tiempo',Delay:'Tiempo',Reverb:'Tamaño de sala',Filter:'Frecuencia (← graves · agudos →)',
  Flanger:'Velocidad',Phaser:'Velocidad',Bitcrusher:'Intensidad'};
const FX_SYNC_BEATS=['1/4','1/2','3/4','1','1 ½','2'];
const FXS={sent:{},error:{},timer:{}};
// Normaliza configuraciones guardadas con opciones que el motor no tiene (Custom, MIC, Video).
for(const f of state.fx){if(!FX_ENGINE[f.type])f.type='Echo';if(!FX_TARGET[f.channel])f.channel='Master'}

function fxParamText(f){
  const p=f.parameter/100;
  if((f.type==='Echo'||f.type==='Delay')&&f.bpmSync)return FX_SYNC_BEATS[Math.min(5,Math.floor(p*6))]+' pulso';
  if(f.type==='Echo'||f.type==='Delay')return Math.round(60+940*p)+' ms';
  if(f.type==='Filter')return p<0.48?'pasa-bajos':p>0.52?'pasa-altos':'neutro';
  return f.parameter+' %';
}

async function fxSend(f){
  if(!agentLive()){FXS.sent[f.id]=false;fxPaint(f);return}
  try{
    await agentFetch(`/sessions/${AGENT.sid}/commands`,{method:'POST',idem:true,body:{action:'fx',params:{bank:f.id,
      type:FX_ENGINE[f.type],target:FX_TARGET[f.channel],on:!!f.on,wet:Math.max(0,Math.min(1,f.wet/100)),
      param:Math.max(0,Math.min(1,f.parameter/100)),sync:!!f.bpmSync}}});
    FXS.sent[f.id]=true;FXS.error[f.id]='';
  }catch(e){
    FXS.sent[f.id]=false;
    FXS.error[f.id]=e.code==='capability_unavailable'?'el motor de este servidor aún no tiene efectos (falta desplegar)':
      e.status===403?'tu rol no permite cambiar efectos':e.message||'no se pudo aplicar';
  }
  fxPaint(f);
}
// Los deslizadores envían como máximo cada 150 ms (el último valor siempre llega).
function fxChanged(f,now){clearTimeout(FXS.timer[f.id]);if(now)return fxSend(f);FXS.timer[f.id]=setTimeout(()=>fxSend(f),150)}

function fxStatusHtml(f){
  if(!agentLive())return tag('SIN AGENTE · NO SUENA','demo');
  if(FXS.error[f.id])return `${tag('NO APLICADO','bad')} <small class="red">${esc(FXS.error[f.id])}</small>`;
  if(FXS.sent[f.id])return tag(f.on?'SONANDO EN EL STREAM':'APAGADO EN EL STREAM',f.on?'ok':'pending');
  return tag('SIN ENVIAR','pending');
}
function fxPaint(f){
  const el=document.getElementById('fx-status-'+f.id);if(el)el.innerHTML=fxStatusHtml(f);
  const pv=document.getElementById('fx-param-'+f.id);if(pv)pv.textContent=fxParamText(f);
}

effectsPage=function(){
  return `${pageTitle('Efectos FX','Dos bancos de efectos que suenan en el stream: eco, delay, reverb, filtro, flanger, phaser y bitcrusher.','',agentLive())}
  ${agentLive()?'':'<div class="callout">Conecta el <strong>Agente DJ</strong> para que los efectos suenen en el stream. Sin agente, los bancos solo guardan la configuración.</div>'}
  <div class="grid2 spaced">${state.fx.map(f=>`<section class="panel"><div class="panel-head"><h2>◈ BANCO FX${f.id}</h2>${button(f.on?'ENCENDIDO':'APAGADO','fx-toggle',{id:f.id},f.on?'active':'')}</div>
    <div id="fx-status-${f.id}" class="spaced">${fxStatusHtml(f)}</div>
    <div class="stack-sm spaced">
      <label class="field">Efecto${sel('type',FX_TYPES.map(([ui,,label])=>[ui,label]),f.type,`data-change="fx-type" data-id="${f.id}"`)}</label>
      <label class="field">Aplicar a${sel('channel',FX_TARGETS.map(([ui,,label])=>[ui,label]),f.channel,`data-change="fx-channel" data-id="${f.id}"`)}</label>
      ${slider('wet','Mezcla (seco / efecto)',f.wet,0,100,`data-change="fx-wet" data-id="${f.id}"`)}
      ${slider('parameter',FX_PARAM_LABEL[f.type]||'Parámetro',f.parameter,0,100,`data-change="fx-param" data-id="${f.id}"`)}
      <small class="muted">Valor: <b id="fx-param-${f.id}">${fxParamText(f)}</b></small>
      ${['Echo','Delay','Flanger','Phaser'].includes(f.type)?`<label class="toggle"><input type="checkbox" data-change="fx-sync" data-id="${f.id}" ${f.bpmSync?'checked':''}>Sincronizar al BPM del deck</label>`:''}
      ${button('Guardar preset','fx-save-preset',{id:f.id})}
    </div></section>`).join('')}</div>
  <section class="panel spaced"><h2>Presets</h2>${state.fxPresets.map(p=>`<div class="listrow"><div><strong>${esc(p.name)}</strong><small>FX${p.bank} · ${esc((FX_TYPES.find(t=>t[0]===p.type)||[,,p.type])[2])} · ${p.wet}%</small></div><div class="actions">${button('Aplicar','fx-apply-preset',{id:p.id})}${button('×','fx-remove-preset',{id:p.id},'danger')}</div></div>`).join('')||'<div class="empty">Todavía no hay presets.</div>'}</section>`;
};

// Al conectar el agente, se envía la configuración actual de los bancos encendidos.
let FX_LIVE_PREV=false;
setInterval(()=>{const live=agentLive();if(live&&!FX_LIVE_PREV)for(const f of state.fx)if(f.on)fxSend(f);FX_LIVE_PREV=live},1000);

window.__ASFX={state:()=>state.fx.map(f=>({id:f.id,type:f.type,channel:f.channel,on:f.on,wet:f.wet,parameter:f.parameter,sync:f.bpmSync,
  sent:!!FXS.sent[f.id],error:FXS.error[f.id]||''}))};
