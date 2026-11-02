// Abre bridge_test.html en Chromium (COOP/COEP + autoplay permitido) y espera la
// línea BRIDGE_RESULT. Verifica que el audio del motor WASM fluye por el AudioWorklet
// (peak>0.01) sin underruns sostenidos.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--headless=new', '--no-sandbox',
           '--autoplay-policy=no-user-gesture-required',
           '--enable-features=SharedArrayBuffer'],
  });
  const page = await browser.newPage();
  let result = null; const lines = [];
  page.on('console', (m) => { const t = m.text(); lines.push(t); if (t.includes('BRIDGE_RESULT')) result = t; });
  page.on('pageerror', (e) => lines.push('PAGEERROR ' + e.message));

  await page.goto('http://localhost:8099/bridge_test.html', { waitUntil: 'load', timeout: 30000 });
  const t0 = Date.now();
  while (!result && Date.now() - t0 < 25000) await page.waitForTimeout(250);

  console.log('--- consola ---');
  for (const l of lines) console.log(l);
  console.log('---------------');
  await browser.close();

  if (!result) { console.log('FALLO: sin BRIDGE_RESULT'); process.exit(1); }
  const peak = parseFloat((result.match(/peak=([\d.]+)/) || [])[1] || '0');
  console.log('pico por el worklet =', peak);
  console.log(peak > 0.01 ? 'PUENTE DE AUDIO OK (motor WASM -> worklet -> salida)' : 'FALLO (silencio)');
  process.exit(peak > 0.01 ? 0 : 1);
})().catch((e) => { console.error('error:', e); process.exit(2); });
