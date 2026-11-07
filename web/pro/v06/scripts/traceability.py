from pathlib import Path
import csv
R=Path(__file__).resolve().parents[1]
rows=[]
route_funcs={
 'inicio':'homePage','consola':'consolePage','sencilla':'simplePage','video':'videoPage','en-vivo':'livePage',
 'biblioteca':'libraryPage','playlists':'playlistsPage','automatizacion':'automationPage','agente':'agentPage',
 'microfonos':'microphonesPage','efectos':'effectsPage','eventos':'eventPage','analitica':'analyticsPage',
 'diagnostico':'diagnosePage','configuracion':'configurationPage','usuarios':'usersPage','roles':'rolesPage',
 'licencias':'licensesPage','planes':'plansPage','facturacion':'billingPage'}
cols=['id','requisito','modulo','pantalla','control','archivo_codigo','evento','contrato','prueba','estado','evidencia']
def add(id,rf,module,screen,ctrl,code,event,contract,test,status,evidence):
 rows.append(dict(zip(cols,[id,rf,module,screen,ctrl,code,event,contract,test,status,evidence])))
for i,(pg,fn) in enumerate(route_funcs.items(),1):
 add(f'RF01-{i:02d}','RF-01','Navegación '+pg,pg,'Ruta + interfaz completa','src/modules/02-screens.js · '+fn,'navigate','NO API', 'tests/test_browser.py; tests/test_quality.py','IMPLEMENTADO LOCAL','QA: 20/20 pantallas en 4 resoluciones')
features=[
 ('RF02-01','RF-02','Controles interactivos','Todas','button/input/select/textarea con ID único','src/modules/01-core-console.js · render','act / changeControl','UI_CONTROL_REGISTRY.csv','tests/test_quality.py','IMPLEMENTADO LOCAL','291 controles inventariados, 0 IDs duplicados'),
 ('RF03-01','RF-03','Interactividad y formularios','Todas','Navegación, estado, inputs, notificaciones','src/modules/04-events-forms.js','onSubmit / changeControl','Eventos locales','tests/test_browser.py','IMPLEMENTADO LOCAL','20 páginas y flujos ejercitados'),
 ('RF04-01','RF-04','Contratos de cableado','Todas','Bus de comandos y correlación','src/modules/01-core-console.js · command','auditsound:command','contracts/event-registry.json; openapi-propuesto.yaml','tests/test_browser.py','PROPUESTO / BACKEND NO VERIFICADO','38 operaciones propuestas'),
 ('RF05-01','RF-05','Decks de audio','consola','Play/cue/pitch/gain/fader/master/cross','src/modules/03-actions-audio-video.js · initAudio','transport.* / mixer.*','Control API propuesto','tests/test_media.py','LOCAL REAL / C++ NO CONECTADO','Prueba con WAV, EQ y cambio de modo'),
 ('RF05-02','RF-05','Hotcues y loops','consola','Hotcue, beatjump, loop, sync','src/modules/03-actions-audio-video.js · act','transport.hotcue/beatjump/loop/sync','Control API propuesto','tests/test_browser.py','PARCIAL LOCAL / DSP PENDIENTE','Interacciones UI implementadas'),
 ('RF05-03','RF-05','Mix video A/B','video','Video A/B, Preview, Programa, crossfader','src/modules/02-screens.js · videoPage','video.program / video.crossfade','VJ API propuesta','tests/test_media.py','LOCAL VISUAL / CODIFICADOR PENDIENTE','MP4 real a programa local'),
 ('RF05-04','RF-05','Micrófonos','microfonos','4 canales, ganancia, EQ, mute, talkover','src/modules/02-screens.js · microphonesPage','mic.channel / mic.talkover','Motor audio propuesto','tests/test_quality.py','UI REAL / AUDIO INPUT PENDIENTE','Permiso mediante getUserMedia opcional'),
 ('RF05-05','RF-05','FX','efectos','2 bancos, parámetros, presets, plantillas','src/modules/02-screens.js · effectsPage','fx.control / fx.preset','DSP API propuesta','tests/test_browser.py','UI REAL / DSP PENDIENTE','Generador de plantilla .js no ejecuta DSP'),
 ('RF06-01','RF-06','Agente DJ','agente','Chat, voz, modelo, autonomía, aprobaciones','src/modules/02-screens.js · agentPage','agent.command/policy/approval/mode','AI Gateway API propuesto','tests/test_browser.py','MOCK IDENTIFICADO','Sin llamadas Qwen/DeepSeek'),
 ('RF07-01','RF-07','SaaS','usuarios','CRUD de usuarios demo','src/modules/02-screens.js · usersPage','iam.users','IAM API propuesta','tests/test_browser.py','MOCK / AUTH PENDIENTE','Registro local probado'),
 ('RF07-02','RF-07','Permisos','roles','Matriz RBAC editable','src/modules/02-screens.js · rolesPage','iam.roles','IAM API propuesta','tests/test_quality.py','MOCK / RBAC PENDIENTE','Persistencia local únicamente'),
 ('RF07-03','RF-07','Licencias y planes','licencias,planes','Licencias demo y precios','src/modules/02-screens.js','saas.licenses/plans','SaaS API propuesta','tests/test_quality.py','MOCK / BILLING PENDIENTE','Sin cobros reales'),
 ('RF07-04','RF-07','Facturación','facturacion','Borradores / exportación CSV','src/modules/02-screens.js · billingPage','saas.invoices','SaaS API propuesta','tests/test_quality.py','MOCK / FACTURACIÓN PENDIENTE','No factura fiscal'),
 ('RF08-01','RF-08','Responsive','Todas','Desktop/tablet/iPhone/Android visual','src/styles.css','media queries','NO API','tests/test_quality.py','VALIDADO CHROMIUM','0 overflow: 390,768,1366,1920'),
 ('RF08-02','RF-08','Imagen DJ corporativa','consola','Cabecera Copiloto / avatar agente','assets/dj-copiloto.jpg; src/styles.css','NO API','NO API','tests/test_browser.py','IMPLEMENTADO VISUAL','Capturas escritorio y móvil'),
 ('QA-01','Auditoría','QA automatizada','Todas','Navegación/eventos/ID/overflow/media','tests/test_browser.py; test_media.py; test_quality.py','N/A','N/A','suite Chromium','APROBADA','Evidencias docs/QA_BROWSER_METRICS.json'),
 ('QA-02','Auditoría','Prohibición de controles de imagen','Todas','Controles HTML interactivos','src/modules/*.js','DOM nativo','N/A','tests/test_quality.py','APROBADA','Botones sin data-action ni submit: 0'),
 ('DEV-01','Arquitectura','Stack tecnológico','Toda','JS nativo sin dependencias, contratos TS','src/modules/*.js; contracts/types.ts','Eventos','N/A','tsc contratos','DESVIACIÓN DOCUMENTADA','React+TypeScript preferido pero no implementado en UI')]
for f in features:add(*f)
with (R/'docs/MATRIZ_TRAZABILIDAD.csv').open('w',newline='') as o:
 w=csv.DictWriter(o,fieldnames=cols);w.writeheader();w.writerows(rows)
print('Traceability',len(rows),'items')
