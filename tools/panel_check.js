// Verificación M5 del panel de control en navegador real (Chromium).
// Carga la página contra la Control API, hace login y comprueba que aparece el
// estado (now-playing). Env: WEB_PORT, API_URL, USER, PASS.
const { chromium } = require('playwright');

(async () => {
  const webPort = process.env.WEB_PORT || '8080';
  const api = process.env.API_URL || 'http://localhost:8787';
  const user = process.env.USER_ || 'dj';
  const pass = process.env.PASS_ || 'clave123';

  const browser = await chromium.launch({ args: ['--no-sandbox', '--headless=new'] });
  const page = await browser.newPage();
  const url = `http://localhost:${webPort}/index.html?api=${encodeURIComponent(api)}`;
  await page.goto(url, { waitUntil: 'load' });

  await page.fill('#u', user);
  await page.fill('#pw', pass);
  await page.click('#loginBtn');
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => ({
    controlsVisible: !document.getElementById('controls').hidden,
    loginHidden: document.getElementById('login').hidden,
    nowPlaying: document.getElementById('titleA').textContent,  // now-playing en Deck A
  }));
  console.log('panel:', JSON.stringify(info));
  await browser.close();

  const ok = info.controlsVisible && info.loginHidden &&
             info.nowPlaying && info.nowPlaying !== '—';
  console.log(ok ? 'PANEL OK' : 'PANEL FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('excepción:', e.message); process.exit(3); });
