/**
 * @module ui
 * DOM management: bottom HUD, toolbar state, info panel, notifications.
 * Knows nothing about Three.js internals.
 */
import { getBuildingDef } from './buildings.js';
import { SPEED_PRESETS } from './city.js';

// ── Tool state ───────────────────────────────────────────────────────────────

/** @type {{ type: string, zoneType?: string, buildingId?: string }|null} */
let _activeTool = { type: 'select' };

/** @returns {object|null} */
export function getActiveTool() { return _activeTool; }

// ── Toolbar ──────────────────────────────────────────────────────────────────

/**
 * Initialise the toolbar buttons and bind click handlers.
 * @param {import('./city.js').City} city  City emits 'levelUp' to unlock buttons.
 */
export function initToolbar(city) {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;

  // Inject new infra buttons before binding (so event delegation picks them up)
  _injectInfraButtons(toolbar);

  // Bind each button
  toolbar.querySelectorAll('button[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('locked')) return;
      _setActiveTool(btn);
    });
  });

  // Set default active
  const defaultBtn = toolbar.querySelector('[data-tool="select"]');
  if (defaultBtn) _setActiveTool(defaultBtn);

  // Unlock buttons on level-up
  city.on('levelUp', ({ level }) => _applyUnlocks(level));
}

/**
 * Dynamically inject generator_small, solar_farm, nuclear_plant, and
 * water_pump_small into the existing Infra toolbar group.
 * Order: [Diesel Gen] [Coal Plant] [Solar Farm] [Nuclear] [Small Pump] [Water Station] [Road]
 */
function _injectInfraButtons(toolbar) {
  const powerBtn = toolbar.querySelector('[data-building="power_plant"]');
  const waterBtn = toolbar.querySelector('[data-building="water_pump"]');
  if (!powerBtn || !waterBtn) return;
  const infra = powerBtn.closest('.toolbar-group');
  if (!infra) return;

  const mk = (id, label) => {
    const def = getBuildingDef(id);
    if (!def) return null;
    const btn = document.createElement('button');
    btn.dataset.tool     = 'building';
    btn.dataset.building = id;
    btn.textContent      = label;
    const providesStr = def.provides?.power_kw    ? `Provides: ${def.provides.power_kw} kW`
                      : def.provides?.water_units ? `Provides: ${def.provides.water_units} water units`
                      : '';
    btn.title = [def.name, `Cost: €${def.cost}`, `Upkeep: €${def.monthlyUpkeep}/mo`, providesStr]
      .filter(Boolean).join('\n');
    if ((def.unlockAtLevel ?? 1) > 1) btn.classList.add('locked');
    return btn;
  };

  // Insert generator_small immediately before the coal plant button
  const genBtn     = mk('generator_small',  'Diesel Gen');
  const solarBtn   = mk('solar_farm',       'Solar Farm');
  const nuclearBtn = mk('nuclear_plant',    'Nuclear');
  const smallPump  = mk('water_pump_small', 'Small Pump');

  if (genBtn)     infra.insertBefore(genBtn,     powerBtn);
  if (solarBtn)   powerBtn.after(solarBtn);
  if (nuclearBtn) solarBtn.after(nuclearBtn);
  if (smallPump)  infra.insertBefore(smallPump,  waterBtn);
  // Road is already last in the group — no reordering needed
}

function _setActiveTool(btn) {
  // Clear previous active
  document.querySelectorAll('#toolbar button.active').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const toolType = btn.dataset.tool;
  if (toolType === 'zone') {
    _activeTool = { type: 'zone', zoneType: btn.dataset.zone };
  } else if (toolType === 'building') {
    _activeTool = { type: 'building', buildingId: btn.dataset.building };
  } else if (toolType === 'demolish') {
    _activeTool = { type: 'demolish' };
  } else if (toolType === 'select') {
    _activeTool = { type: 'select' };
  }
}

