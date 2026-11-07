from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
SERVER=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(ROOT)))
Thread(target=SERVER.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{SERVER.server_port}/index.html'
PAGES=['inicio','consola','sencilla','video','en-vivo','biblioteca','playlists','automatizacion','agente','microfonos','efectos','eventos','analitica','diagnostico','configuracion','usuarios','roles','licencias','planes','facturacion']

def test():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium',args=['--no-sandbox','--allow-file-access-from-files'])
        page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
        errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
        page.set_content((ROOT/'dist'/'AUDIT_SOUND_V06_ABRIR_EN_CHROME.html').read_text(),wait_until='load')
        assert page.locator('#login-form').is_visible(), 'missing login'
        assert page.locator('.login-form input[type=email]').count()==1
        page.locator('button[data-action=guest]').click()
        assert 'Audit Sound Command Center' in page.locator('main h1').first.inner_text()
        screenshot=ROOT/'dist'/'captura_inicio.png';page.screenshot(path=str(screenshot),full_page=True)
        actual=page.evaluate('window.AuditSoundQA.pages')
        assert len(actual)==20 and set(PAGES)==set(actual),actual
        for pid in PAGES:
            page.locator(f'button.navbtn[data-page="{pid}"]').first.click()
            assert page.locator('main h1').count()>0, f'{pid} missing title'
            assert page.locator('main').is_visible(),f'{pid} blank'
            h=page.locator('main').inner_text()
            assert len(h)>50, f'{pid} no body'
        page.locator('button.navbtn[data-page=consola]').first.click()
        assert page.locator('.hero .dj-photo').count()==1
        assert page.locator('.console-agent .avatar').count()==1
        assert page.locator('button[data-action=deck-play]').count()==2
        assert page.locator('input[data-change=audio-cross]').count()==1
        assert page.locator('button[data-action=set-mode]').count()==3
        page.screenshot(path=str(ROOT/'dist'/'captura_consola_desktop.png'),full_page=True)
        page.locator('button[data-action=set-mode][data-mode=automatico]').first.click()
        assert page.evaluate('window.AuditSoundQA.getState().mode')=='automatico'
        page.locator('button.navbtn[data-page=agente]').first.click()
        page.locator('form[data-form=agent] textarea').fill('Prepara una sesión de salsa')
        page.locator('form[data-form=agent] button[type=submit]').click()
        assert 'Prepara una sesión de salsa' in page.locator('#agent-chat').inner_text()
        assert '[MOCK]' in page.locator('#agent-chat').inner_text()
        page.locator('button.navbtn[data-page=playlists]').first.click()
        page.locator('button[data-action=playlist-add-selected]').click()
        assert page.locator('button[data-action=playlist-remove]').count()>=1
        page.locator('button.navbtn[data-page=video]').first.click()
        assert page.locator('video#video-src-A').count()==1
        assert page.locator('video#video-src-B').count()==1
        assert page.locator('[data-output=preview]').count()==1
        assert page.locator('[data-output=program]').count()==1
        page.locator('button[data-action=video-take]').click()
        assert 'PROGRAMA LOCAL' in page.locator('[data-output=program]').inner_text()
        page.screenshot(path=str(ROOT/'dist'/'captura_video_desktop.png'),full_page=True)
        page.locator('button.navbtn[data-page=efectos]').first.click()
        assert page.locator('button[data-action=fx-toggle]').count()==2
        page.locator('form[data-form=fx-generator] input[name=name]').fill('SpatialEcho')
        page.locator('form[data-form=fx-generator] button[type=submit]').click()
        assert page.locator('button[data-action=fx-download-code]').count()>=1
        page.locator('button.navbtn[data-page=usuarios]').first.click()
        page.locator('form[data-form=user] input[name=name]').fill('Test Control')
        page.locator('form[data-form=user] input[name=email]').fill('control@example.test')
        page.locator('form[data-form=user] button[type=submit]').click()
        assert 'Test Control' in page.locator('main').inner_text()
        page.locator('button.navbtn[data-page=diagnostico]').first.click()
        page.locator('button[data-action=selftest]').click()
        assert '✓ 20 rutas' in page.locator('#selftest-output').inner_text()
        states=page.evaluate('window.AuditSoundQA.getEvents()')
        print('EVENTS',len(states),[x['name'] for x in states]); assert len(states)>=4, 'actions not emitting events'
        assert all(x['endpoint']!='SIN CONTRATO' for x in states),[x for x in states if x['endpoint']=='SIN CONTRATO']
        assert not errors, errors
        print('PASS desktop 20 routes + 12 interaction workflows / commands',len(states))
        mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
        mobile_errors=[];mobile.on('pageerror',lambda e:mobile_errors.append(str(e)))
        mobile.set_content((ROOT/'dist'/'AUDIT_SOUND_V06_ABRIR_EN_CHROME.html').read_text(),wait_until='load')
        mobile.locator('button[data-action=guest]').click()
        mobile.locator('button[data-action=mobile-nav]').click()
        mobile.locator('nav.mobile-nav button[data-page=consola]').click()
        mobile.screenshot(path=str(ROOT/'dist'/'captura_consola_movil.png'),full_page=True)
        body_width=mobile.evaluate('document.documentElement.scrollWidth');viewport=mobile.evaluate('document.documentElement.clientWidth')
        assert body_width<=viewport+1,(body_width,viewport)
        assert not mobile_errors,mobile_errors
        print('PASS mobile 390px, width',viewport,'scrollWidth',body_width)
        browser.close()

if __name__=='__main__':test()
