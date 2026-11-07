from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
 page=b.new_page(viewport={'width':1366,'height':768})
 errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
 page.set_content((R/'dist'/'AUDIT_SOUND_V06_ABRIR_EN_CHROME.html').read_text())
 page.locator('button[data-action=guest]').click()
 page.locator('aside.sidebar button[data-page=consola]').click()
 page.locator('input[data-file="audio-A"]').set_input_files(str(R/'tests'/'sample.wav'))
 assert 'sample' in page.locator('main').inner_text().lower()
 page.locator('button[data-action=deck-play][data-deck=A]').click()
 page.wait_for_timeout(180)
 assert page.evaluate('!document.getElementById("engine-a").paused'), 'audio is not playing'
 assert page.evaluate('document.getElementById("engine-a").currentTime')>=0
 page.locator('button[data-action=set-mode][data-mode=manual]').first.click()
 assert page.evaluate('!document.getElementById("engine-a").paused'), 'mode switch restarted/stopped audio'
 page.locator('input[data-change=audio-cross]').fill('25')
 assert page.evaluate('window.AuditSoundQA.getEvents().some(x=>x.name==="mixer.crossfade")')
 page.locator('button[data-action=deck-cue][data-deck=A]').click()
 assert page.evaluate('document.getElementById("engine-a").paused')
 page.locator('aside.sidebar button[data-page=video]').click()
 page.locator('input[data-file="video-A"]').set_input_files(str(R/'tests'/'sample.mp4'))
 assert page.locator('#video-src-A').get_attribute('src').startswith('blob:')
 page.locator('button[data-action=video-play][data-deck=A]').click()
 page.wait_for_timeout(200)
 page.locator('button[data-action=video-take]').click()
 assert page.locator('[data-output=program] video[data-output-video=A]').count()==1
 page.screenshot(path=str(R/'dist'/'captura_video_archivo_real.png'),full_page=True)
 assert not errs,errs
 print('PASS audio WebAudio browser transport, crossfader + video HTML5 local and program')
 b.close()
