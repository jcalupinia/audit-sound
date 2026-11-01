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
    return {
      currentTime: a.currentTime,
      paused: a.paused,
      readyState: a.readyState,
      errorCode: a.error ? a.error.code : null,
      status: document.getElementById('statusText').textContent,
    };
  });
  console.log('estado del <audio>:', JSON.stringify(info));
  await browser.close();

  if (!info.paused && info.currentTime > 0.5 && !info.errorCode) {
    console.log('WEB PLAYBACK OK');
    process.exit(0);
  }
  console.error('WEB PLAYBACK FAIL');
  process.exit(1);
})().catch((e) => { console.error('excepción:', e.message); process.exit(3); });
