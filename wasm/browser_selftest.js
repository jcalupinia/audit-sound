// Carga audit_selftest.html en Chromium (headless) con COOP/COEP y espera la
// línea SELFTEST_RESULT en la consola del navegador. Verifica que el motor WASM
// produce audio real (pico > 0.01) dentro del worker proxied.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--headless=new', '--no-sandbox', '--enable-features=SharedArrayBuffer'],
  });
  const page = await browser.newPage();
  let result = null;
  const lines = [];
  page.on('console', (msg) => {
    const t = msg.text();
    lines.push(t);
    if (t.includes('SELFTEST_RESULT')) result = t;
  });
  page.on('pageerror', (e) => lines.push('PAGEERROR ' + e.message));

  await page.goto('http://localhost:8099/audit_selftest.html', { waitUntil: 'load', timeout: 30000 });

  // Esperar hasta 20 s por la línea de resultado.
  const t0 = Date.now();
  while (!result && Date.now() - t0 < 20000) await page.waitForTimeout(250);

  console.log('--- consola del navegador ---');
  for (const l of lines) console.log(l);
  console.log('-----------------------------');

  await browser.close();

  if (!result) { console.log('FALLO: no llegó SELFTEST_RESULT'); process.exit(1); }
  const m = result.match(/peak=([\d.]+)/);
  const peak = m ? parseFloat(m[1]) : 0;
  console.log('pico =', peak);
  console.log(peak > 0.01 ? 'WASM ENGINE OK (audio real en el navegador)' : 'FALLO (silencio)');
  process.exit(peak > 0.01 ? 0 : 1);
})().catch((e) => { console.error('error:', e); process.exit(2); });
