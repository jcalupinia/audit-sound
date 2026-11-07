from pathlib import Path
import base64, re, json
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'index.html').read_text()
css=(ROOT/'src/styles.css').read_text()
js='\n'.join(p.read_text() for p in sorted((ROOT/'src/modules').glob('*.js')))
(ROOT/'src/app.js').write_text(js)
assets={}
for f in (ROOT/'assets').glob('*.jpg'):
    assets[f.name]='data:image/jpeg;base64,'+base64.b64encode(f.read_bytes()).decode()
    css=css.replace("../assets/"+f.name,assets[f.name])
html=html.replace('<link rel="stylesheet" href="src/styles.css">','<style>'+css+'</style>')
html=html.replace('<script defer src="src/app.js"></script>',
 '<script>window.AUDIT_SOUND_ASSETS='+json.dumps(assets,separators=(',',':'))+';</script>\n<script>'+js.replace('</script','<\\/script')+'</script>')
(ROOT/'dist'/'AUDIT_SOUND_V06_ABRIR_EN_CHROME.html').write_text(html)
print('Standalone HTML size:',round(len(html)/1024/1024,2),'MiB; code:',len(js),'CSS:',len(css))