/** Unlock toolbar buttons for the given city level. */
function _applyUnlocks(level) {
  document.querySelectorAll('#toolbar button[data-building]').forEach(btn => {
    const id  = btn.dataset.building;
    const def = getBuildingDef(id);
    if (def && def.unlockAtLevel <= level) {
      btn.classList.remove('locked');
      btn.title = btn.title.replace(/\s*\|\s*Lvl \d+/, '');
    }
  });
}

/**
 * Deselect the current tool (right-click cancels to select).
 */
export function resetTool() {
  const btn = document.querySelector('#toolbar [data-tool="select"]');
  if (btn) _setActiveTool(btn);
}

// ── HUD ──────────────────────────────────────────────────────────────────────

/**
 * Subscribe to city events and keep the HUD in sync.
 * @param {import('./city.js').City} city
 */
export function initHUD(city) {
  const refresh = (state) => _renderHUD(state, city);
  city.on('monthProcessed', refresh);
  city.on('stateChanged',   refresh);
  city.on('dayTick', (state) => _renderDate(state));

  // New-game hint: shown once, 3 seconds after start
  setTimeout(() => showNotification(
    'Start: place a Diesel Generator + Small Water Pump, zone R areas, connect with roads.',
    'info', 8000
  ), 3000);
}

function _renderHUD(state, city) {
  _setText('stat-money',    `💰 €${_fmt(state.money)}`);
  const net = state.lastMonthNet ?? 0;
  const netEl = document.getElementById('stat-monthly');
  if (netEl) {
    netEl.textContent = `📈 ${net >= 0 ? '+' : ''}€${_fmt(net)}/mo`;
    netEl.className   = 'stat ' + (net >= 0 ? 'ok' : 'warning');
  }
  _setText('stat-pop',      `👥 ${_fmt(state.population)}`);

  const pw = state.totalPowerAvailable, pn = state.totalPowerNeeded;
  const ww = state.totalWaterAvailable, wn = state.totalWaterNeeded;
  const powerEl = document.getElementById('stat-power');
  const waterEl = document.getElementById('stat-water');
  if (powerEl) {
    powerEl.textContent = `⚡ ${pn}/${pw} kW`;
    powerEl.className   = 'stat ' + (pw >= pn ? 'ok' : 'warning');
  }
  if (waterEl) {
    waterEl.textContent = `💧 ${wn}/${ww}`;
    waterEl.className   = 'stat ' + (ww >= wn ? 'ok' : 'warning');
  }

  _setText('stat-happiness', `😊 ${state.happiness}%`);
  _setText('stat-level',     `🏙️ Lvl ${state.cityLevel}`);

  // RCI bars + tooltips + min-floor badges
  const bd  = state.rciResult?.breakdown;
  const rD  = state.rciDemand?.R ?? 0;
  const cD  = state.rciDemand?.C ?? 0;
  const iD  = state.rciDemand?.I ?? 0;
  _setBarHeight('rci-r', rD);
  _setBarHeight('rci-c', cD);
  _setBarHeight('rci-i', iD);
  _updateRCITooltip('rci-bar-r', 'r', rD, bd?.r);
  _updateRCITooltip('rci-bar-c', 'c', cD, bd?.c);
  _updateRCITooltip('rci-bar-i', 'i', iD, bd?.i);
  _updateRCIMinBadge('rci-bar-r', rD, bd?.r);
  _updateRCIMinBadge('rci-bar-c', cD, bd?.c);
  _updateRCIMinBadge('rci-bar-i', iD, bd?.i);
}

// Maps each zone key (lowercase) to its factor keys in display order
const _RCI_FACTOR_LABELS = {
  r: [['job_availability', 'jobs'], ['happiness', 'happiness']],
  c: [['worker_supply', 'workers'], ['customer_base', 'customers'], ['supply_chain', 'supply']],
  i: [['worker_supply', 'workers'], ['market_demand', 'market']],
};

