/**
 * Playwright city-builder exploration script.
 * Uses addInitScript to intercept ES module imports and expose city to window.
 * Builds a basic city, accelerates simulation, reads modal dialogs and RCI demand.
 */

const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
      console.log('[BROWSER] Launched Chromium (non-headless)');
    } catch (e) {
      console.log('[BROWSER] Non-headless failed, trying headless:', e.message);
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      console.log('[BROWSER] Launched Chromium (headless)');
    }

    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));
    page.on('pageerror', err => consoleLogs.push(`[PAGE ERROR] ${err.message}`));

    // ── Intercept module system to expose city ──────────────────────────────
    // We intercept the City constructor via a script that patches the module's
    // exported class after load. Since we can't easily hook ES modules,
    // we instead use exposeFunction + route to inject a shim.

    // The best approach: use page.route to intercept main.js and inject
    // a window.__city assignment.

    await page.route('**/js/main.js', async route => {
      const response = await route.fetch();
      let body = await response.text();
      // Inject city/grid exposure right after city is instantiated
      body = body.replace(
        'const city = new City(grid);',
        'const city = new City(grid);\nwindow.__city = city;\nwindow.__grid = grid;'
      );
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body,
      });
      console.log('[ROUTE] Patched main.js to expose city/grid to window');
    });

    // ── Load game ───────────────────────────────────────────────────────────
    console.log('\n=== STEP 1: Loading game ===');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // wait for Three.js + terrain generation

    // Verify city is accessible
    const cityAccessible = await page.evaluate(() => {
      return {
        hasCity: !!window.__city,
        hasGrid: !!window.__grid,
        state: window.__city ? window.__city.getState() : null,
      };
    });
    console.log('[VERIFY] City accessible:', JSON.stringify(cityAccessible, null, 2));

    if (!cityAccessible.hasCity) {
      console.log('[WARN] City not found via patch - checking for alternative exposure');
      const debug = await page.evaluate(() => {
        return {
          windowCityKeys: Object.keys(window).filter(k => k.includes('city') || k.includes('City')),
          all: Object.keys(window).filter(k => !k.match(/^on|^webkit|^screen|^inner|^outer|^page|^scroll|^device|^visual/)).slice(0, 30)
        };
      });
      console.log('[DEBUG]', JSON.stringify(debug));
      // Fallback: take screenshot and dump HTML
      await page.screenshot({ path: 'screenshot-debug.png' });
      throw new Error('Cannot access city object - patch may have failed');
    }

    await page.screenshot({ path: 'screenshot-01-initial.png' });
    console.log('[SCREENSHOT] Initial state saved');

    // ── Build city via JS ───────────────────────────────────────────────────
    console.log('\n=== STEP 2: Building basic city ===');
    const buildResult = await page.evaluate(() => {
      const city = window.__city;
      const results = [];
      const errors  = [];

      function tryPlace(fn, label) {
        const r = fn();
        if (r && r.success) results.push(label);
        else if (r && !r.success) errors.push(`${label}: ${r.reason}`);
      }

      // Road grid: horizontal road at z=15 and vertical road at x=15
      for (let x = 5; x <= 30; x++) tryPlace(() => city.placeBuilding(x, 15, 'road'), `road(${x},15)`);
      for (let z = 5; z <= 30; z++) tryPlace(() => city.placeBuilding(15, z, 'road'), `road(15,${z})`);

      // Power plant & water pump adjacent to road (connected)
      tryPlace(() => city.placeBuilding(5, 14, 'power_plant'), 'power_plant(5,14)');
      tryPlace(() => city.placeBuilding(5, 13, 'water_pump'),  'water_pump(5,13)');

      // Residential zones: rows z=13 and z=14 from x=6 to x=14
      for (let x = 6; x <= 14; x++) {
        tryPlace(() => city.placeZone(x, 14, 'R'), `R(${x},14)`);
        tryPlace(() => city.placeZone(x, 13, 'R'), `R(${x},13)`);
      }

      // Industrial zones: south side of road at z=16
      for (let x = 6; x <= 14; x++) {
        tryPlace(() => city.placeZone(x, 16, 'I'), `I(${x},16)`);
      }

      // Commercial zones: east side at x=16-24
      for (let x = 16; x <= 24; x++) {
        tryPlace(() => city.placeZone(x, 14, 'C'), `C(${x},14)`);
      }

      const gs = city._grid.getStats();
      return {
        placed: results.length,
        buildLog: results.slice(0, 10).concat(results.length > 10 ? [`...${results.length - 10} more`] : []),
        errors: errors.slice(0, 10),
        state: city.getState(),
        gridStats: {
          population: gs.population,
          totalJobs: gs.totalJobs,
          powerNeeded: gs.powerNeeded,
          powerAvailable: gs.powerAvailable,
          waterNeeded: gs.waterNeeded,
          waterAvailable: gs.waterAvailable,
          buildingCount: gs.allBuildings.length,
        },
      };
    });

    console.log('[BUILD] Placed:', buildResult.placed);
    console.log('[BUILD] Errors:', JSON.stringify(buildResult.errors));
    console.log('[BUILD] State after build:', JSON.stringify(buildResult.state, null, 2));
    console.log('[BUILD] Grid stats:', JSON.stringify(buildResult.gridStats, null, 2));

    await page.screenshot({ path: 'screenshot-02-after-build.png' });

    // ── Run simulation (accelerated) ────────────────────────────────────────
    console.log('\n=== STEP 3: Running simulation (accelerated) ===');

    const simSnapshots = await page.evaluate(async () => {
      const city = window.__city;
      const snapshots = [];

      function snapshot(label) {
        const s = city.getState();
        const g = city._grid.getStats();
        const d = city._state.rciDemand;
        const powerOK = s.totalPowerAvailable >= s.totalPowerNeeded;
        const waterOK = s.totalWaterAvailable >= s.totalWaterNeeded;
        const emp = g.totalJobs > 0
          ? Math.min(1, s.population / g.totalJobs)
          : (s.population > 0 ? 0 : 0.5);

        // Count buildings auto-spawned
        let rBldgs = 0, cBldgs = 0, iBldgs = 0;
        for (const t of city._grid.getAllTiles()) {
          if (t.type === 'zone' && t.building) {
            if (t.zoneType === 'R') rBldgs++;
            else if (t.zoneType === 'C') cBldgs++;
            else if (t.zoneType === 'I') iBldgs++;
          }
        }

        snapshots.push({
          label,
          population: s.population,
          happiness: s.happiness,
          R: d.R, C: d.C, I: d.I,
          powerOK, waterOK,
          powerNeeded: s.totalPowerNeeded,
          powerAvail: s.totalPowerAvailable,
          waterNeeded: s.totalWaterNeeded,
          waterAvail: s.totalWaterAvailable,
          totalJobs: g.totalJobs,
          empPct: Math.round(emp * 100),
          rBldgs, cBldgs, iBldgs,
          money: Math.round(s.money),
        });
      }

      snapshot('T=0 (before sim)');

      // Fast-forward 900 game-days = ~900 real seconds at 1day/s = 30 months
      // We call tick(1000) 900 times = 900 days
      for (let i = 1; i <= 900; i++) {
        city.tick(1000);
        if (i % 100 === 0) snapshot(`T=${i} days`);
      }

      snapshot('T=900 (final)');
      return snapshots;
    });

    console.log('[SIM] Snapshots:');
    simSnapshots.forEach(s => console.log('  ', JSON.stringify(s)));

    await page.screenshot({ path: 'screenshot-03-after-sim.png' });

    // ── Detailed demand analysis ─────────────────────────────────────────────
    console.log('\n=== STEP 4: Detailed RCI demand analysis ===');

    const demandAnalysis = await page.evaluate(() => {
      const city = window.__city;
      const s = city._state;
      const grid = city._grid;
      const stats = grid.getStats();

      const powerOK = s.totalPowerAvailable >= s.totalPowerNeeded;
      const waterOK = s.totalWaterAvailable >= s.totalWaterNeeded;

      const emp = stats.totalJobs > 0
        ? Math.min(1, s.population / stats.totalJobs)
        : (s.population > 0 ? 0 : 0.5);

      const cBuilt = grid.getAllTiles().filter(t => t.zoneType === 'C' && t.building).length;
      const cRatio = stats.population > 0 ? cBuilt / stats.population : 0;

      // Zone counts + connectivity
      const zoneCounts = { R: { total: 0, buildings: 0, connected: 0 },
                           C: { total: 0, buildings: 0, connected: 0 },
                           I: { total: 0, buildings: 0, connected: 0 } };

      for (const t of grid.getAllTiles()) {
        if (t.type !== 'zone') continue;
        const z = zoneCounts[t.zoneType];
        if (!z) continue;
        z.total++;
        if (t.building) z.buildings++;
        if (t.connected) z.connected++;
      }

      // Check what WILL happen on next _updateRCIDemand tick
      const rConditions = {
        'emp > 0.7': emp > 0.7,
        'happiness > 50': s.happiness > 50,
        'powerOK': powerOK,
        'waterOK': waterOK,
        'ALL (R rises)': emp > 0.7 && s.happiness > 50 && powerOK && waterOK,
      };
      const cConditions = {
        'population > 50': stats.population > 50,
        'cRatio < 0.3': cRatio < 0.3,
        'BOTH (C rises)': stats.population > 50 && cRatio < 0.3,
      };
      const iConditions = {
        'emp < 0.6': emp < 0.6,
        '(I rises)': emp < 0.6,
      };

      return {
        // Raw state
        population: stats.population,
        totalJobs: stats.totalJobs,
        happiness: s.happiness,
        powerNeeded: s.totalPowerNeeded,
        powerAvailable: s.totalPowerAvailable,
        waterNeeded: s.totalWaterNeeded,
        waterAvailable: s.totalWaterAvailable,
        powerOK, waterOK,
        emp: emp.toFixed(3),
        empPct: Math.round(emp * 100),
        cBuilt,
        cRatio: cRatio.toFixed(3),
        money: Math.round(s.money),

        // Zone inventory
        zoneCounts,

        // Current demand
        currentDemand: { ...s.rciDemand },

        // What causes next tick direction
        rConditions,
        cConditions,
        iConditions,

        // Full detail objects from city API
        rciDetails: city.getRCIDetails(),
        popDetails: city.getPopulationDetails(),
        happinessDetails: city.getHappinessDetails(),
        financialDetails: city.getFinancialDetails(),
      };
    });

    console.log('\n[DEMAND ANALYSIS - RAW STATE]');
    console.log('  Population:', demandAnalysis.population, '| Jobs:', demandAnalysis.totalJobs);
    console.log('  Happiness:', demandAnalysis.happiness);
    console.log('  Power:', demandAnalysis.powerAvailable, '/', demandAnalysis.powerNeeded, '- OK:', demandAnalysis.powerOK);
    console.log('  Water:', demandAnalysis.waterAvailable, '/', demandAnalysis.waterNeeded, '- OK:', demandAnalysis.waterOK);
    console.log('  Employment ratio:', demandAnalysis.emp, '(', demandAnalysis.empPct, '%)');
    console.log('  C-buildings built:', demandAnalysis.cBuilt, '| C-ratio:', demandAnalysis.cRatio);
    console.log('  Money:', demandAnalysis.money);

    console.log('\n[ZONE COUNTS]', JSON.stringify(demandAnalysis.zoneCounts, null, 2));

    console.log('\n[CURRENT DEMAND]', JSON.stringify(demandAnalysis.currentDemand));

    console.log('\n[R CONDITIONS (need ALL true to rise)]', JSON.stringify(demandAnalysis.rConditions));
    console.log('[C CONDITIONS (need BOTH true to rise)]', JSON.stringify(demandAnalysis.cConditions));
    console.log('[I CONDITIONS (emp < 0.6 to rise)]', JSON.stringify(demandAnalysis.iConditions));

    console.log('\n[RCI DETAILS FROM city.getRCIDetails()]');
    console.log(JSON.stringify(demandAnalysis.rciDetails, null, 2));

    console.log('\n[POP DETAILS]');
    console.log(JSON.stringify(demandAnalysis.popDetails, null, 2));

    console.log('\n[HAPPINESS DETAILS]');
    console.log(JSON.stringify(demandAnalysis.happinessDetails, null, 2));

    console.log('\n[FINANCIAL DETAILS]');
    console.log(JSON.stringify(demandAnalysis.financialDetails, null, 2));

    // ── Click modal triggers ─────────────────────────────────────────────────
    console.log('\n=== STEP 5: Opening modal dialogs ===');

    // Click money stat
    try {
      await page.click('#stat-money');
      await page.waitForTimeout(500);
      const moneyModal = await page.evaluate(() => document.getElementById('modal-body')?.innerHTML);
      console.log('[MODAL money]', moneyModal?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500));
      await page.screenshot({ path: 'screenshot-modal-money.png' });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } catch (e) { console.log('[MODAL money] Error:', e.message); }

    // Click population stat
    try {
      await page.click('#stat-pop');
      await page.waitForTimeout(500);
      const popModal = await page.evaluate(() => document.getElementById('modal-body')?.innerHTML);
      console.log('[MODAL population]', popModal?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500));
      await page.screenshot({ path: 'screenshot-modal-pop.png' });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } catch (e) { console.log('[MODAL pop] Error:', e.message); }

    // Click happiness stat
    try {
      await page.click('#stat-happiness');
      await page.waitForTimeout(500);
      const happModal = await page.evaluate(() => document.getElementById('modal-body')?.innerHTML);
      console.log('[MODAL happiness]', happModal?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500));
      await page.screenshot({ path: 'screenshot-modal-happiness.png' });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } catch (e) { console.log('[MODAL happiness] Error:', e.message); }

    // Click RCI bars
    try {
      const rciEl = await page.$('.rci-bars');
      if (rciEl) {
        await rciEl.click();
        await page.waitForTimeout(500);
        const rciModal = await page.evaluate(() => document.getElementById('modal-body')?.innerHTML);
        console.log('[MODAL RCI]', rciModal?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1000));
        await page.screenshot({ path: 'screenshot-modal-rci.png' });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else {
        console.log('[MODAL RCI] .rci-bars element not found');
        // Try to show it via JS
        const rciResult = await page.evaluate(() => {
          // Try to trigger showRCIModal if it's accessible
          const bars = document.querySelector('.rci-bars');
          if (bars) { bars.click(); return 'clicked'; }
          return 'not found - showing via evaluate';
        });
        console.log('[MODAL RCI] rci-bars:', rciResult);
      }
    } catch (e) { console.log('[MODAL RCI] Error:', e.message); }

    // ── Final screenshot ─────────────────────────────────────────────────────
    await page.screenshot({ path: 'screenshot-04-final.png' });

    // Print page console logs
    console.log('\n=== PAGE CONSOLE LOGS ===');
    consoleLogs.slice(0, 30).forEach(l => console.log(l));

    console.log('\n=== DONE ===');

  } catch (err) {
    console.error('[FATAL ERROR]:', err.message);
    console.error(err.stack);
  } finally {
    if (browser) {
      await new Promise(r => setTimeout(r, 2000)); // brief pause to see browser
      await browser.close();
      console.log('[BROWSER] Closed');
    }
  }
})();
