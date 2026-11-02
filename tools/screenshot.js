// Captura screenshots reales del frontend (web/index.html) a tamaño móvil.
const { chromium } = require('playwright');

(async () => {
  const webPort = process.env.WEB_PORT || '8080';
  const api = process.env.API_URL || 'http://localhost:8787';
  const out = process.env.OUT_DIR || '/tmp/shots';
  const browser = await chromium.launch({ args: ['--no-sandbox', '--headless=new'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  const url = `http://localhost:${webPort}/index.html?api=${encodeURIComponent(api)}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // Login.
  await page.fill('#u', 'dj');
  await page.fill('#pw', 'clave123');
  await page.click('#loginBtn');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out + '/01_auto.png', fullPage: true });

  // Pasar a MANUAL (mezcladora con dos platos y controles).
  await page.click('#modeSeg button[data-m="manual"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out + '/02_manual.png', fullPage: true });

  await browser.close();
  console.log('screenshots en', out);
})().catch((e) => { console.error(e.message); process.exit(1); });
