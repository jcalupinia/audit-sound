// Verificación E1 en navegador real (Chromium/Blink, equivalente a Android Chrome).
// Carga web/index.html contra un stream Icecast y comprueba que el <audio>
// reproduce de verdad (currentTime avanza, no está en pausa, sin error).
//
// Env: WEB_PORT (default 8080), STREAM_URL (requerido).
const { chromium } = require('playwright');

(async () => {
  const webPort = process.env.WEB_PORT || '8080';
  const stream = process.env.STREAM_URL;
  if (!stream) { console.error('falta STREAM_URL'); process.exit(2); }

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'],
  });
  const page = await browser.newPage();
  const url = `http://localhost:${webPort}/index.html?stream=${encodeURIComponent(stream)}`;
  await page.goto(url, { waitUntil: 'load' });

  await page.click('#btn');          // gesto de usuario: "Escuchar"
  await page.waitForTimeout(4000);   // dejar que conecte y reproduzca

  const info = await page.evaluate(() => {
    const a = window.__auditSound.el;
    const ms = ('mediaSession' in navigator) ? navigator.mediaSession : null;
    const md = ms && ms.metadata ? ms.metadata : null;
    return {
      currentTime: a.currentTime,
      paused: a.paused,
      readyState: a.readyState,
      errorCode: a.error ? a.error.code : null,
      status: document.getElementById('statusText').textContent,
      mediaSession: !!ms,
      msTitle: md ? md.title : null,
      msArtist: md ? md.artist : null,
      msPlaybackState: ms ? ms.playbackState : null,
    };
  });
  console.log('estado del <audio>:', JSON.stringify(info));
  await browser.close();

  const playbackOk = !info.paused && info.currentTime > 0.5 && !info.errorCode;
  const mediaOk = info.mediaSession && info.msTitle && info.msArtist === 'AUDIT SOUND' &&
                  info.msPlaybackState === 'playing';
  if (playbackOk && mediaOk) {
    console.log('WEB PLAYBACK OK + MEDIA SESSION OK');
    process.exit(0);
  }
  console.error('FAIL: playbackOk=' + playbackOk + ' mediaOk=' + mediaOk);
  process.exit(1);
})().catch((e) => { console.error('excepción:', e.message); process.exit(3); });