function _updateRCITooltip(wrapperId, zone, demand, scores) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;

  const floorActive = scores?.floor > 0 && demand <= scores.floor;
  const label = zone.toUpperCase();

  if (!scores) {
    wrap.title = `${label}: ${demand}${floorActive ? ' ↑min' : ''}`;
    return;
  }

  const parts = (_RCI_FACTOR_LABELS[zone] ?? []).map(([key, lbl]) => {
    const f = scores[key];
    return f != null ? `${lbl}: ${f.score.toFixed(2)}` : null;
  }).filter(Boolean);

  wrap.title = `${label}: ${demand}  |  ${parts.join('  ')}${floorActive ? '  ↑min' : ''}`;
}

/** Injects a small "↑min" badge next to an RCI bar when the bootstrap floor is active. */
function _updateRCIMinBadge(wrapperId, demand, scores) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  let badge = wrap.querySelector('.rci-min-badge');
  const isAtFloor = scores?.floor > 0 && demand <= scores.floor;
  if (isAtFloor) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'rci-min-badge';
      badge.textContent = '↑';
      wrap.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
}

function _renderDate(state) {
  const { day, month, year } = state.date;
  _setText('stat-date', `📅 Y${year} M${month} D${day}`);
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _setBarHeight(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.height = Math.max(2, Math.round(value)) + '%';
}

function _fmt(n) {
  return Math.round(n).toLocaleString();
}

// ── Debug Panel ──────────────────────────────────────────────────────────────

let _debugCity = null;

export function initDebugPanel(city) {
  _debugCity = city;
  const panel   = document.getElementById('debug-panel');
  const toggle  = document.getElementById('debug-toggle');
  const closeBtn = document.getElementById('debug-close');

  if (!panel || !toggle) return;

  // Start hidden; show toggle button
  panel.classList.add('hidden');

  toggle.addEventListener('click', () => {
    panel.classList.remove('hidden');
    toggle.classList.add('hidden');
    _refreshDebug();
  });
  closeBtn?.addEventListener('click', () => {
    panel.classList.add('hidden');
    toggle.classList.remove('hidden');
  });

  city.on('stateChanged',   _refreshDebug);
  city.on('monthProcessed', _refreshDebug);
  city.on('dayTick',        _refreshDebug);
}

function _refreshDebug() {
  const panel = document.getElementById('debug-panel');
  if (!panel || panel.classList.contains('hidden') || !_debugCity) return;

  const s     = _debugCity.getState();
  const stats = _debugCity.getDebugStats();
  const body  = document.getElementById('debug-body');
  if (!body) return;

  const row  = (label, value, cls = '') =>
    `<div class="dbg-row"><span class="dbg-label">${label}</span><span class="dbg-value ${cls}">${value}</span></div>`;
  const sect = (label) => `<div class="dbg-section">${label}</div>`;

  const bd      = s.rciResult?.breakdown ?? null;
  const tot     = bd?.totals ?? {};

  // Labour market values (Fix 8)
  const workers   = Math.round(tot.workers  ?? 0);
  const cJobs     = Math.round(tot.cJobs    ?? stats.cJobs  ?? 0);
  const iJobs     = Math.round(tot.iJobs    ?? stats.iJobs  ?? 0);
  const totalJobs = cJobs + iJobs;
  const balance   = workers - totalJobs;
  const le        = s.laborEfficiency ?? 1.0;

  let balanceHtml;
  if (balance > 0) {
    balanceHtml = `<div class="dbg-row"><span class="dbg-label">Balance</span><span class="dbg-value" style="color:#ffd54f">+${balance} unemployment</span></div>`;
  } else if (balance < 0) {
    balanceHtml = `<div class="dbg-row"><span class="dbg-label">Balance</span><span class="dbg-value" style="color:#ff9800">${Math.abs(balance)} unfilled jobs</span></div>`;
  } else {
    balanceHtml = row('Balance', 'Balanced', 'dbg-good');
  }

  // Per-factor notes for tooltip (Fix 7)
  const _factorNote = (zoneKey, factorKey, f, t) => {
    if (!f || !t) return '';
    const n = v => Math.round(v ?? 0);
    const fmt = v => (v ?? 0).toFixed(2);
    if (zoneKey === 'r') {
      if (factorKey === 'job_availability') return `effectiveJobs ${n(t.effectiveJobs)} / workers ${n(t.workers)} → ${fmt(f.score)}`;
      if (factorKey === 'happiness')        return `city ${n(t.cityHappiness)}% → ${fmt(f.score)}`;
    }
    if (zoneKey === 'c') {
      if (factorKey === 'worker_supply') return `workers ${n(t.workers)} / (C-jobs ${n(t.cJobs)} × 2) → ${fmt(f.score)}`;
      if (factorKey === 'customer_base') return `shoppers ${n(t.shoppers)} / (${n(t.cBldg)} shops × 20) → ${fmt(f.score)}`;
      if (factorKey === 'supply_chain')  return `supplied ${n(t.suppliedCBuildings)} / ${n(t.cBldg)} C-bldg → ${fmt(f.score)}`;
    }
    if (zoneKey === 'i') {
      if (factorKey === 'worker_supply') return `workers ${n(t.workers)} / (I-jobs ${n(t.iJobs)} × 2) → ${fmt(f.score)}`;
      if (factorKey === 'market_demand') return `${n(t.cBldg)} C-bldg / (${n(t.iBldg)} I-bldg × 5) → ${fmt(f.score)}`;
    }
    return '';
  };

  // Per-factor "Good?" thresholds (Fix 4)
  const _FACTOR_THRESHOLDS = {
    job_availability: 0.60,
    happiness:        0.50,
    worker_supply:    0.80,   // C and I — was 0.50, caused false green
    customer_base:    0.50,
    supply_chain:     0.70,
    market_demand:    0.50,
  };

  // RCI zone block: header + per-factor rows with scores
  const rciZoneRows = (zoneKey, demand) => {
    const zBd = bd?.[zoneKey];
    const zoneName = zoneKey.toUpperCase();
    if (!zBd) return row(zoneName, `${demand}%`);
    const floorActive = zBd.floor > 0 && demand <= zBd.floor;
    const factorRows = Object.entries(zBd)
      .filter(([, v]) => v !== null && typeof v === 'object' && 'score' in v)
      .map(([key, f]) => {
        const threshold = _FACTOR_THRESHOLDS[key] ?? 0.50;
        const good = f.score >= threshold ? '✓' : '✗';
        const cls  = f.score >= threshold ? 'dbg-good' : 'dbg-bad';
        const note = _factorNote(zoneKey, key, f, tot);
        return `<div class="dbg-row" title="${note}"><span class="dbg-label" style="padding-left:8px">${key} ×${f.weight}</span><span class="dbg-value ${cls}">${f.score.toFixed(2)} ${good}</span></div>`;
      }).join('');
    const floorRow = floorActive
      ? `<div class="dbg-row"><span class="dbg-label" style="padding-left:8px;color:#555">↑ bootstrap floor active</span></div>`
      : '';
    return row(zoneName, `${demand}%`) + factorRows + floorRow;
  };

  body.innerHTML = [
    sect('Population'),
    row('Residents',    `${Math.round(stats.population)}`),
    row('R fill (avg)', `${Math.round((stats.avgRFill ?? 0) * 100)}%`),

    sect('Labour Market'),
    row('Workers',          `${workers}`),
    row('C-jobs',           `${cJobs}`),
    row('I-jobs',           `${iJobs}`),
    row('Total jobs',       `${totalJobs}`),
    balanceHtml,
    row('Labor efficiency', `${Math.round(le * 100)}%`),
    (() => {
      const n = s.struggling ?? 0;
      if (n === 0) return row('Struggling bldgs', '0');
      return `<div class="dbg-row"><span class="dbg-label">Struggling bldgs</span><span class="dbg-value" style="color:#ff9800">${n}</span></div>`;
    })(),
    (() => {
      const n = s.abandoned ?? 0;
      if (n === 0) return row('Abandoned bldgs', '0');
      return `<div class="dbg-row"><span class="dbg-label">Abandoned bldgs</span><span class="dbg-value dbg-bad">${n}</span></div>`;
    })(),
    (() => {
      const pct = Math.round((s.laborDemandMultiplier ?? 1) * 100);
      if (pct >= 100) return row('C/I demand ×', `${pct}%`, 'dbg-good');
      if (pct >= 60)  return `<div class="dbg-row"><span class="dbg-label">C/I demand ×</span><span class="dbg-value" style="color:#ffd54f">${pct}%</span></div>`;
      return row('C/I demand ×', `${pct}%`, 'dbg-bad');
    })(),

    sect('Zones'),
    row('R', `${stats.rBuildings} bldg / ${stats.rZones} zoned`),
    row('C', `${stats.cBuildings} / ${stats.cZones}`),
    row('I', `${stats.iBuildings} / ${stats.iZones}`),

    sect('Infrastructure'),
    row('Power available',  `${Math.round(s.totalPowerAvailable)} kW`),
    row('Power needed',     `${Math.round(s.totalPowerNeeded)} kW`),
    row('Power surplus',    `${Math.round(s.totalPowerAvailable - s.totalPowerNeeded)} kW`,
        s.totalPowerAvailable >= s.totalPowerNeeded ? 'dbg-good' : 'dbg-bad'),
    row('Water available',  `${Math.round(s.totalWaterAvailable)}`),
    row('Water needed',     `${Math.round(s.totalWaterNeeded)}`),
    row('Water surplus',    `${Math.round(s.totalWaterAvailable - s.totalWaterNeeded)}`,
        s.totalWaterAvailable >= s.totalWaterNeeded ? 'dbg-good' : 'dbg-bad'),
    (() => {
      const ie = Math.round((s.infraEfficiency ?? 1) * 100);
      if (ie >= 100) return row('Infra efficiency', `${ie}%`, 'dbg-good');
      if (ie >= 50)  return `<div class="dbg-row"><span class="dbg-label">Infra efficiency</span><span class="dbg-value" style="color:#ffd54f">${ie}%</span></div>`;
      return row('Infra efficiency', `${ie}%`, 'dbg-bad');
    })(),

    sect('RCI Demand'),
    rciZoneRows('r', Math.round(s.rciDemand.R)),
    rciZoneRows('c', Math.round(s.rciDemand.C)),
    rciZoneRows('i', Math.round(s.rciDemand.I)),

    sect('Economy'),
    row('Balance',   `€${_fmt(s.money)}`),
    row('Last net',  `${s.lastMonthNet >= 0 ? '+' : ''}€${_fmt(s.lastMonthNet)}`, s.lastMonthNet >= 0 ? 'dbg-good' : 'dbg-bad'),
    row('Happiness', `${Math.round(s.happiness)}%`),
  ].join('');
}

// ── Info Panel ───────────────────────────────────────────────────────────────

/**
 * Display tile info in the top-right panel.
 * @param {object|null} tile  Tile object from Grid, or null to hide.
 */
export function showTileInfo(tile) {
  const panel = document.getElementById('info-panel');
  const title = document.getElementById('info-panel-title');
  const body  = document.getElementById('info-panel-body');
  if (!panel || !title || !body) return;

  if (!tile) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  const rows = [];

  if (tile.type === 'terrain') {
    title.textContent = 'Terrain';
    rows.push(['Type', tile.terrainType]);
  } else if (tile.type === 'empty') {
    title.textContent = 'Empty Land';
    rows.push(['Status', 'Available for zoning']);
    rows.push(['Road access', tile.connected ? 'Yes ✓' : 'No']);
  } else if (tile.type === 'road') {
    title.textContent = 'Road';
    rows.push(['Type', 'Infrastructure']);
  } else if (tile.type === 'zone' && !tile.building) {
    title.textContent = `${tile.zoneType} Zone (empty)`;
    rows.push(['Zone',         tile.zoneType]);
    rows.push(['Road access',  tile.connected ? 'Yes ✓' : 'No ✗']);
    rows.push(['Happiness',    `${Math.round(tile.happiness)}%`]);
  } else if (tile.building) {
    const b   = tile.building;
    const def = b.def;
    title.textContent = def.name;
    rows.push(['Category',    def.category]);
    if (tile.zoneType) rows.push(['Zone', tile.zoneType]);
    if (b.residents)   rows.push(['Residents', Math.round(b.residents)]);
    if (def.provides?.jobs) rows.push(['Jobs', def.provides.jobs]);
    rows.push(['Level',       b.level]);
    rows.push(['Upkeep',      `€${def.monthlyUpkeep}/mo`]);
    rows.push(['Road access',  tile.connected ? 'Yes ✓' : 'No ✗']);
    rows.push(['Happiness',    `${Math.round(tile.happiness)}%`]);
    if (def.description) rows.push(['Info', def.description]);
  }

  // Build the base HTML rows
  let html = rows.map(([label, value]) =>
    `<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`
  ).join('');

  // Fix 6: labor state detail for C and I buildings
  const b2 = tile.building;
  if (b2 && (b2.def?.zoneType === 'C' || b2.def?.zoneType === 'I')) {
    const ls = b2.laborState;

    if (ls === 'struggling') {
      html += `<div class="row"><span class="label">Status</span><span class="value" style="color:#ff9800">⚠ Struggling</span></div>`;
      html += `<div class="row"><span class="label">Cause</span><span class="value">Not enough workers</span></div>`;
      html += `<div class="row"><span class="label">Recovery</span><span class="value">Increase residential zones</span></div>`;
    } else if (ls === 'abandoned') {
      html += `<div class="row"><span class="label">Status</span><span class="value" style="color:#e57373">✖ Abandoned</span></div>`;
      html += `<div class="row"><span class="label">Cause</span><span class="value">Not enough workers</span></div>`;
      html += `<div class="row"><span class="label">Recovery</span><span class="value">Increase residential zones to attract workers</span></div>`;
    } else if (b2.recovering) {
      html += `<div class="row"><span class="label">Status</span><span class="value" style="color:#aed581">↑ Recovering</span></div>`;
      html += `<div class="row"><span class="label">Cause</span><span class="value">Workers returning — full recovery next month if efficiency holds</span></div>`;
    }
  }

  body.innerHTML = html;
}

// ── Notification toast ───────────────────────────────────────────────────────

let _notifTimer = null;

/**
 * Show a brief toast notification.
 * @param {string} message
 * @param {'info'|'error'|'levelup'} [type='info']
 * @param {number} [duration=2500]
 */
export function showNotification(message, type = 'info', duration = 2500) {
  const el = document.getElementById('notification');
  if (!el) return;
  if (_notifTimer) clearTimeout(_notifTimer);

  el.textContent  = message;
  el.className    = type === 'error' ? 'error' : type === 'levelup' ? 'levelup' : '';
  el.style.opacity = '1';
  el.classList.remove('hidden');

  _notifTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.classList.add('hidden'), 400);
  }, duration);
}

