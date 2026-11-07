from pathlib import Path
from playwright.sync_api import sync_playwright
import csv,json,re
R=Path(__file__).resolve().parents[1]
html=(R/'dist'/'AUDIT_SOUND_V06_ABRIR_EN_CHROME.html').read_text()
registry=json.loads((R/'contracts'/'event-registry.json').read_text())
MAP={'deck-play':'transport.play / transport.pause','deck-cue':'transport.cue','deck-sync':'transport.sync','deck-keylock':'transport.keylock','deck-beatjump':'transport.beatjump','deck-hotcue':'transport.hotcue','deck-monitor':'mixer.control','audio-cross':'mixer.crossfade','master':'mixer.master','eq':'mixer.control','video-play':'video.transport','video-cue':'video.transport','video-loop':'video.transport','video-cross':'video.crossfade','video-transition':'video.transition','video-output':'video.output','video-take':'video.program','video-stop':'video.program','mic-enable':'mic.channel','mic-mute':'mic.channel','mic-gain':'mic.channel','mic-hi':'mic.channel','mic-low':'mic.channel','talkover':'mic.talkover','fx-toggle':'fx.control','fx-wet':'fx.control','fx-param':'fx.control','fx-sync':'fx.control','fx-channel':'fx.control','fx-type':'fx.control','fx-save-preset':'fx.preset','agent-suggestion':'agent.command','agent-approval':'agent.policy','agent-model':'agent.policy','autonomy':'agent.policy','set-mode':'agent.mode','stream-play':'stream.status','stream-stop':'stream.status','license-new':'saas.licenses','license-toggle':'saas.licenses','plan-toggle':'saas.plans','invoice-delete':'saas.invoices','probe-health':'system.health','cue-execute':'event.cue','cue-prepare':'event.cue','user-toggle':'iam.users','permission':'iam.roles','queue-add':'catalog.queue','queue-remove':'catalog.queue','queue-move':'catalog.queue','queue-clear':'catalog.queue'}
recs=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1440,'height':900})
 page.set_content(html);page.locator('button[data-action=guest]').click()
 for route in page.evaluate('window.AuditSoundQA.pages'):
  page.locator(f'aside.sidebar button[data-page="{route}"]').click()
  items=page.evaluate('''() => Array.from(document.querySelectorAll('main button,main input,main select,main textarea')).map(el=>({id:el.id,tag:el.tagName.toLowerCase(),type:el.type||'',name:el.name||'',action:el.dataset.action||el.dataset.change||el.dataset.file||'',label:(el.textContent||el.name||el.ariaLabel||el.placeholder||'').trim().slice(0,80),form:el.closest('form')?.dataset.form||''}))''')
  for item in items:
   ctrl=item['action'] or ('form:'+item['form'] if item['form'] else 'form/display')
   kind='local/demo; contrato pendiente'
   if ctrl in MAP:
    contracts=MAP[ctrl];kind='comando propuesto: '+contracts
   elif item['type']=='file':kind='importación local real + catalog.import / video.transport'
   elif item['type']=='submit':kind='validación formulario + evento mock'
   elif ctrl in ['navigate','go-agent']:kind='navegación local real'
   elif ctrl.startswith('form:'):kind='entrada validada al enviar formulario'
   recs.append({'ruta':route,'control_id':item['id'],'elemento':item['tag'],'tipo':item['type'],'nombre':item['name'],'accion':ctrl,'etiqueta':item['label'],'integracion':kind,'estado':'interfaz operativa / backend no conectado'})
 page.close();b.close()
out=R/'docs'/'UI_CONTROL_REGISTRY.csv'
with out.open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=recs[0].keys());w.writeheader();w.writerows(recs)
print('Control inventory',len(recs),'unique actions',len(set(x['accion'] for x in recs)))
