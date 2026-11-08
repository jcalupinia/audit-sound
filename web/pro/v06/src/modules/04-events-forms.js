function changeControl(el){const d=el.dataset,k=d.change;if(!k)return;let n=Number(el.value);try{switch(k){
 case 'deck-rate':state.deck[d.deck].rate=n;applyAudio();command('transport.pitch',{deck:d.deck,rate:n});break;
 case 'deck-loop':state.deck[d.deck].loop=n;if(LIVE.on&&LIVE.bridge)LIVE.bridge.loop(DECK_IDX[d.deck],n>0,n||4);command('transport.loop',{deck:d.deck,beats:n});break;
 case 'eq':{let key=d.field||el.name;state.deck[d.deck].eq[key]=n;applyAudio();command('mixer.control',{channel:d.deck,key,value:n});break}
 case 'audio-cross':state.audioCross=n;applyAudio();command('mixer.crossfade',{position:n},'LOCAL');break;
 case 'master':state.master=n;applyAudio();command('mixer.master',{volume:n},'LOCAL');break;
 case 'video-cross':state.videoMix=n;command('video.crossfade',{position:n},'LOCAL');break;
 case 'video-transition':state.videoTrans=el.value;command('video.transition',{type:el.value});break;
 case 'video-seek':{let v=vjVideo(d.deck);if(v?.duration)v.currentTime=(n/100)*v.duration;state.video[d.deck].seek=n;command('video.transport',{deck:d.deck,op:'seek',percentage:n},'LOCAL');break}
 case 'video-output':command('video.output',{output:el.value});if(el.value!=='local')toast(el.value==='screen-2'?'La salida a una segunda pantalla llega en la fase V2. Por ahora usa «Pantalla completa».':'La transmisión del video por internet llega en la fase V5.');break;
 case 'visual-fx':state.videoFx=el.value;command('video.transition',{fx:el.value,amount:state.videoFxAmount});break;
 case 'video-fx-amount':state.videoFxAmount=n;command('video.transition',{fx:state.videoFx,amount:n});break;
 case 'video-logo':state.videoLogo=el.value;command('video.transition',{logo:el.value||null});break;
 case 'video-pick':if(el.value)loadToDeck(el.value,d.deck);return;
 case 'caption':state.videoCaption=el.value.slice(0,80);command('video.transition',{caption:state.videoCaption});break;
 case 'library-kind':state.libraryKind=el.value;break;
 case 'rule':state.agentRules[d.rule]=el.checked;command('agent.policy',{rule:d.rule,enabled:el.checked});break;
 case 'autonomy':state.agentAutonomy=n;command('agent.policy',{autonomy:n});break;
 case 'agent-model':state.agentModel=el.value;command('agent.policy',{model:el.value});break;
 case 'agent-approval':state.agentApproval=el.value==='true';command('agent.policy',{approval:state.agentApproval});break;
 case 'mic-gain':case 'mic-hi':case 'mic-low':{let m=state.mics.find(m=>m.id===Number(d.id));if(m)m[k.split('-')[1]]=n;command('mic.channel',{id:d.id,field:k.split('-')[1],value:n});break}
 case 'fx-type':case 'fx-channel':case 'fx-wet':case 'fx-param':case 'fx-sync':{let f=state.fx.find(f=>f.id===Number(d.id));if(!f)return;let key=({ 'fx-type':'type','fx-channel':'channel','fx-wet':'wet','fx-param':'parameter','fx-sync':'bpmSync'})[k];f[key]=key==='bpmSync'?el.checked:['wet','parameter'].includes(key)?n:el.value;command('fx.control',{bank:d.id,field:key,value:f[key]});break}
 case 'permission':updateRole(d.role,d.permission,el.checked);break;
 default:console.warn('UNHANDLED_CHANGE',k)
 }save();render()}catch(e){toast(e.message,true)}}