/**
 * Wire city 'levelUp' event to show a notification.
 * @param {import('./city.js').City} city
 */
export function initNotifications(city) {
  city.on('levelUp', ({ level, population }) => {
    showNotification(`🏙️ City Level ${level}! Population: ${_fmt(population)}`, 'levelup', 4000);
  });
}

// ── Speed controls ────────────────────────────────────────────────────────────

/**
 * Inject ⏸/▶/▶▶/▶▶▶ speed buttons into the toolbar and keep them in sync.
 * @param {import('./city.js').City} city
 */
export function initSpeedControls(city) {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;

  const group = document.createElement('div');
  group.className = 'toolbar-group';
  group.id = 'speed-group';
  group.innerHTML = `
    <span class="toolbar-label">Speed</span>
    <button data-speed="paused" title="Pause">⏸</button>
    <button data-speed="normal" title="Normal speed">▶</button>
    <button data-speed="fast"   title="Fast (3×)">▶▶</button>
    <button data-speed="faster" title="Fastest (5×)">▶▶▶</button>
  `;
  toolbar.appendChild(group);

  group.querySelectorAll('[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => city.setGameSpeed(btn.dataset.speed));
  });

  const syncHighlight = (state) => {
    group.querySelectorAll('[data-speed]').forEach(btn => {
      const active = state.isPaused
        ? btn.dataset.speed === 'paused'
        : btn.dataset.speed === state.gameSpeed;
      btn.classList.toggle('speed-active', active);
    });
  };

  city.on('speedChanged', syncHighlight);
  syncHighlight(city.getState());
}

