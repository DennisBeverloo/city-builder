/**
 * @module city
 * City state, simulation loop, RCI demand logic, save/load, and speed control.
 * No Three.js. Communicates outward via EventEmitter callbacks.
 *
 * Simulation cadence:
 *   Every 6 game-hours → _updateSimulation (pop/power/water/happiness/RCI/auto-spawn)
 *   Every 30 game-days → _advanceMonth (taxes + upkeep + autosave)
 */
import { BUILDINGS, UPGRADE_REQS } from './buildings.js';
import { processMonth } from './economy.js';

// ── Minimal EventEmitter ─────────────────────────────────────────────────────

export class EventEmitter {
  constructor() { this._listeners = Object.create(null); }
  on(event, fn)  { (this._listeners[event] ??= []).push(fn); return this; }
  off(event, fn) {
    const l = this._listeners[event];
    if (l) this._listeners[event] = l.filter(f => f !== fn);
  }
  emit(event, data) { (this._listeners[event] ?? []).forEach(fn => fn(data)); }
  /** Emit both stateChanged and layoutChanged (road/building layout altered). */
  _emitLayout() { const s = this.getState(); this.emit('stateChanged', s); this.emit('layoutChanged', s); }
}

// ── Speed presets ────────────────────────────────────────────────────────────

/** Milliseconds per game hour for each speed preset (0 = paused). */
export const SPEED_PRESETS = {
  paused: 0,
  normal: 1000,   // 1× — 1s/hr, 24s/day, watch traffic
  fast:    250,   // 4× — 6s/day
  faster:   83,   // 12× — ~2s/day (≈ old normal feel)
};

// CAPACITY PLANNING REFERENCE
// Target: self-sustaining city at 500 residents
// ~84 R buildings:  84 × power 1  =  84 kW,  84 × water 1  =  84 units
// ~105 C buildings: 105 × power 2 = 210 kW, 105 × water 1 = 105 units
// ~21 I buildings:   21 × power 5 = 105 kW,  21 × water 3 =  63 units
// Total at 500 pop: ~399 kW, ~252 water units

// ── Simulation config ────────────────────────────────────────────────────────

/** Exported so economy.js and grid.js can read values via parameter passing. */
export const SIMULATION_CONFIG = {
  residentAdultRatio:        0.60,
  cBuildingWorkers:          3,
  iBuildingWorkers:          10,
  rBuildingCapacity:         6,
  cSupplyRatio:              5,
  cUndersupplyEfficiency:    0.50,
  cShoppersPerBuilding:      35,
  fillGrowthRatePerMonth:    0.40,  // applied daily as 1/30 fraction for smooth growth
  industryPollutionRadius:   6,
  industryPollutionStrength: 40,
};

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_THRESHOLDS  = [0, 500, 1500, 3000, 6000, 12000, 25000, 50000, 100_000, 250_000];
const SIM_TICK_HOURS    = 6;   // _updateSimulation runs every N game-hours
const SAVE_VERSION      = 2;

// ── Initial state factory ─────────────────────────────────────────────────────

function _makeInitialState() {
  return {
    cityName:            'My City',
    money:               100_000,
    population:          0,
    happiness:           50,
    cityLevel:           1,
    date:                { day: 1, month: 1, year: 1 },
    totalPowerNeeded:    0,
    totalPowerAvailable: 0,
    totalWaterNeeded:    0,
    totalWaterAvailable: 0,
    rciDemand:           { R: 50, C: 30, I: 20 },
    lastMonthNet:        0,
    lastDayNet:          0,
    totalCommercialJobs:       0,
    totalIndustrialJobs:       0,
    totalCommercialBuildings:  0,
    totalIndustrialBuildings:  0,
    totalResidentialTiles:     0,
    emptyResidentialZoneTiles: 0,
    avgRFill:                  0,
    laborEfficiency:           1.0,
    infraEfficiency:           1.0,
    rciResult:                 null,
    workerShortageRatio:       1.0,
    laborDemandMultiplier:     1.0,
    struggling:                0,
    abandoned:                 0,
    // Speed / pause
    gameSpeed:    'normal',
    isPaused:     false,
    prePauseSpeed: 'normal',
    // Time of day
    gameHour:     0,
  };
}

// ── City ─────────────────────────────────────────────────────────────────────

export class City extends EventEmitter {
  /** @param {import('./grid.js').Grid} grid */
  constructor(grid) {
    super();
    this._grid = grid;
    this._state = _makeInitialState();
    this._rciBreakdown = null;
    this._bootstrapSpawnedThisMonth = { R: false, C: false, I: false };
    this._hourTimer = 0;
    this._hourMs    = SPEED_PRESETS.normal;
    this._dailyNetAccum = 0;
  }

  // ── Public getters ───────────────────────────────────────────────

  getState()        { return { ...this._state }; }
  getDebugStats()   { return this._grid.getStats(); }
  getRCIBreakdown() { return this._rciBreakdown; }
  getGameHour()     { return this._state.gameHour; }

  getSpeedMultiplier() {
    if (this._state.isPaused) return 0;
    const msPerHour = this._hourMs;
    return msPerHour > 0 ? 1000 / msPerHour : 0; // 1× = 1.0, 4× = 4.0, etc.
  }

  getCityName() { return this._state.cityName ?? 'My City'; }
  setCityName(name) {
    this._state.cityName = String(name).trim().slice(0, 40) || 'My City';
  }

  // ── Game speed control ───────────────────────────────────────────

  /**
   * Set the simulation speed.
   * @param {'paused'|'normal'|'fast'|'faster'} preset
   */
  setGameSpeed(preset) {
    if (!(preset in SPEED_PRESETS)) return;
    this._state.gameSpeed = preset;
    if (preset === 'paused') {
      this._state.isPaused = true;
    } else {
      this._state.isPaused = false;
      this._hourMs    = SPEED_PRESETS[preset];
      this._hourTimer = 0;  // avoid time-debt jump on unpause
    }
    this.emit('speedChanged', this.getState());
  }

  /** Pause and remember current speed for resumeGame(). */
  pauseGame() {
    if (!this._state.isPaused) {
      this._state.prePauseSpeed = this._state.gameSpeed;
    }
    this.setGameSpeed('paused');
  }

  /** Resume at the speed that was active before pauseGame(). */
  resumeGame() {
    this.setGameSpeed(this._state.prePauseSpeed ?? 'normal');
  }

  /** Toggle between paused and running. */
  togglePause() {
    if (this._state.isPaused) this.resumeGame();
    else this.pauseGame();
  }

  // ── Main loop ────────────────────────────────────────────────────

  /** @param {number} dt milliseconds */
  tick(dt) {
    if (this._state.isPaused) return;
    this._hourTimer += dt;
    if (this._hourTimer >= this._hourMs) {
      this._hourTimer -= this._hourMs;
      this._advanceHour();
    }
  }

