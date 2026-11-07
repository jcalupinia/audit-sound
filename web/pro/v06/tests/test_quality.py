from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
app=(R/'src/app.js').read_text(); registry=json.loads((R/'contracts/event-registry.json').read_text())
assert len(registry)>=35
handlers=set(re.findall(r"case '([^']+)'",app))
html=(R/'dist'/'AUDIT_SOUND_V06_ABRIR_EN_CHROME.html').read_text()
recs=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(390,844),(768,1024),(1366,768),(1920,1080)]:
  page=browser.new_page(viewport={'width':width,'height':height})
  issues=[];page.on('pageerror',lambda e:issues.append(str(e)))
  page.set_content(html);page.locator('button[data-action=guest]').click()
  all_actions=set();inputs=0;buttons=0;routes=page.evaluate('window.AuditSoundQA.pages')
  for route in routes:
   page.locator(f'aside.sidebar button[data-page="{route}"]').first.click() if width>900 else (
      page.locator('button[data-action=mobile-nav]').click(),page.locator(f'nav.mobile-nav button[data-page="{route}"]').click())
   a=page.evaluate('''() => ({actions:Array.from(document.querySelectorAll('main button[data-action]')).map(x=>x.dataset.action),badButtons:Array.from(document.querySelectorAll('main button:not([data-action]):not([type=submit])')).map(x=>x.textContent),dupeIds:(a=>a.length-new Set(a).size)(Array.from(document.querySelectorAll('[id]')).map(x=>x.id)),noIds:document.querySelectorAll('main button:not([id]),main input:not([id]),main select:not([id]),main textarea:not([id])').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1})''')
   all_actions.update(a['actions']);buttons+=len(a['actions']);assert not a['badButtons'],(route,a['badButtons']);assert a['dupeIds']==0,(route,a['dupeIds']);assert a['noIds']==0,(route,a['noIds']);assert not a['overflow'],('overflow',route,width)
  assert not (all_actions-handlers),sorted(all_actions-handlers)
  assert not issues,issues
  recs.append({'width':width,'height':height,'routes':len(routes),'buttons_with_events':buttons,'action_kinds':len(all_actions),'duplicate_ids':0,'runtime_errors':0,'overflow_routes':0})
  page.close()
 browser.close()
(R/'docs'/'QA_BROWSER_METRICS.json').write_text(json.dumps(recs,indent=2))
print('PASS quality',json.dumps(recs))