// ── Pause menu ────────────────────────────────────────────────────────────────

let _wasAlreadyPaused = false;

/**
 * Wire the pause overlay: Esc to toggle, resume/new-game/save/load actions.
 * @param {import('./city.js').City} city
 */
export function initPauseMenu(city) {
  window.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    // If modal is open, close it instead.
    const modal = document.getElementById('modal-overlay');
    if (modal && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
      return;
    }
    const overlay = document.getElementById('pause-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('hidden')) {
      _showPauseMenu(city);
    } else {
      _hidePauseMenu(city);
    }
  });

  document.getElementById('btn-resume')?.addEventListener('click', () => _hidePauseMenu(city));

  document.getElementById('btn-save-expand')?.addEventListener('click', () =>
    _toggleSection('save-slots', 'load-slots', city, 'save'));

  document.getElementById('btn-load-expand')?.addEventListener('click', () =>
    _toggleSection('load-slots', 'save-slots', city, 'load'));

  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    document.getElementById('new-game-confirm')?.classList.remove('hidden');
  });
  document.getElementById('btn-new-game-cancel')?.addEventListener('click', () => {
    document.getElementById('new-game-confirm')?.classList.add('hidden');
  });
  document.getElementById('btn-new-game-confirm')?.addEventListener('click', () => {
    city.resetGame();
    _forceHidePauseMenu();
  });

  // Click on backdrop closes menu.
  document.getElementById('pause-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'pause-overlay') _hidePauseMenu(city);
  });
}