  _advanceHour() {
    this._state.gameHour = (this._state.gameHour + 1) % 24;

    // Run simulation every SIM_TICK_HOURS game-hours (e.g. every 6 hrs = 6s at 1×)
    if (this._state.gameHour % SIM_TICK_HOURS === 0) {
      const stats = this._grid.getStats();
      const { power, water } = this._calcPowerWater(stats.allBuildings);
      this._updateSimulation(stats, power, water);
    }

    if (this._state.gameHour === 0) {
      this._advanceDay();
    }
    this.emit('hourTick', this.getState());
  }

  _advanceDay() {
    const d = this._state.date;
    d.day++;
    const isMonthEnd = d.day > 30;

    if (isMonthEnd) {
      const { upgrades, blocked, unblocked } = this._grid.runMonthlyTileCalcs(SIMULATION_CONFIG);
      for (const u of upgrades) {
        const oldMesh = this._grid.executeUpgrade(u.anchorX, u.anchorZ, u.newId, u.plot);
        this.emit('buildingUpgraded', { anchorX: u.anchorX, anchorZ: u.anchorZ, oldMesh, newId: u.newId });
      }
      for (const b of blocked)   this.emit('buildingUpgradeBlocked',   { anchorX: b.anchorX, anchorZ: b.anchorZ });
      for (const u of unblocked) this.emit('buildingUpgradeUnblocked', { anchorX: u.anchorX, anchorZ: u.anchorZ });
    }

    // Grow residential fill percentages every day (1/30 of monthly rate)
    this._updateFillPercentages(SIMULATION_CONFIG.fillGrowthRatePerMonth / 30);

    // Daily economy tick every day
    this._dailyEconTick();

    if (isMonthEnd) {
      d.day = 1;
      this._advanceMonth();
    } else {
      this.emit('dayTick', this.getState());
    }
  }

  _updateSimulation(stats, power, water) {
    this._state.totalPowerNeeded    = power.needed;
    this._state.totalPowerAvailable = power.available;
    this._state.totalWaterNeeded    = water.needed;
    this._state.totalWaterAvailable = water.available;

    const powerRatio = power.available / Math.max(power.needed, 1);
    const waterRatio = water.available / Math.max(water.needed, 1);
    this._state.infraEfficiency = Math.max(0.2, Math.min(1.0, Math.min(powerRatio, waterRatio)));

    this._state.population = stats.population;
    this._state.happiness  = this._calcHappiness(power, water);

    const CFG = SIMULATION_CONFIG;
    let activeC = 0, activeI = 0;
    for (const b of stats.allBuildings) {
      if (b.def?.zoneType === 'C' && b.laborState !== 'abandoned') activeC++;
      if (b.def?.zoneType === 'I' && b.laborState !== 'abandoned') activeI++;
    }
    this._state.totalCommercialJobs       = activeC * CFG.cBuildingWorkers;
    this._state.totalIndustrialJobs       = activeI * CFG.iBuildingWorkers;
    this._state.totalCommercialBuildings  = stats.cBuildings;
    this._state.totalIndustrialBuildings  = stats.iBuildings;
    this._state.totalResidentialTiles     = stats.rZones;
    this._state.emptyResidentialZoneTiles = stats.rZones - stats.rBuildings;
    this._state.avgRFill                  = stats.avgRFill;

    const rciResult = this._calculateRCIDemand(stats);
    this._state.rciDemand             = { R: rciResult.rDemand, C: rciResult.cDemand, I: rciResult.iDemand };
    this._state.rciResult             = rciResult;
    this._state.laborEfficiency       = rciResult.breakdown.r.laborEfficiency;
    this._state.workerShortageRatio   = rciResult.breakdown.totals.workerShortageRatio;
    this._state.laborDemandMultiplier = rciResult.breakdown.totals.laborDemandMultiplier;
    this._autoSpawn(power, water, stats);
    this._checkLevelUp();

    this.emit('stateChanged', this.getState());
  }

  _advanceMonth() {
    this._updateLaborStates();

    // Reset daily accumulator for new month
    this._dailyNetAccum = 0;

    this._bootstrapSpawnedThisMonth = { R: false, C: false, I: false };

    const d = this._state.date;
    d.month++;
    if (d.month > 12) { d.month = 1; d.year++; }

    // Autosave (silently) after each month
    const _as = this.saveGame('autosave');
    if (!_as.success) console.warn('Autosave failed:', _as.error);

    this.emit('monthProcessed', { ...this.getState() });
    this.emit('dayTick', this.getState());
  }

  _dailyEconTick() {
    // Run the same economic calculation as _advanceMonth but divide by 30
    const stats = this._grid.getStats();
    const result = processMonth(stats.allBuildings, SIMULATION_CONFIG);
    // Apply same efficiency multipliers as _advanceMonth
    const le = this._state.laborEfficiency ?? 1.0;
    const ie = this._state.infraEfficiency ?? 1.0;
    // Apply abandoned building deductions (same logic as _advanceMonth)
    const CFG = SIMULATION_CONFIG;
    const allB = stats.allBuildings;
    const totC = allB.filter(b => b.def?.zoneType === 'C').length;
    const totI = allB.filter(b => b.def?.zoneType === 'I').length;
    const supC = Math.min(totC, totI * CFG.cSupplyRatio);
    const supR = totC > 0 ? supC / totC : 1.0;
    const cTM  = CFG.cUndersupplyEfficiency + (1 - CFG.cUndersupplyEfficiency) * supR;
    for (const b of allB) {
      if (b.laborState !== 'abandoned') continue;
      const pa = (b.plotWidth ?? 1) * (b.plotDepth ?? 1);
      if (b.def?.zoneType === 'C') result.breakdown.commercialTax  -= 50 * cTM * pa;
      if (b.def?.zoneType === 'I') result.breakdown.industrialTax  -= 80 * (b.fillPercentage ?? 1.0) * pa;
    }
    result.breakdown.commercialTax = Math.max(0, result.breakdown.commercialTax);
    result.breakdown.industrialTax = Math.max(0, result.breakdown.industrialTax);
    result.breakdown.commercialTax *= le;
    result.breakdown.industrialTax *= le;
    result.breakdown.residentialTax *= ie;
    result.breakdown.commercialTax  *= ie;
    result.breakdown.industrialTax  *= ie;
    result.income = result.breakdown.residentialTax + result.breakdown.commercialTax + result.breakdown.industrialTax;
    result.net = result.income - result.expenses;
    // Full monthly amount applied every game day
    const dailyNet = result.net;
    this._state.money += dailyNet;
    this._state.lastDayNet = dailyNet;
  }

  // ── Save / Load ───────────────────────────────────────────────────

  _saveKey(slot) {
    return slot === 'autosave' ? 'citybuilder_autosave' : `citybuilder_save_${slot}`;
  }

