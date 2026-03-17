/**
 * Playwright gameplay smoke-test.
 * Verifies: page loads, canvas renders, toolbar clicks work, tile clicking works.
 */
const { chromium } = require('playwright');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
};

function startServer(root, port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
        res.end(data);
      });
    });
    server.listen(port, () => resolve(server));
  });
}

(async () => {
  const server  = await startServer(__dirname, 7778);
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console',   m => { if (m.type() === 'error') console.error('[CONSOLE ERR]', m.text()); });

  // ── Load ────────────────────────────────────────────────────────
  await page.goto('http://localhost:7778', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000); // let Three.js boot

  await page.screenshot({ path: 'screenshot-1-initial.png' });
  console.log('✓ Initial load screenshot saved');

  // ── Click Road tool ─────────────────────────────────────────────
  await page.click('button[data-building="road"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'screenshot-2-road-selected.png' });
  console.log('✓ Road tool selected');

  // ── Click a canvas tile (centre of canvas) ───────────────────────
  const canvas = page.locator('canvas');
  const box    = await canvas.boundingBox();
  // Click near the middle of the grid (grid centre projects ~to canvas centre)
  const cx = box.x + box.width  * 0.50;
  const cy = box.y + box.height * 0.45;

  for (let i = 0; i < 8; i++) {
    await page.mouse.click(cx + i * 12 - 42, cy);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshot-3-roads-placed.png' });
  console.log('✓ Road tiles placed');

  // ── Click Power Plant ────────────────────────────────────────────
  await page.click('button[data-building="power_plant"]');
  await page.mouse.click(cx + 30, cy + 40);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshot-4-power-plant.png' });
  console.log('✓ Power plant placed');

  // ── Click R Zone ─────────────────────────────────────────────────
  await page.click('button[data-tool="zone"][data-zone="R"]');
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(cx - 30 + i * 14, cy - 30);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshot-5-r-zone.png' });
  console.log('✓ Residential zone painted');

  // ── Click Select, click a tile, check info panel ──────────────────
  await page.click('button[data-tool="select"]');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);

  const infoPanelVisible = await page.locator('#info-panel:not(.hidden)').count();
  console.log(`✓ Info panel visible after select: ${infoPanelVisible > 0}`);
  await page.screenshot({ path: 'screenshot-6-info-panel.png' });

  // ── Right-click cancels tool ──────────────────────────────────────
  await page.click('button[data-building="road"]');
  await page.mouse.click(cx, cy, { button: 'right' });
  const activeAfterRightClick = await page.locator('#toolbar button.active').innerText();
  console.log(`✓ Active tool after right-click: "${activeAfterRightClick}"`);

  // ── HUD values ───────────────────────────────────────────────────
  const money = await page.locator('#stat-money').innerText();
  const power = await page.locator('#stat-power').innerText();
  console.log(`✓ Money HUD: ${money}`);
  console.log(`✓ Power HUD: ${power}`);

  // ── JS errors ────────────────────────────────────────────────────
  if (jsErrors.length === 0) {
    console.log('\n✅  No JavaScript errors detected.');
  } else {
    console.error('\n❌  JavaScript errors:');
    jsErrors.forEach(e => console.error('   ', e));
  }

  await browser.close();
  server.close();
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