function _showPauseMenu(city) {
  _wasAlreadyPaused = city.getState().isPaused;
  if (!_wasAlreadyPaused) city.pauseGame();
  document.getElementById('pause-overlay')?.classList.remove('hidden');
  document.getElementById('save-slots')?.classList.add('hidden');
  document.getElementById('load-slots')?.classList.add('hidden');
  document.getElementById('new-game-confirm')?.classList.add('hidden');
}

function _hidePauseMenu(city) {
  _forceHidePauseMenu();
  if (!_wasAlreadyPaused) city.resumeGame();
}

function _forceHidePauseMenu() {
  document.getElementById('pause-overlay')?.classList.add('hidden');
}

function _toggleSection(showId, hideId, city, mode) {
  const show = document.getElementById(showId);
  const hide = document.getElementById(hideId);
  if (!show) return;
  hide?.classList.add('hidden');
  if (show.classList.contains('hidden')) {
    show.classList.remove('hidden');
    _renderSlots(show, city, mode);
  } else {
    show.classList.add('hidden');
  }
}

function _renderSlots(container, city, mode) {
  container.innerHTML = '';
  for (let slot = 1; slot <= 3; slot++) {
    const info = city.getSaveInfo(slot);
    const row  = document.createElement('div');
    row.className = 'slot-row';

    const label = document.createElement('div');
    label.className = 'slot-label';
    label.textContent = `Slot ${slot}`;

    const desc = document.createElement('div');
    desc.className = 'slot-desc';
    if (info.exists) {
      desc.textContent = `Pop: ${info.population ?? '?'} | Lvl ${info.cityLevel ?? '?'} | ${info.date ?? ''}`;
    } else {
      desc.textContent = 'Empty';
    }

    const btn = document.createElement('button');
    btn.className = 'slot-action-btn';

    if (mode === 'save') {
      btn.textContent = info.exists ? 'Overwrite' : 'Save';
      btn.addEventListener('click', () => {
        const result = city.saveGame(slot);
        if (result.success) _renderSlots(container, city, mode);
      });
    } else {
      btn.textContent = 'Load';
      btn.disabled = !info.exists;
      if (info.exists) {
        btn.addEventListener('click', () => {
          city.loadGame(slot);
          _forceHidePauseMenu();
        });
      }
    }

    row.append(label, desc, btn);
    container.appendChild(row);
  }
}
