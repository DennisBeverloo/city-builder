/**
 * Playwright diagnostic script for city-builder.
 * Starts a static file server, opens the page, collects all console
 * messages/errors and JS exceptions, waits for 5 s, then saves a screenshot.
 */
const { chromium } = require('playwright');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── Tiny static-file server ───────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
};

function startServer(root, port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(root, req.url === '/' ? 'index.html' : req.url);
      // Strip query strings
      filePath = filePath.split('?')[0];

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end(`Not found: ${req.url}`);
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        res.end(data);
      });
    });
    server.listen(port, () => resolve(server));
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const ROOT   = __dirname;
  const PORT   = 7777;
  const server = await startServer(ROOT, PORT);
  console.log(`Server started at http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  page.setViewportSize({ width: 1280, height: 800 });

  const logs     = [];
  const errors   = [];
  const netFails = [];

  page.on('console', msg => {
    const entry = `[${msg.type().toUpperCase()}] ${msg.text()}`;
    logs.push(entry);
    console.log(entry);
  });

  page.on('pageerror', err => {
    const entry = `[PAGE ERROR] ${err.message}\n${err.stack}`;
    errors.push(entry);
    console.error(entry);
  });

  page.on('requestfailed', req => {
    const entry = `[NET FAIL] ${req.url()} — ${req.failure()?.errorText}`;
    netFails.push(entry);
    console.error(entry);
  });

  console.log('\nNavigating to page...');
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded' });

  // Wait for Three.js to (hopefully) initialise
  console.log('Waiting 6 seconds for scene to load...');
  await page.waitForTimeout(6000);

  // Grab a screenshot
  await page.screenshot({ path: path.join(ROOT, 'debug-screenshot.png'), fullPage: false });
  console.log('\nScreenshot saved → debug-screenshot.png');

  // Dump summary
  console.log('\n══════════════ SUMMARY ══════════════');
  console.log(`Network failures : ${netFails.length}`);
  netFails.forEach(e => console.log('  ', e));
  console.log(`JS page errors   : ${errors.length}`);
  errors.forEach(e => console.log('  ', e));
  console.log(`Console messages : ${logs.length}`);

  // Check canvas exists & has content
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { found: false };
    const ctx = canvas.getContext('2d');
    // For WebGL we can't easily read pixels via 2d ctx,
    // but we can check dimensions and WebGL context
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return {
      found:  true,
      width:  canvas.width,
      height: canvas.height,
      hasGL:  !!gl,
    };
  });
  console.log('\nCanvas info:', canvasInfo);

  // Check DOM structure
  const domInfo = await page.evaluate(() => ({
    toolbar:    !!document.getElementById('toolbar'),
    bottomBar:  !!document.getElementById('bottom-bar'),
    infoPanel:  !!document.getElementById('info-panel'),
    gameCont:   !!document.getElementById('game-container'),
    canvasCount: document.querySelectorAll('canvas').length,
    bodyText:   document.body.innerText.substring(0, 300),
  }));
  console.log('DOM info:', domInfo);

  await browser.close();
  server.close();
  console.log('\nDone.');
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