  /**
   * Persist the current city to a localStorage slot.
   * @param {1|2|3|'autosave'} slot
   * @returns {{ success: boolean, savedAt?: string, error?: string }}
   */
  saveGame(slot) {
    const key = this._saveKey(slot);
    try {
      // Sparse grid encoding: only save tiles that differ from the default
      // empty state. This cuts file size by ~80% on typical cities.
      const gridData = [];
      for (const tile of this._grid.getAllTiles()) {
        const isDefault = tile.type === 'empty' && !tile.zoneType &&
                          !tile.terrainType && !tile.isBridge &&
                          !tile.trafficLight && !tile.building;
        if (isDefault) continue;

        const t = { x: tile.x, z: tile.z };
        if (tile.type !== 'empty')  t.type        = tile.type;
        if (tile.zoneType)          t.zoneType     = tile.zoneType;
        if (tile.terrainType)       t.terrainType  = tile.terrainType;
        if (tile.isBridge)          t.isBridge     = true;
        if (tile.trafficLight)      t.trafficLight = true;

        if (tile.building) {
          const b = tile.building;
          const bd = { type: b.id };
          if (b.residents)        bd.residents       = b.residents;
          if (b.jobs)             bd.jobs            = b.jobs;
          if (b.level)            bd.level           = b.level;
          if (b.laborState)       bd.laborState      = b.laborState;
          if (b.laborStateTurns)  bd.laborStateTurns = b.laborStateTurns;
          if (b.recovering)       bd.recovering      = b.recovering;
          if (b.plotWidth  > 1)   bd.plotWidth       = b.plotWidth;
          if (b.plotDepth  > 1)   bd.plotDepth       = b.plotDepth;
          if (b.plotRoadDir)      bd.plotRoadDir     = b.plotRoadDir;
          if (b.rotation)         bd.rotation        = b.rotation;
          if (b.plotTiles?.length) {
            bd.plotTiles = b.plotTiles.map(pt => ({ x: pt.x, z: pt.z }));
          }
          if (b.upgradeTimer)   bd.upgradeTimer   = b.upgradeTimer;
          if (b.upgradeBlocked) bd.upgradeBlocked = true;
          t.building = bd;
        }
        gridData.push(t);
      }

      const savedAt = new Date().toISOString();
      const save = {
        version:  SAVE_VERSION,
        savedAt,
        cityName: this._state.cityName ?? 'My City',
        snapshot: { ...this._state },
        grid:     gridData,
      };

      localStorage.setItem(key, JSON.stringify(save));
      return { success: true, savedAt };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * Load a previously saved game. Emits 'gameLoaded' for scene rebuild.
   * @param {1|2|3|'autosave'} slot
   * @returns {{ success: boolean, error?: string }}
   */
  /**
   * Internal: apply a parsed save object to the live game state.
   * Accepts any save version ≤ SAVE_VERSION (backward-compatible with v1).
   * Emits 'gameLoaded', 'stateChanged', 'dayTick' on success.
   */
  _applyGameData(save) {
    // Accept both the current and any older version (never reject saves that
    // are older than the current format — they load fine because we reset all
    // tiles to defaults first and then apply only what's in the save array).
    if (!save.version || save.version > SAVE_VERSION)
      return { success: false, error: `Incompatible save format (version ${save.version ?? '?'})` };

    try {
      // Collect current forest tiles (for scene to clear old tree meshes)
      const oldForestTiles = this._grid.getAllTiles()
        .filter(t => t.terrainType === 'forest')
        .map(t => ({ x: t.x, z: t.z }));

      // Collect old building meshes before clearing tile.building
      const oldMeshes = [];
      const _seenB = new Set();
      for (const t of this._grid.getAllTiles()) {
        const b = t.building;
        if (!b || _seenB.has(b)) continue;
        _seenB.add(b);
        if (b.mesh)       oldMeshes.push(b.mesh);
        if (b.gardenMesh) oldMeshes.push(b.gardenMesh);
        if (b.garageMesh) oldMeshes.push(b.garageMesh);
      }

      // Restore city state (unpause on load)
      const snap = save.snapshot ?? {};
      Object.assign(this._state, snap);
      this._state.isPaused = false;
      const resumeSpeed = (snap.gameSpeed && snap.gameSpeed !== 'paused') ? snap.gameSpeed : 'normal';
      this._state.gameSpeed = resumeSpeed;
      this._hourMs    = SPEED_PRESETS[resumeSpeed] ?? SPEED_PRESETS.normal;
      this._hourTimer = 0;
      this._rciBreakdown = snap.rciResult?.breakdown ?? null;
      this._bootstrapSpawnedThisMonth = { R: false, C: false, I: false };
      this._dailyNetAccum = 0;
      if (save.cityName) this._state.cityName = save.cityName;

      // Reset every tile to empty defaults, then apply sparse save array
      for (const tile of this._grid.getAllTiles()) {
        tile.type         = 'empty';
        tile.zoneType     = null;
        tile.terrainType  = null;
        tile.isBridge     = false;
        tile.trafficLight = false;
        tile.connected    = false;
        tile.building     = null;
        tile.desirability    = 0;
        tile.pollution       = 0;
        tile.happiness       = 50;
        tile.landValue       = 0;
        tile.serviceCoverage = { police: 0, fire: 0, hospital: 0, education: 0, parks: 0 };
      }

      for (const saved of save.grid) {
        const tile = this._grid.getTile(saved.x, saved.z);
        if (!tile) continue;

        tile.type         = saved.type        ?? 'empty';
        tile.zoneType     = saved.zoneType    ?? null;
        tile.terrainType  = saved.terrainType ?? null;
        tile.isBridge     = saved.isBridge    ?? false;
        tile.trafficLight = saved.trafficLight ?? false;

        if (saved.building) {
          const def = BUILDINGS[saved.building.type];
          if (def) {
            tile.building = {
              id:              saved.building.type,
              def,
              mesh:            null,
              gardenMesh:      null,
              garageMesh:      null,
              fillPercentage:  def.zoneType ? 0.1 : 1.0,
              residents:       saved.building.residents       ?? 0,
              jobs:            saved.building.jobs            ?? (def.provides?.jobs || 0),
              level:           saved.building.level           ?? 1,
              tileX:           saved.x,
              tileZ:           saved.z,
              laborState:      saved.building.laborState      ?? 'ok',
              laborStateTurns: saved.building.laborStateTurns ?? 0,
              recovering:      saved.building.recovering      ?? false,
              baseColor:       def.color,
              plotWidth:       saved.building.plotWidth       ?? null,
              plotDepth:       saved.building.plotDepth       ?? null,
              plotRoadDir:     saved.building.plotRoadDir     ?? null,
              plotTiles:       saved.building.plotTiles       ?? null,
              rotation:        saved.building.rotation        ?? 0,
              upgradeTimer:    saved.building.upgradeTimer    ?? 0,
              upgradeBlocked:  saved.building.upgradeBlocked  ?? false,
            };
          }
        }
      }

      // Link satellite tiles to their anchor's building object (multi-tile support)
      for (const tile of this._grid.getAllTiles()) {
        if (!tile.building) continue;
        const { tileX, tileZ } = tile.building;
        if (tile.x !== tileX || tile.z !== tileZ) {
          const anchor = this._grid.getTile(tileX, tileZ);
          if (anchor?.building) tile.building = anchor.building;
        }
      }

      // Recalculate derived grid data
      this._grid.calculateRoadAccess();
      this._grid.recalculateServiceEffects();

      // Signal main.js to rebuild the Three.js scene
      this.emit('gameLoaded', { oldForestTiles, oldMeshes });
      this.emit('stateChanged', this.getState());
      this.emit('dayTick',      this.getState());

      return { success: true };
    } catch (e) {
      console.error('_applyGameData error:', e);
      return { success: false, error: e.message };
    }
  }

  loadGame(slot) {
    const key = this._saveKey(slot);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { success: false, error: 'No save found' };
      const save = JSON.parse(raw);
      return this._applyGameData(save);
    } catch (e) {
      console.error('loadGame error:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Return lightweight save metadata for slot-picker UI.
   * @param {1|2|3|'autosave'} slot
   * @returns {{ exists, savedAt, population, cityLevel, date }}
   */
  getSaveInfo(slot) {
    const key = this._saveKey(slot);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { exists: false, savedAt: null, population: null, cityLevel: null, date: null };
      const save = JSON.parse(raw);
      const s = save.snapshot ?? {};
      const d = s.date;
      return {
        exists:     true,
        savedAt:    save.savedAt ?? null,
        population: s.population  ?? null,
        cityLevel:  s.cityLevel   ?? null,
        date:       d ? `Y${d.year} M${d.month} D${d.day}` : null,
      };
    } catch {
      return { exists: false, savedAt: null, population: null, cityLevel: null, date: null };
    }
  }

  /** Export a save slot as a JSON string for file download. */
  exportSave(slot) {
    const key  = this._saveKey(slot);
    const data = localStorage.getItem(key);
    return data ?? null;
  }

  /**
   * Import a save from a JSON string (file upload).
   * Accepts any version ≤ SAVE_VERSION (including v1 large-format saves).
   * After applying, re-saves to slot 1 with current sparse encoding so future
   * saves don't hit QuotaExceededError.
   */
  importSave(jsonString) {
    let obj;
    try { obj = JSON.parse(jsonString); }
    catch { return { success: false, error: 'Invalid file: not valid JSON.' }; }
    if (!obj?.version) return { success: false, error: 'Invalid save file: missing version.' };
    if (obj.version > SAVE_VERSION)
      return { success: false, error: `Save is from a newer game version (v${obj.version}). Please update the game.` };

    // Apply directly from the parsed object — never writes the raw (possibly huge)
    // JSON to localStorage, avoiding QuotaExceededError from old bloated saves.
    const result = this._applyGameData(obj);
    if (!result.success) return result;

    // Re-persist with current sparse encoding so future autosaves stay small.
    const reEncoded = this.saveGame(1);
    if (!reEncoded.success) console.warn('Import: re-save to slot 1 failed:', reEncoded.error);
    return { success: true };
  }

  /**
   * Reset to a fresh new game. Emits 'gameReset' for scene rebuild and terrain regeneration.
   */
  resetGame() {
    // Collect current forest tiles and building meshes before clearing
    const oldForestTiles = this._grid.getAllTiles()
      .filter(t => t.terrainType === 'forest')
      .map(t => ({ x: t.x, z: t.z }));

    const oldMeshes = [];
    const _seenBuildings = new Set();
    for (const t of this._grid.getAllTiles()) {
      const b = t.building;
      if (!b || _seenBuildings.has(b)) continue;
      _seenBuildings.add(b);
      if (b.mesh)       oldMeshes.push(b.mesh);
      if (b.gardenMesh) oldMeshes.push(b.gardenMesh);
      if (b.garageMesh) oldMeshes.push(b.garageMesh);
    }

    // Reset city state
    this._state = _makeInitialState();
    this._rciBreakdown = null;
    this._bootstrapSpawnedThisMonth = { R: false, C: false, I: false };
    this._hourTimer = 0;
    this._hourMs    = SPEED_PRESETS.normal;
    this._dailyNetAccum = 0;

    // Reset all tile data (keep tile.mesh — the Three.js floor plane)
    for (const tile of this._grid.getAllTiles()) {
      tile.type        = 'empty';
      tile.zoneType    = null;
      tile.terrainType = null;
      tile.isBridge    = false;
      tile.building    = null;
      tile.connected   = false;
      tile.happiness        = 50;
      tile.desirability     = 0;
      tile.pollution        = 0;
      tile.landValue        = 0;
      tile.serviceCoverage  = { police: 0, fire: 0, hospital: 0, education: 0, parks: 0 };
    }

    this.emit('gameReset', { oldForestTiles, oldMeshes });
    this.emit('stateChanged', this.getState());
    this.emit('dayTick',      this.getState());
  }

  // ── Lightweight stats refresh ────────────────────────────────────

  _refreshResourceStats() {
    const stats = this._grid.getStats();
    const { power, water } = this._calcPowerWater(stats.allBuildings);
    this._state.totalPowerNeeded    = power.needed;
    this._state.totalPowerAvailable = power.available;
    this._state.totalWaterNeeded    = water.needed;
    this._state.totalWaterAvailable = water.available;
    const powerRatio = power.available / Math.max(power.needed, 1);
    const waterRatio = water.available / Math.max(water.needed, 1);
    this._state.infraEfficiency = Math.max(0.2, Math.min(1.0, Math.min(powerRatio, waterRatio)));
    this._state.population      = stats.population;
  }

  // ── Power / water summation ──────────────────────────────────────

  _calcPowerWater(allBuildings) {
    let powerAvail = 0, powerNeeded = 0;
    let waterAvail = 0, waterNeeded = 0;
    for (const b of allBuildings) {
      const def = b.def;
      if (!def) continue;
      powerAvail += def.provides?.power_kw    || 0;
      waterAvail += def.provides?.water_units || 0;
      if (b.laborState === 'abandoned') continue;
      const fill = def.zoneType ? (b.fillPercentage ?? 1.0) : 1.0;
      powerNeeded += (def.requires?.power || 0) * fill;
      waterNeeded += (def.requires?.water || 0) * fill;
    }
    return {
      power: { available: Math.round(powerAvail), needed: Math.round(powerNeeded) },
      water: { available: Math.round(waterAvail), needed: Math.round(waterNeeded) },
    };
  }

  // ── Fill percentages ─────────────────────────────────────────────

  _updateFillPercentages(rate) {
    const { rBuildingCapacity } = SIMULATION_CONFIG;
    for (const t of this._grid.getAllTiles()) {
      const b = t.building;
      if (!b || !b.def.zoneType) continue;
      // Only update on the anchor tile to avoid processing the same plot multiple times
      if (t.x !== b.tileX || t.z !== b.tileZ) continue;
      // Low-density houses (plot-based R) are instantly occupied at placement — leave them alone.
      if (b.def.zoneType === 'R' && (b.def.size === 1 || b.plotTiles)) continue;
      const prev = b.fillPercentage ?? 0.1;
      b.fillPercentage = Math.min(1.0, prev + rate * (1.0 - prev));
      if (b.def.zoneType === 'R') {
        const plotArea = (b.plotWidth ?? 1) * (b.plotDepth ?? 1);
        b.residents = rBuildingCapacity * plotArea * b.fillPercentage;
      }
    }
  }

  // ── Happiness ────────────────────────────────────────────────────

  _calcHappiness(power, water) {
    const tiles = this._grid.getAllTiles()
      .filter(t => t.type === 'zone' && t.zoneType === 'R' && t.building);
    let base = tiles.length > 0
      ? tiles.reduce((s, t) => s + t.happiness, 0) / tiles.length
      : 50;
    if (power.available < power.needed) base -= 15;
    if (water.available < water.needed) base -= 15;
    return Math.max(0, Math.min(100, Math.round(base)));
  }

  // ── RCI demand ───────────────────────────────────────────────────

  _calculateRCIDemand(stats) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const CFG   = SIMULATION_CONFIG;

    const res       = stats.population;
    const workers   = res * CFG.residentAdultRatio;
    const shoppers  = res;
    const cBldg     = stats.cBuildings;
    const iBldg     = stats.iBuildings;
    const cJobs     = cBldg * CFG.cBuildingWorkers;
    const iJobs     = iBldg * CFG.iBuildingWorkers;
    const totalJobs = cJobs + iJobs + (stats.serviceJobs || 0);
    const rTiles    = stats.rZones;

    const laborEfficiency       = clamp(workers / Math.max(totalJobs, 1), 0.0, 1.0);
    const effectiveJobs         = totalJobs * laborEfficiency;
    const workerShortageRatio   = laborEfficiency;
    const laborDemandMultiplier = Math.pow(workerShortageRatio, 1.5);

    const jobRatio     = effectiveJobs / Math.max(workers, 1);
    const jobAvail     = clamp(jobRatio / 1.5, 0, 1);
    const happinessScr = this._state.happiness / 100;
    const rRaw         = jobAvail * 0.60 + happinessScr * 0.40;

    let workerC = clamp(workers / Math.max(cJobs * 2, 1), 0, 1);
    if (workers < cJobs * 0.5) workerC *= 0.3;

    const customerBase = res === 0 ? 0
      : clamp(shoppers / Math.max(cBldg * (CFG.cShoppersPerBuilding * 0.5), 1), 0, 1);

    let supplyChain;
    let suppliedCBuildings = 0;
    if (cBldg === 0) {
      supplyChain = 1.0;
    } else if (iBldg === 0) {
      supplyChain = 0.10;
    } else {
      suppliedCBuildings = Math.min(iBldg * CFG.cSupplyRatio, cBldg);
      supplyChain = suppliedCBuildings / cBldg;
    }

    const cRaw = customerBase * 0.55 + supplyChain * 0.30 + workerC * 0.15;

    let workerI = clamp(workers / Math.max(iJobs * 2, 1), 0, 1);
    if (workers < iJobs * 0.5) workerI *= 0.3;

    let marketDemand;
    if (iBldg === 0) {
      marketDemand = 1.0;
    } else if (cBldg === 0) {
      marketDemand = 0.10;
    } else {
      const supplyRatio = (iBldg * CFG.cSupplyRatio) / cBldg;
      marketDemand = clamp(1.0 / supplyRatio, 0.1, 1.0);
    }

    const iRaw = marketDemand * 0.75 + workerI * 0.25;

    let rScore = clamp(rRaw * 100, 0, 100);
    let cScore = clamp(cRaw * 100, 0, 100);
    let iScore = clamp(iRaw * 100, 0, 100);

    cScore *= laborDemandMultiplier;
    iScore *= laborDemandMultiplier;

    const rFloor = (cBldg > 0 || iBldg > 0) ? 10 : 0;
    let   cFloor = rTiles > 0 ? 10 : 0;
    if (iBldg > 0 && cBldg === 0) cFloor = 15;
    let   iFloor = rTiles > 0 ? 10 : 0;
    if (cBldg > 0 && iBldg === 0) iFloor = 15;

    rScore = Math.max(rScore, rFloor);
    cScore = Math.max(cScore, cFloor);
    iScore = Math.max(iScore, iFloor);

    const jobSurplusRatio = clamp(totalJobs / Math.max(workers, 1), 1, 3);
    const rDemandBonus    = (jobSurplusRatio - 1) / 2;
    rScore = clamp(rScore + rDemandBonus * 100, rFloor, 100);

    const rDemand = Math.round(rScore);
    const cDemand = Math.round(cScore);
    const iDemand = Math.round(iScore);

    const result = {
      rDemand, cDemand, iDemand,
      breakdown: {
        r: {
          job_availability: { score: jobAvail,     weight: 0.60 },
          happiness:        { score: happinessScr, weight: 0.40 },
          floor:            rFloor,
          laborEfficiency,
        },
        c: {
          customer_base: { score: customerBase, weight: 0.55 },
          supply_chain:  { score: supplyChain,  weight: 0.30 },
          worker_supply: { score: workerC,      weight: 0.15 },
          floor:         cFloor,
        },
        i: {
          market_demand: { score: marketDemand, weight: 0.75 },
          worker_supply: { score: workerI,      weight: 0.25 },
          floor:         iFloor,
        },
        totals: {
          workers, shoppers, cJobs, iJobs, serviceJobs: stats.serviceJobs || 0, totalJobs,
          effectiveJobs, cBldg, iBldg, suppliedCBuildings,
          cityHappiness: this._state.happiness,
          workerShortageRatio, laborDemandMultiplier,
        },
      },
    };

    this._rciBreakdown = result.breakdown;
    return result;
  }

  // ── Per-building labor state ─────────────────────────────────────

  _initCIBuilding(b) {
    if (!b) return;
    const zt = b.def?.zoneType;
    if (zt !== 'C' && zt !== 'I') return;
    b.laborState      ??= 'ok';
    b.laborStateTurns ??= 0;
    b.recovering      ??= false;
    b.baseColor       ??= b.def?.color;
  }

  _updateLaborStates() {
    const le = this._state.laborEfficiency;
    let struggling = 0, abandoned = 0;
    const changed = [];

    for (const tile of this._grid.getAllTiles()) {
      const b = tile.building;
      if (!b) continue;
      // Only process anchor tiles to avoid double-updating shared plot building objects
      if (tile.x !== b.tileX || tile.z !== b.tileZ) continue;
      const zt = b.def?.zoneType;
      if (zt !== 'C' && zt !== 'I') continue;

      this._initCIBuilding(b);

      const prev   = b.laborState;
      b.recovering = false;

      if (b.laborState === 'abandoned') {
        if (le >= 0.40) {
          b.laborStateTurns++;
          if (b.laborStateTurns >= 1) {
            b.laborState      = 'struggling';
            b.laborStateTurns = 0;
            b.recovering      = true;
          }
        } else {
          b.laborStateTurns = 0;
        }
      } else if (b.laborState === 'struggling') {
        if (le >= 0.80) {
          b.laborState      = 'ok';
          b.laborStateTurns = 0;
          b.recovering      = true;
        } else if (le < 0.25) {
          b.laborStateTurns++;
          if (b.laborStateTurns >= 2) {
            b.laborState      = 'abandoned';
            b.laborStateTurns = 0;
          }
        } else {
          b.laborStateTurns = 0;
        }
      } else {  // 'ok'
        if (le < 0.80) {
          b.laborState      = 'struggling';
          b.laborStateTurns = 0;
        }
      }

      if (b.laborState !== prev || b.recovering) changed.push(b);
      if (b.laborState === 'struggling') struggling++;
      else if (b.laborState === 'abandoned') abandoned++;
    }

    this._state.struggling = struggling;
    this._state.abandoned  = abandoned;

    if (changed.length > 0) this.emit('laborStateChanged', changed);
  }

  // ── Auto-spawn ───────────────────────────────────────────────────

  _autoSpawn(power, water, stats) {
    const powerOK = power.available >= power.needed;
    const waterOK = water.available >= water.needed;
    const d       = this._state.rciDemand;
    const zoneMap = { R: 'residential_low', C: 'commercial_low', I: 'industrial_low' };
    const level   = this._state.cityLevel;

    // Detect unbuilt plots (only includes unbuilt, road-adjacent zone rectangles)
    const plots = this._grid.detectPlots();

    for (const plot of plots) {
      const demand = d[plot.zoneType] ?? 0;
      if (demand < 20) continue;
      const buildingId = zoneMap[plot.zoneType];
      const def = BUILDINGS[buildingId];
      if (!def) continue;
      if ((def.unlockAtLevel ?? 1) > level) continue;
      if ((def.requires?.power || 0) > 0 && !powerOK) continue;
      if ((def.requires?.water || 0) > 0 && !waterOK) continue;
      if (Math.random() > 0.5) continue; // 50% chance per sim tick = staggered development

      this._grid.placePlot(plot, buildingId);
      const anchor = this._grid.getTile(plot.anchorX, plot.anchorZ);
      this._initCIBuilding(anchor?.building);
    }

    const bs = this._bootstrapSpawnedThisMonth;

    const tryBootstrap = (zoneType) => {
      if (bs[zoneType]) return;
      const buildingId = zoneMap[zoneType];
      const def        = BUILDINGS[buildingId];
      if (!def) return;
      if ((def.requires?.power || 0) > 0 && !powerOK) return;
      if ((def.requires?.water || 0) > 0 && !waterOK) return;
      const plots2 = plots.filter(p => p.zoneType === zoneType);
      if (!plots2.length) return;
      const plot2 = plots2[0];
      this._grid.placePlot(plot2, buildingId);
      const anchor2 = this._grid.getTile(plot2.anchorX, plot2.anchorZ);
      this._initCIBuilding(anchor2?.building);
      bs[zoneType] = true;
    };

    const rTiles = stats.rZones > 0;
    const cBldg  = stats.cBuildings;
    const iBldg  = stats.iBuildings;
    const rBldg  = stats.rBuildings;

    if (rTiles && cBldg === 0) tryBootstrap('C');
    if (rTiles && iBldg === 0) tryBootstrap('I');
    if ((cBldg > 0 || iBldg > 0) && rBldg === 0) tryBootstrap('R');
  }

  // ── Level up ─────────────────────────────────────────────────────

  _checkLevelUp() {
    const pop   = this._state.population;
    const level = this._state.cityLevel;
    if (level >= LEVEL_THRESHOLDS.length) return;
    if (pop >= LEVEL_THRESHOLDS[level]) {
      this._state.cityLevel = level + 1;
      this.emit('levelUp', { level: this._state.cityLevel, population: pop });
    }
  }

  // ── Player actions ───────────────────────────────────────────────

  placeZone(x, z, zoneType) {
    const tile = this._grid.getTile(x, z);
    if (!tile) return { success: false, reason: 'Invalid tile' };
    const ok = this._grid.setTileZone(x, z, zoneType);
    if (!ok)   return { success: false, reason: 'Cannot zone this tile' };
    this._emitLayout();
    return { success: true };
  }

  placeBuilding(x, z, buildingId, rotation = 0) {
    const def  = BUILDINGS[buildingId];
    if (!def)  return { success: false, reason: 'Unknown building' };

    const tile = this._grid.getTile(x, z);
    if (!tile) return { success: false, reason: 'Invalid tile' };

    if (buildingId === 'road') {
      const isBridge = tile.type === 'terrain' && tile.terrainType === 'river';
      const cost     = isBridge ? BUILDINGS.bridge.cost : def.cost;
      if (this._state.money < cost)
        return { success: false, reason: `Not enough money (need €${cost})` };
      const ok = isBridge ? this._grid.setTileBridge(x, z) : this._grid.setTileRoad(x, z);
      if (!ok) return { success: false, reason: 'Cannot place here' };
      this._state.money -= cost;
      this._refreshResourceStats();
      this._emitLayout();
      return { success: true };
    }

    if (def.zoneType) {
      // Zone buildings (auto-spawn): single-tile check only
      if (tile.type === 'terrain' && tile.terrainType !== 'forest')
        return { success: false, reason: 'Cannot build on terrain' };
      if (tile.building && tile.type !== 'zone')
        return { success: false, reason: 'Tile already occupied' };
    } else {
      // Service / infra: validate the full footprint
      const [fw, fd] = Array.isArray(def.size) ? def.size : [def.size || 1, def.size || 1];
      for (let dx = 0; dx < fw; dx++) {
        for (let dz = 0; dz < fd; dz++) {
          const ft = this._grid.getTile(x + dx, z - dz);
          if (!ft) return { success: false, reason: 'Footprint extends out of bounds' };
          if (ft.type === 'terrain' && ft.terrainType !== 'forest')
            return { success: false, reason: 'Footprint overlaps water or terrain' };
          if (ft.building)
            return { success: false, reason: 'Footprint is already occupied' };
        }
      }
    }

    if (this._state.money < def.cost)
      return { success: false, reason: `Not enough money (need €${def.cost})` };

    const ok = this._grid.placeBuilding(x, z, buildingId, rotation);
    if (!ok) return { success: false, reason: 'Cannot place here' };

    this._state.money -= def.cost;
    if (def.category === 'service') this._grid.recalculateServiceEffects();
    this._refreshResourceStats();
    this._emitLayout();
    return { success: true };
  }

  placeRoadLine(tiles) {
    let totalCost = 0;
    const placeable = [];
    for (const tile of tiles) {
      if (tile.type === 'terrain' && tile.terrainType !== 'river' && tile.terrainType !== 'forest') continue;
      const cost = (tile.type === 'terrain' && tile.terrainType === 'river')
        ? BUILDINGS.bridge.cost : BUILDINGS.road.cost;
      totalCost += cost;
      placeable.push({ tile, cost });
    }
    if (placeable.length === 0)
      return { placed: 0, cost: 0, errors: ['No buildable tiles in selection'] };
    if (this._state.money < totalCost)
      return { placed: 0, cost: 0,
               errors: [`Need €${totalCost}, have €${Math.floor(this._state.money)}`] };

    let placed = 0, spent = 0;
    for (const { tile, cost } of placeable) {
      const ok = tile.terrainType === 'river' && tile.type === 'terrain'
        ? this._grid.setTileBridge(tile.x, tile.z)
        : this._grid.setTileRoad(tile.x, tile.z);
      if (ok) { placed++; spent += cost; this._state.money -= cost; }
    }
    if (placed > 0) {
      this._refreshResourceStats();
      this._emitLayout();
    }
    return { placed, cost: spent, errors: [] };
  }

  /**
   * Toggle traffic lights on a junction tile.
   * Placing costs €500; removing refunds €250.
   * Returns { success, reason? }
   */
  placeTrafficLight(x, z) {
    const tile = this._grid.getTile(x, z);
    if (!tile || tile.type !== 'road')
      return { success: false, reason: 'Traffic lights can only be placed on road tiles' };

    // Validate it's a genuine junction (3+ road neighbours)
    const neighbours = [
      this._grid.getTile(x, z - 1),
      this._grid.getTile(x, z + 1),
      this._grid.getTile(x + 1, z),
      this._grid.getTile(x - 1, z),
    ].filter(t => t?.type === 'road').length;
    if (neighbours < 3)
      return { success: false, reason: 'Traffic lights require a junction (3 or more roads meeting)' };

    if (tile.trafficLight) {
      // Remove — partial refund
      tile.trafficLight = false;
      this._state.money += 250;
      this._emitLayout();
      return { success: true, removed: true };
    } else {
      // Place — charge full cost
      const cost = 500;
      if (this._state.money < cost)
        return { success: false, reason: `Not enough money (need €${cost})` };
      tile.trafficLight = true;
      this._state.money -= cost;
      this._emitLayout();
      return { success: true, removed: false };
    }
  }

  placeZoneRect(tiles, zoneType) {
    let placed = 0, skipped = 0;
    for (const tile of tiles)
      this._grid.setTileZone(tile.x, tile.z, zoneType) ? placed++ : skipped++;
    if (placed > 0) this._emitLayout();
    return { placed, skipped };
  }

  demolish(x, z) {
    const tile = this._grid.getTile(x, z);
    if (!tile)                            return { success: false, reason: 'Invalid tile' };
    if (tile.type === 'terrain' && !tile.isBridge)
                                          return { success: false, reason: 'Cannot demolish terrain' };
    if (tile.type === 'empty')            return { success: false, reason: 'Nothing to demolish' };

    // Plain road (not a bridge) → remove the road
    if (tile.type === 'road' && !tile.isBridge) {
      this._grid.removeRoad(x, z);
      this._refreshResourceStats();
      this._emitLayout();
      return { success: true };
    }

    // Zone tile with no building → dezone
    if (tile.type === 'zone' && !tile.building) {
      this._grid.clearZone(x, z);
      this._refreshResourceStats();
      this._emitLayout();
      return { success: true };
    }

    // If satellite tile, redirect to anchor so the whole building is removed
    if (tile.building &&
        (tile.x !== tile.building.tileX || tile.z !== tile.building.tileZ)) {
      return this.demolish(tile.building.tileX, tile.building.tileZ);
    }

    const wasService = tile.building?.def?.category === 'service';
    const isZoneBuilding = tile.building?.def?.category === 'zone';

    // For zone buildings: use _clearBuildingTilesOnly so we can animate demolish
    if (tile.building && isZoneBuilding) {
      const bMesh = tile.building.mesh ?? null;
      // Clear tiles and garden/garage, but leave main mesh in scene for animation
      this._grid._clearBuildingTilesOnly(x, z);
      this._refreshResourceStats();
      this._emitLayout();
      // Emit demolish event so main.js can animate
      if (bMesh) this.emit('buildingDemolished', { mesh: bMesh });
      // After a short delay, check if nearby blocked upgrades can now proceed
      const cx = x, cz = z;
      setTimeout(() => {
        const nearbyUpgrades = this._grid.checkUpgradesNear(cx, cz);
        for (const u of nearbyUpgrades) {
          this.emit('buildingUpgraded', { anchorX: u.anchorX, anchorZ: u.anchorZ, oldMesh: u.oldMesh, newId: u.newId });
        }
      }, 1000 + Math.random() * 1000);
      return { success: true };
    }

    this._grid.removeBuilding(x, z);
    if (wasService) this._grid.recalculateServiceEffects();
    this._refreshResourceStats();
    this._emitLayout();
    return { success: true };
  }

  // ── Detail getters (for modal dialogs) ──────────────────────────

  getFinancialDetails() {
    const stats = this._grid.getStats();
    const CFG   = SIMULATION_CONFIG;

    const totalCBldg  = stats.cBuildings;
    const totalIBldg  = stats.iBuildings;
    const suppliedC   = Math.min(totalCBldg, totalIBldg * CFG.cSupplyRatio);
    const supplyRatio = totalCBldg > 0 ? suppliedC / totalCBldg : 1.0;
    const cTaxMult    = CFG.cUndersupplyEfficiency + (1 - CFG.cUndersupplyEfficiency) * supplyRatio;
    const le          = this._state.laborEfficiency ?? 1.0;
    const ie          = this._state.infraEfficiency ?? 1.0;

    let rTax = 0, cTax = 0, iTax = 0;
    let rCount = 0, cCount = 0, iCount = 0;

    const groups = {
      residential: { label: 'Residential zones',  amount: 0, count: 0 },
      commercial:  { label: 'Commercial zones',   amount: 0, count: 0 },
      industrial:  { label: 'Industrial zones',   amount: 0, count: 0 },
      police:      { label: 'Police stations',    amount: 0, count: 0 },
      fire:        { label: 'Fire stations',      amount: 0, count: 0 },
      hospital:    { label: 'Hospitals',          amount: 0, count: 0 },
      education:   { label: 'Education',          amount: 0, count: 0 },
      parks:       { label: 'Parks',              amount: 0, count: 0 },
      power:       { label: 'Power plants',       amount: 0, count: 0 },
      water:       { label: 'Water pumps',        amount: 0, count: 0 },
      roads:       { label: 'Roads & bridges',    amount: 0, count: 0 },
    };

    for (const b of stats.allBuildings) {
      const def = b.def;
      const up  = def.monthlyUpkeep;
      if      (def.zoneType === 'R') { rTax += (b.residents || 0) * 10 * ie;                                         rCount++; groups.residential.amount += up; groups.residential.count++; }
      else if (def.zoneType === 'C') { const pa=(b.plotWidth??1)*(b.plotDepth??1); if (b.laborState !== 'abandoned') cTax += 50 * cTaxMult * le * ie * pa; cCount++; groups.commercial.amount  += up; groups.commercial.count++;  }
      else if (def.zoneType === 'I') { const pa=(b.plotWidth??1)*(b.plotDepth??1); if (b.laborState !== 'abandoned') iTax += 80 * (b.fillPercentage ?? 1.0) * le * ie * pa; iCount++; groups.industrial.amount  += up; groups.industrial.count++;  }
      else if (def.id === 'police_station')                              { groups.police.amount    += up; groups.police.count++;    }
      else if (def.id === 'fire_station')                                { groups.fire.amount      += up; groups.fire.count++;      }
      else if (def.id === 'hospital')                                    { groups.hospital.amount  += up; groups.hospital.count++;  }
      else if (['primary_school','high_school','university'].includes(def.id)) { groups.education.amount += up; groups.education.count++; }
      else if (def.id.startsWith('park_'))                               { groups.parks.amount     += up; groups.parks.count++;     }
      else if (def.id === 'power_plant')                                 { groups.power.amount     += up; groups.power.count++;     }
      else if (def.id === 'water_pump')                                  { groups.water.amount     += up; groups.water.count++;     }
      else if (def.id === 'road' || def.id === 'bridge')                 { groups.roads.amount     += up; groups.roads.count++;     }
    }

    const totalIncome   = rTax + cTax + iTax;
    const totalExpenses = Object.values(groups).reduce((s, g) => s + g.amount, 0);

    return {
      income: { residential: rTax, commercial: cTax, industrial: iTax,
                total: totalIncome, rCount, cCount, iCount },
      expenses: groups,
      totalExpenses,
      net:      totalIncome - totalExpenses,
      balance:  this._state.money,
      lastDayNet: this._state.lastDayNet ?? 0,
    };
  }

  getPopulationDetails() {
    const stats = this._grid.getStats();
    const tot   = this._rciBreakdown?.totals ?? {};

    // Workers = adults who can work; shoppers = all residents who can buy from C
    const workers  = Math.round(tot.workers  ?? stats.population * SIMULATION_CONFIG.residentAdultRatio);
    const shoppers = Math.round(tot.shoppers ?? stats.population);

    // Employment is measured against the adult worker pool, not total population
    const employed   = Math.min(workers, stats.totalJobs);
    const unemployed = Math.max(0, workers - stats.totalJobs);
    const empRate    = workers > 0 ? Math.round(employed / workers * 100) : 0;

    let rZones = 0, rBldg = 0, cZones = 0, cBldg = 0, iZones = 0, iBldg = 0;
    for (const t of this._grid.getAllTiles()) {
      if (t.type !== 'zone') continue;
      if      (t.zoneType === 'R') { rZones++; if (t.building) rBldg++; }
      else if (t.zoneType === 'C') { cZones++; if (t.building) cBldg++; }
      else if (t.zoneType === 'I') { iZones++; if (t.building) iBldg++; }
    }

    return {
      total: stats.population, workers, shoppers,
      employed, unemployed, empRate,
      totalJobs: stats.totalJobs,
      residential: { zones: rZones, buildings: rBldg },
      commercial:  { zones: cZones, buildings: cBldg },
      industrial:  { zones: iZones, buildings: iBldg },
    };
  }

  getHappinessDetails() {
    const s       = this._state;
    const powerOK = s.totalPowerAvailable >= s.totalPowerNeeded;
    const waterOK = s.totalWaterAvailable >= s.totalWaterNeeded;

    const byName = {};
    for (const t of this._grid.getAllTiles()) {
      if (!t.building || t.building.def.category !== 'service') continue;
      const def = t.building.def;
      if (!def.provides?.happiness) continue;
      byName[def.name] ??= { name: def.name, count: 0, bonusEach: def.provides.happiness, radius: def.provides.radius };
      byName[def.name].count++;
    }

    const modifiers = [
      { label: 'Base happiness', value: 50, good: true, note: 'Starting point for all residential tiles' },
    ];
    for (const g of Object.values(byName)) {
      modifiers.push({
        label: g.name,
        value: `+${g.bonusEach} each`,
        good:  true,
        note:  `${g.count} built · radius ${g.radius}`,
      });
    }
    if (!powerOK) modifiers.push({ label: 'Power shortage', value: -15, good: false, note: 'Residential penalty until resolved' });
    if (!waterOK) modifiers.push({ label: 'Water shortage', value: -15, good: false, note: 'Residential penalty until resolved' });
    if (Object.keys(byName).length === 0 && powerOK && waterOK)
      modifiers.push({ label: 'No services', value: 0, good: false, note: 'Build parks/hospitals/schools for bonuses' });

    return { current: s.happiness, powerOK, waterOK, modifiers };
  }

  getRCIDetails() {
    const s   = this._state;
    const bd  = this._rciBreakdown;
    const tot = bd?.totals ?? {};
    const pct = v => `${Math.round((v ?? 0) * 100)}%`;
    const mk  = (label, good, note, score) => ({ label, value: good ? '✅' : '❌', good, note, score });
    const r   = v => Math.round(v ?? 0);

    return {
      R: {
        demand: s.rciDemand.R,
        modifiers: [
          mk('Job availability (×0.60)',
             (bd?.r?.job_availability?.score ?? 0) >= 0.5,
             `effectiveJobs ${r(tot.effectiveJobs)} / workers ${r(tot.workers)} → score ${pct(bd?.r?.job_availability?.score)}`,
             bd?.r?.job_availability?.score),
          mk('Happiness (×0.20)',
             s.happiness >= 50,
             `City happiness ${r(s.happiness)}% → score ${pct(bd?.r?.happiness?.score)}`,
             bd?.r?.happiness?.score),
        ],
      },
      C: {
        demand: s.rciDemand.C,
        modifiers: [
          mk('Customer base (×0.55)',
             (bd?.c?.customer_base?.score ?? 0) >= 0.5,
             `${r(tot.shoppers)} residents / (${r(tot.cBldg)} shops × 35) → score ${pct(bd?.c?.customer_base?.score)}`,
             bd?.c?.customer_base?.score),
          mk('Supply chain — I→C (×0.30)',
             (bd?.c?.supply_chain?.score ?? 0) >= 0.5,
             `${r(tot.suppliedCBuildings)} supplied / ${r(tot.cBldg)} C-buildings → score ${pct(bd?.c?.supply_chain?.score)}`,
             bd?.c?.supply_chain?.score),
          mk('Worker supply (×0.15)',
             (bd?.c?.worker_supply?.score ?? 0) >= 0.5,
             `${r(tot.workers)} workers / ${r(tot.cJobs)} C-job slots → score ${pct(bd?.c?.worker_supply?.score)}`,
             bd?.c?.worker_supply?.score),
        ],
      },
      I: {
        demand: s.rciDemand.I,
        modifiers: [
          mk('Market demand — C←I (×0.75)',
             (bd?.i?.market_demand?.score ?? 0) >= 0.5,
             `${r(tot.cBldg)} C-buildings / (${r(tot.iBldg)} I-buildings × ${SIMULATION_CONFIG.cSupplyRatio}) → score ${pct(bd?.i?.market_demand?.score)}`,
             bd?.i?.market_demand?.score),
          mk('Worker supply (×0.25)',
             (bd?.i?.worker_supply?.score ?? 0) >= 0.5,
             `${r(tot.workers)} workers / ${r(tot.iJobs)} I-job slots → score ${pct(bd?.i?.worker_supply?.score)}`,
             bd?.i?.worker_supply?.score),
        ],
      },
    };
  }
}