function onSubmit(form){const type=form.dataset.form;const o=Object.fromEntries(new FormData(form));try{switch(type){
 case 'websearch':webSearch(String(o.q||''));return;
 case 'agent-link':{const tok=String(o.token||'').trim();if(tok.length<8||tok.length>4096)throw Error('Token de agente no válido');form.reset();agentConnect(tok);return}
 case 'agent':{const text=String(o.message||'').trim();if(text.length<2||text.length>1500)throw Error('La instrucción debe tener entre 2 y 1500 caracteres');addChat(text);return}
 case 'segment':{if(String(o.end)<=String(o.start))throw Error('La hora final debe ser posterior a la inicial');let energy=Number(o.energy);if(!Number.isFinite(energy)||energy<0||energy>100)throw Error('Energía fuera de rango');state.segments.push({id:uid('segment'),start:o.start,end:o.end,genre:String(o.genre).slice(0,60),energy});command('agent.plan',{op:'append-segment',start:o.start,end:o.end});break}
 case 'event':state.events.push({id:uid('event'),name:String(o.name).slice(0,100),date:o.date,venue:String(o.venue).slice(0,100),start:o.start});command('event.cue',{op:'create-event',name:o.name});break;
 case 'cue':state.cuesheets.push({id:uid('cue'),time:o.time,name:String(o.name).slice(0,100),kind:o.kind});command('event.cue',{op:'create-cue'});break;
 case 'fx-generator':{let name=String(o.name||'').trim();if(!/^[A-Za-z][A-Za-z0-9_]{2,35}$/.test(name))throw Error('Nombre: 3–36 caracteres alfanuméricos');state.fxCustom.push({id:uid('fxcode'),name,type:o.type});toast('Plantilla creada. Descárgala para desarrollar el algoritmo DSP.');break}
 case 'stream':{let url=safeUrl(o.streamUrl);if(!url)throw Error('La URL debe comenzar por https:// o http://');state.streamUrl=url;state.streamConnected=false;command('stream.configure',{url,mode:'local-player'});break}
 case 'config':{let url=String(o.apiUrl||'').trim();if(url&&!safeUrl(url))throw Error('Endpoint HTTP(S) no válido');state.settings.apiUrl=url;state.settings.language=o.language||'es';state.settings.audioDevice=o.audioDevice||'default';state.settings.telemetry=!!o.telemetry;state.apiStatus='Sin comprobar';command('system.health',{op:'update-endpoint',configured:!!url},'LOCAL');break}
 case 'organization':state.organization=String(o.organization||'').trim().slice(0,120);if(!state.organization)throw Error('Introduce una organización');command('iam.users',{op:'organization-update'});break;
 case 'user':{let email=String(o.email||'').trim().toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw Error('Correo no válido');if(state.users.some(u=>u.email===email))throw Error('Ya existe ese correo');state.users.push({id:uid('user'),name:String(o.name).trim().slice(0,80),email,role:o.role,enabled:true});command('iam.users',{op:'create-demo-user',email});break}
 case 'plan':{let amount=Number(o.price),seats=Number(o.seats);if(!Number.isFinite(amount)||amount<0||!Number.isInteger(seats)||seats<1)throw Error('Importe o usuarios no válidos');state.plans.push({id:uid('plan'),name:String(o.name).slice(0,60),price:amount,seats,limits:String(o.limits).slice(0,150),features:[],active:true});command('saas.plans',{op:'create-plan-demo'});break}
 case 'invoice':{let amount=Number(o.amount);if(!Number.isFinite(amount)||amount<0)throw Error('Monto inválido');state.invoiceDrafts.push({id:uid('invoice'),customer:String(o.customer).slice(0,120),plan:o.plan,amount,created:new Date().toISOString().slice(0,10),status:'BORRADOR'});command('saas.invoices',{op:'create-draft',amount});break}
 default:console.warn('UNHANDLED_FORM',type);return
 }save();render();toast('Registro guardado localmente (DEMO).')}catch(e){toast(e.message,true)}}
function handleMediaUpload(input){const key=input.dataset.file,files=[...input.files];if(!files.length)return;try{let loaded=files.map(addTrackFromFile);if(key==='audio-A'||key==='audio-B')loadToDeck(loaded[0].id,key.slice(-1));else if(key==='video-A'||key==='video-B')loadToDeck(loaded[0].id,key.slice(-1));else{render();toast(loaded.length+' archivo(s) añadidos a la biblioteca local.')}}catch(e){toast(e.message,true)}}
root.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b){e.preventDefault();act(b.dataset)}});
root.addEventListener('submit',e=>{e.preventDefault();let f=e.target;if(f.id==='login-form'){if(!f.reportValidity())return;state.logged=true;state.page='inicio';command('auth.login',{mode:'demo-guest'},'MOCK');render();hydrateLibrary();toast('Sesión de demostración iniciada.');return}if(f.dataset.form)onSubmit(f)});
root.addEventListener('change',e=>{let el=e.target;if(el.matches('input[type=file][data-file]')){handleMediaUpload(el);return}if(el.dataset.change){changeControl(el);return}if(el.dataset.filter==='library-query'){state.libraryQuery=el.value;render()}if(el.dataset.filter==='users-query'){state.usersQuery=el.value;render()}});
root.addEventListener('input',e=>{const el=e.target;if(el.type==='range'){let output=el.closest('label')?.querySelector('output');if(output)output.textContent=el.value}});
for(const side of ['A','B']){const el=audioEls[side];el.addEventListener('ended',()=>{state.deck[side].playing=false;if(state.agentRules.fallback&&state.queue.length){const next=state.queue.shift();let t=trackFor(next);if(t&&mediaUrls.has(next)){loadToDeck(next,side);setTimeout(()=>act({action:'deck-play',deck:side}),0)}else{toast('AutoMix local: siguiente pista no disponible. Se necesita motor servidor.',true);render()}}else render()});el.addEventListener('error',()=>{state.deck[side].playing=false;toast('Error en pista '+side+'. Revisa el archivo.',true);render()})}

// Public diagnostic surface for QA: no writes and no secrets.
window.AuditSoundQA=Object.freeze({version:V,pages:pages.map(p=>p[0]),contracts:Object.keys(API),getState:()=>({page:state.page,mode:state.mode,commandCount:state.logs.length,libraryCount:state.tracks.length,queueCount:state.queue.length,backendConnected:LIVE.on,engine:LIVE.on?'wasm':'demo'}),live:()=>({on:LIVE.on,ready:!!LIVE.bridge,pos:{A:LIVE.pos.A,B:LIVE.pos.B},dur:{A:LIVE.dur.A,B:LIVE.dur.B}}),getEvents:()=>state.logs.map(({name,payload,status,endpoint})=>({name,payload,status,endpoint}))});
// (el cierre del módulo y el primer render están al final de 05-agent-live.js)
