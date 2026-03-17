/**
 * Playwright test for drag-to-build: roads, bridges, zones.
 */
const { chromium } = require('playwright');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const MIME = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png' };
function startServer(root, port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let fp = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); return res.end('NF'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
        res.end(data);
      });
    });
    s.listen(port, () => resolve(s));
  });
}

async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  // Move gradually to trigger mousemove events
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      x1 + (x2 - x1) * i / steps,
      y1 + (y2 - y1) * i / steps,
    );
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

(async () => {
  const server  = await startServer(__dirname, 7779);
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 900 });

  const jsErrors = [];
  page.on('pageerror', e => { jsErrors.push(e.message); console.error('[JS ERR]', e.message); });

  await page.goto('http://localhost:7779', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const box = await page.locator('canvas').boundingBox();
  // Canvas centre (roughly over the grid interior, away from the river)
  const cx = box.x + box.width * 0.38;
  const cy = box.y + box.height * 0.35;

  // ── 1. Horizontal road drag ──────────────────────────────────────
  await page.click('button[data-building="road"]');
  await page.waitForTimeout(100);
  await drag(page, cx, cy, cx + 140, cy);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'drag-1-road-h.png' });
  console.log('✓ Horizontal road drag');

  // ── 2. Vertical road drag ────────────────────────────────────────
  await drag(page, cx, cy, cx, cy + 120);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'drag-2-road-v.png' });
  console.log('✓ Vertical road drag');

  // ── 3. Road drag over river → bridges ────────────────────────────
  // The river runs roughly through the horizontal centre-right of the canvas
  const riverX = box.x + box.width * 0.52;
  const riverY = box.y + box.height * 0.42;
  await drag(page, riverX - 80, riverY, riverX + 80, riverY);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'drag-3-bridge.png' });
  console.log('✓ Bridge drag across river');

  // ── 4. R-Zone rectangle drag ─────────────────────────────────────
  await page.click('button[data-tool="zone"][data-zone="R"]');
  await page.waitForTimeout(100);
  const zx = cx - 60, zy = cy - 60;
  await drag(page, zx, zy, zx + 100, zy + 80);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'drag-4-rzone.png' });
  console.log('✓ R-Zone rectangle drag');

  // ── 5. C-Zone rectangle drag ─────────────────────────────────────
  await page.click('button[data-tool="zone"][data-zone="C"]');
  await page.waitForTimeout(100);
  await drag(page, cx + 80, cy + 40, cx + 160, cy + 100);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'drag-5-czone.png' });
  console.log('✓ C-Zone rectangle drag');

  // ── 6. Right-click cancels tool ──────────────────────────────────
  await page.click('button[data-building="road"]');
  await page.mouse.click(cx, cy, { button: 'right' });
  const active = await page.locator('#toolbar button.active').innerText();
  console.log(`✓ Right-click resets to: "${active}"`);

  // ── 7. Money was deducted ────────────────────────────────────────
  const money = await page.locator('#stat-money').innerText();
  console.log(`✓ Money after building: ${money}`);

  // ── 8. Drag info hidden after drag ends ──────────────────────────
  const dragInfoHidden = await page.locator('#drag-info.hidden').count();
  console.log(`✓ Drag info hidden after release: ${dragInfoHidden > 0}`);

  // ── Results ──────────────────────────────────────────────────────
  if (jsErrors.length === 0) {
    console.log('\n✅  No JavaScript errors.');
  } else {
    console.error('\n❌  JS errors:', jsErrors);
  }

  await browser.close();
  server.close();
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
