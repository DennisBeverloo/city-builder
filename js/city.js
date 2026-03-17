/**
 * @module city
 * City state, simulation loop, RCI demand logic, and auto-spawn.
 * No Three.js. Communicates outward via EventEmitter callbacks.
 *
 * Simulation cadence:
 *   Every 5 game-days  → _updateSimulation (pop/power/water/happiness/RCI/auto-spawn)
 *   Every 30 game-days → _advanceMonth (taxes + upkeep only)
 */
import { BUILDINGS } from './buildings.js';
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
}

// CAPACITY PLANNING REFERENCE
// Target: self-sustaining city at 500 residents
// ~84 R buildings:  84 × power 1  =  84 kW,  84 × water 1  =  84 units
// ~105 C buildings: 105 × power 2 = 210 kW, 105 × water 1 = 105 units
// ~21 I buildings:   21 × power 5 = 105 kW,  21 × water 3 =  63 units
// Total at 500 pop: ~399 kW, ~252 water units
//
// Diesel generator: 150 kW → covers ~188 residents (R+C+I mix)
// Coal plant:       600 kW → covers ~750 residents (R+C+I mix)
// Small pump:        80 units → covers ~160 residents (R+C+I mix)
// Water station:    320 units → covers ~640 residents (R+C+I mix)
//
// Recommended starter build: Diesel Gen + Small Pump = €5500 + €1100/mo upkeep
// Remaining budget after starter infra: €44500 for zoning and roads

// ── Simulation config ────────────────────────────────────────────────────────

/** Exported so economy.js and grid.js can read values via parameter passing. */
export const SIMULATION_CONFIG = {
  residentAdultRatio:        0.60,  // fraction of residents who are workers AND shoppers
  cBuildingWorkers:          3,     // jobs per commercial building
  iBuildingWorkers:          10,    // jobs per industrial building
  rBuildingCapacity:         6,     // max residents per residential building
  cSupplyRatio:              5,     // max C buildings supplied by 1 I building
  cUndersupplyEfficiency:    0.50,  // C tax multiplier when I supply is absent
  fillGrowthRatePerMonth:    0.15,  // fraction of remaining capacity filled per month
  industryPollutionRadius:   6,     // Manhattan-distance radius for I pollution
  industryPollutionStrength: 40,    // base pollution at source tile (0–100)
};

// ── Constants ────────────────────────────────────────────────────────────────

const LEVEL_THRESHOLDS = [0, 500, 1500, 3000, 6000, 12000, 25000, 50000, 100_000, 250_000];
const SIM_TICK_DAYS    = 5;   // how often the simulation (non-economy) updates

// ── City ─────────────────────────────────────────────────────────────────────

export class City extends EventEmitter {
  /** @param {import('./grid.js').Grid} grid */
  constructor(grid) {
    super();
    this._grid = grid;

    this._state = {
      money:               50_000,
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
    };

    this._rciBreakdown = null;
    this._bootstrapSpawnedThisMonth = { R: false, C: false, I: false };

    this._dayTimer = 0;
    this._dayMs    = 1000; // 1 real second = 1 game day
    this._paused   = false;
  }

  // ── Public getters ───────────────────────────────────────────────

  getState()        { return { ...this._state }; }
  getDebugStats()   { return this._grid.getStats(); }
  getRCIBreakdown() { return this._rciBreakdown; }
  get paused()      { return this._paused; }
  set paused(v)     { this._paused = v; }

  // ── Main loop ────────────────────────────────────────────────────

  /** Call from RAF loop. @param {number} dt milliseconds */
  tick(dt) {
    if (this._paused) return;
    this._dayTimer += dt;
    if (this._dayTimer >= this._dayMs) {
      this._dayTimer -= this._dayMs;
      this._advanceDay();
    }
  }

  _advanceDay() {
    const d = this._state.date;
    d.day++;

    const isMonthEnd = d.day > 30;

    if (isMonthEnd) {
      // Update fill percentages and tile maps BEFORE the sim tick so that
      // the demand calculation and happiness values see the current month's data.
      this._updateFillPercentages();
      this._grid.runMonthlyTileCalcs(SIMULATION_CONFIG);
    }

    // Simulation tick every SIM_TICK_DAYS, and also at month-end
    if (d.day % SIM_TICK_DAYS === 0 || isMonthEnd) {
      const stats = this._grid.getStats();
      const { power, water } = this._calcPowerWater(stats.allBuildings);
      this._updateSimulation(stats, power, water);
    }

    if (isMonthEnd) {
      d.day = 1;
      this._advanceMonth();
    } else {
      this.emit('dayTick', this.getState());
    }
  }

  /**
   * Full simulation update: pop/power/water/happiness/RCI/auto-spawn/level-up.
   * Runs every SIM_TICK_DAYS game days. Does NOT touch the budget.
   */
  _updateSimulation(stats, power, water) {
    this._state.totalPowerNeeded    = power.needed;
    this._state.totalPowerAvailable = power.available;
    this._state.totalWaterNeeded    = water.needed;
    this._state.totalWaterAvailable = water.available;

    // Infrastructure efficiency: ratio of supply to demand, clamped to [0.2, 1.0]
    const powerRatio = power.available / Math.max(power.needed, 1);
    const waterRatio = water.available / Math.max(water.needed, 1);
    this._state.infraEfficiency = Math.max(0.2, Math.min(1.0, Math.min(powerRatio, waterRatio)));

    this._state.population          = stats.population;  // fill-adjusted
    this._state.happiness           = this._calcHappiness(power, water);

    // Populate RCI model fields (used by demand calc, debug panel, modals)
    const CFG = SIMULATION_CONFIG;

    // Count only non-abandoned C/I buildings for job totals
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

  /**
   * Economy-only month processing: taxes in, upkeep out.
   * Does NOT touch RCI / population / stats.
   */
  _advanceMonth() {
    // Update per-building labor states FIRST (uses freshly computed laborEfficiency)
    this._updateLaborStates();

    const stats  = this._grid.getStats();
    const result = processMonth(stats.allBuildings, SIMULATION_CONFIG);

    // Subtract abandoned-building tax that processMonth wrongly counted
    // (processMonth has no knowledge of laborState)
    const CFG    = SIMULATION_CONFIG;
    const allB   = stats.allBuildings;
    const totC   = allB.filter(b => b.def?.zoneType === 'C').length;
    const totI   = allB.filter(b => b.def?.zoneType === 'I').length;
    const supC   = Math.min(totC, totI * CFG.cSupplyRatio);
    const supR   = totC > 0 ? supC / totC : 1.0;
    const cTM    = CFG.cUndersupplyEfficiency + (1 - CFG.cUndersupplyEfficiency) * supR;
    for (const b of allB) {
      if (b.laborState !== 'abandoned') continue;
      if (b.def?.zoneType === 'C') result.breakdown.commercialTax -= 50 * cTM;
      if (b.def?.zoneType === 'I') result.breakdown.industrialTax -= 80 * (b.fillPercentage ?? 1.0);
    }
    result.breakdown.commercialTax = Math.max(0, result.breakdown.commercialTax);
    result.breakdown.industrialTax = Math.max(0, result.breakdown.industrialTax);

    // Apply labor efficiency to C and I tax yield
    const le = this._state.laborEfficiency ?? 1.0;
    result.breakdown.commercialTax *= le;
    result.breakdown.industrialTax *= le;

    // Apply infrastructure efficiency to all zone tax income (power/water shortage penalty)
    const ie = this._state.infraEfficiency ?? 1.0;
    result.breakdown.residentialTax *= ie;
    result.breakdown.commercialTax  *= ie;
    result.breakdown.industrialTax  *= ie;

    result.income = result.breakdown.residentialTax
                  + result.breakdown.commercialTax
                  + result.breakdown.industrialTax;
    result.net    = result.income - result.expenses;

    this._state.money        += result.net;
    this._state.lastMonthNet  = result.net;

    // Allow bootstrap spawns again next month
    this._bootstrapSpawnedThisMonth = { R: false, C: false, I: false };

    const d = this._state.date;
    d.month++;
    if (d.month > 12) { d.month = 1; d.year++; }

    this.emit('monthProcessed', { ...this.getState(), monthResult: result });
    this.emit('dayTick', this.getState());
  }

  // ── Lightweight stats refresh ────────────────────────────────────
  // Called immediately after any player placement so the HUD reacts
  // without waiting for the next SIM_TICK.

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

  /**
   * Compute fill-adjusted power and water totals across all placed buildings.
   * Supply (provides.*) is always counted at 100%.
   * Demand (requires.*) is scaled by fillPercentage for zone buildings (R/C/I);
   * infra and service buildings always consume at their rated value.
   * All four output values are rounded to whole integers.
   *
   * @param {object[]} allBuildings  Building instance array from grid.getStats()
   * @returns {{ power: {available,needed}, water: {available,needed} }}
   */
  _calcPowerWater(allBuildings) {
    let powerAvail = 0, powerNeeded = 0;
    let waterAvail = 0, waterNeeded = 0;
    for (const b of allBuildings) {
      const def = b.def;
      if (!def) continue;
      powerAvail += def.provides?.power_kw    || 0;
      waterAvail += def.provides?.water_units || 0;
      // Abandoned zone buildings are offline — no consumption
      if (b.laborState === 'abandoned') continue;
      // Zone buildings scale their consumption with fill; others use full rate
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

  /**
   * Grow each zone building's fillPercentage toward 1.0 by fillGrowthRatePerMonth.
   * Updates b.residents for R buildings so getStats() reflects the new fill.
   * Called once per game month before the sim tick.
   */
  _updateFillPercentages() {
    const { fillGrowthRatePerMonth, rBuildingCapacity } = SIMULATION_CONFIG;
    for (const t of this._grid.getAllTiles()) {
      const b = t.building;
      if (!b || !b.def.zoneType) continue;   // only zone buildings
      const prev = b.fillPercentage ?? 0.1;
      b.fillPercentage = Math.min(1.0, prev + fillGrowthRatePerMonth * (1.0 - prev));
      if (b.def.zoneType === 'R') {
        b.residents = rBuildingCapacity * b.fillPercentage;
      }
    }
  }

  // ── Happiness ────────────────────────────────────────────────────

  /**
   * City-wide happiness = average of tile.happiness across R tiles WITH buildings.
   * Power/water shortages apply a city-level penalty on top.
   * tile.happiness itself is computed by grid.runMonthlyTileCalcs / recalculateServiceEffects.
   * @param {{ available: number, needed: number }} power
   * @param {{ available: number, needed: number }} water
   */
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

  /**
   * Weighted multi-factor RCI demand model (section 5 of economic spec).
   *
   * Derived city totals use fillPercentage-adjusted residents:
   *   totalResidents = sum(capacity * fill) for R buildings  (= stats.population)
   *   totalWorkers   = totalResidents * residentAdultRatio
   *   totalShoppers  = totalWorkers   (same pool)
   *   totalCJobs     = count(C) * cBuildingWorkers   (job SLOTS, not fill-adjusted)
   *   totalIJobs     = count(I) * iBuildingWorkers
   *   suppliedC      = count(I) * cSupplyRatio
   *
   * Weights:  R → jobs(0.50) zones(0.30) happiness(0.20)
   *           C → workers(0.40) customers(0.35) supply(0.25)
   *           I → workers(0.45) market(0.55)
   *
   * Bootstrap floors applied after scoring (unconditional Math.max clamps):
   *   rFloor = C>0 || I>0 ? 10 : 0
   *   cFloor = R tiles>0 ? 10 : 0;  if I>0 && C===0 → 15
   *   iFloor = R tiles>0 ? 10 : 0;  if C>0 && I===0 → 15
   *
   * @param {object} stats  result of grid.getStats()
   * @returns {{ rDemand, cDemand, iDemand, breakdown }}
   */
  _calculateRCIDemand(stats) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const CFG   = SIMULATION_CONFIG;

    const res       = stats.population;           // fill-adjusted residents
    const workers   = res * CFG.residentAdultRatio;
    const shoppers  = workers;
    const cBldg     = stats.cBuildings;
    const iBldg     = stats.iBuildings;
    const cJobs     = cBldg * CFG.cBuildingWorkers;
    const iJobs     = iBldg * CFG.iBuildingWorkers;
    const totalJobs = cJobs + iJobs;
    const rTiles    = stats.rZones;

    // ── Labor efficiency (full range so abandonment thresholds work) ──
    const laborEfficiency       = clamp(workers / Math.max(totalJobs, 1), 0.0, 1.0);
    const effectiveJobs         = totalJobs * laborEfficiency;
    // ── Worker-shortage demand suppressor (Fix 2) ─────────────────
    const workerShortageRatio   = laborEfficiency;                           // same calc, [0,1]
    const laborDemandMultiplier = Math.pow(workerShortageRatio, 1.5);

    // ── R factors (Fix 1: jobAvail×0.80 + happiness×0.20) ─────────
    const jobAvail     = clamp(clamp(effectiveJobs / Math.max(workers, 1), 0, 2) / 2, 0, 1);
    const happinessScr = this._state.happiness / 100;
    const rRaw         = jobAvail * 0.80 + happinessScr * 0.20;

    // ── C factors ─────────────────────────────────────────────────
    let workerC = clamp(workers / Math.max(cJobs * 2, 1), 0, 1);
    if (workers < cJobs * 0.5) workerC *= 0.3;

    const customerBase = res === 0 ? 0
      : clamp(shoppers / Math.max(cBldg * 20, 1), 0, 1);

    let supplyChain;
    let suppliedCBuildings = 0;
    if (cBldg === 0) {
      supplyChain = 1.0;                          // no C yet → no penalty
    } else if (iBldg === 0) {
      supplyChain = 0.10;
    } else {
      suppliedCBuildings = Math.min(iBldg * CFG.cSupplyRatio, cBldg);
      supplyChain = suppliedCBuildings / cBldg;
    }

    const cRaw = workerC * 0.40 + customerBase * 0.35 + supplyChain * 0.25;

    // ── I factors (Fix 3: market_demand = 1 / supplyRatio) ────────
    let workerI = clamp(workers / Math.max(iJobs * 2, 1), 0, 1);
    if (workers < iJobs * 0.5) workerI *= 0.3;

    let marketDemand;
    if (iBldg === 0) {
      marketDemand = 1.0;                         // no I yet → full demand
    } else if (cBldg === 0) {
      marketDemand = 0.10;                        // no buyers → near-zero
    } else {
      const supplyRatio = (iBldg * CFG.cSupplyRatio) / cBldg;
      marketDemand = clamp(1.0 / supplyRatio, 0.1, 1.0);
    }

    const iRaw = workerI * 0.45 + marketDemand * 0.55;

    // ── Scale to [0, 100] ─────────────────────────────────────────
    let rScore = clamp(rRaw * 100, 0, 100);
    let cScore = clamp(cRaw * 100, 0, 100);
    let iScore = clamp(iRaw * 100, 0, 100);

    // ── Apply worker-shortage suppressor to C and I before floors ──
    cScore *= laborDemandMultiplier;
    iScore *= laborDemandMultiplier;

    // ── Bootstrap floors ──────────────────────────────────────────
    const rFloor = (cBldg > 0 || iBldg > 0) ? 10 : 0;
    let   cFloor = rTiles > 0 ? 10 : 0;
    if (iBldg > 0 && cBldg === 0) cFloor = 15;
    let   iFloor = rTiles > 0 ? 10 : 0;
    if (cBldg > 0 && iBldg === 0) iFloor = 15;

    rScore = Math.max(rScore, rFloor);
    cScore = Math.max(cScore, cFloor);
    iScore = Math.max(iScore, iFloor);

    // ── R demand bonus when jobs significantly exceed workers ──────
    const jobSurplusRatio = clamp(totalJobs / Math.max(workers, 1), 1, 3);
    const rDemandBonus    = (jobSurplusRatio - 1) / 2;
    rScore = clamp(rScore + rDemandBonus * 100, rFloor, 100);

    const rDemand = Math.round(rScore);
    const cDemand = Math.round(cScore);
    const iDemand = Math.round(iScore);

    // ── Fix 7: Structured result with per-factor breakdown ─────────
    const result = {
      rDemand, cDemand, iDemand,
      breakdown: {
        r: {
          job_availability: { score: jobAvail,     weight: 0.80 },
          happiness:        { score: happinessScr, weight: 0.20 },
          floor:            rFloor,
          laborEfficiency,
        },
        c: {
          worker_supply: { score: workerC,      weight: 0.40 },
          customer_base: { score: customerBase, weight: 0.35 },
          supply_chain:  { score: supplyChain,  weight: 0.25 },
          floor:         cFloor,
        },
        i: {
          worker_supply: { score: workerI,      weight: 0.45 },
          market_demand: { score: marketDemand, weight: 0.55 },
          floor:         iFloor,
        },
        totals: {
          workers, shoppers, cJobs, iJobs, totalJobs,
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

  /**
   * Initialise labor-state tracking properties on a newly placed C or I building.
   * Safe to call on any building — silently ignored for R, services, infra.
   * @param {object|null} b  building instance from tile.building
   */
  _initCIBuilding(b) {
    if (!b) return;
    const zt = b.def?.zoneType;
    if (zt !== 'C' && zt !== 'I') return;
    b.laborState      ??= 'ok';
    b.laborStateTurns ??= 0;
    b.recovering      ??= false;
    b.baseColor       ??= b.def?.color;
  }

  /**
   * Update laborState for every C and I building once per month.
   * Uses this._state.laborEfficiency which must be fresh (call after _updateSimulation).
   * Emits 'laborStateChanged' with an array of affected building instances.
   */
  _updateLaborStates() {
    const le = this._state.laborEfficiency;
    let struggling = 0, abandoned = 0;
    const changed = [];

    for (const tile of this._grid.getAllTiles()) {
      const b = tile.building;
      if (!b) continue;
      const zt = b.def?.zoneType;
      if (zt !== 'C' && zt !== 'I') continue;

      // Ensure properties exist on buildings placed before this feature shipped
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
          b.laborStateTurns = 0;   // in 0.25–0.80 range: stays struggling, reset counter
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

  /**
   * Spawn buildings on connected zone tiles when demand > 20.
   * Also fires one bootstrap spawn per zone type per month to break cold-start loops.
   * @param {object} power @param {object} water @param {object} stats
   */
  _autoSpawn(power, water, stats) {
    const powerOK = power.available >= power.needed;
    const waterOK = water.available >= water.needed;
    const d       = this._state.rciDemand;
    const zoneMap = { R: 'residential_low', C: 'commercial_low', I: 'industrial_low' };
    const level   = this._state.cityLevel;

    // ── Regular demand-driven spawn ───────────────────────────────
    for (const tile of this._grid.getAllTiles()) {
      if (tile.type !== 'zone' || tile.building || !tile.connected) continue;
      const demand = d[tile.zoneType] ?? 0;
      if (demand < 20) continue;

      const buildingId = zoneMap[tile.zoneType];
      const def        = BUILDINGS[buildingId];
      if (!def)                                                         continue;
      if ((def.unlockAtLevel  ?? 1) > level)                           continue;
      if ((def.requires?.power || 0) > 0 && !powerOK)                  continue;
      if ((def.requires?.water || 0) > 0 && !waterOK)                  continue;

      this._grid.placeBuilding(tile.x, tile.z, buildingId);
      // fillPercentage (0.1) and initial residents set inside placeBuilding
      // Cost: free — residents/businesses moving into zoned land pay nothing
      this._initCIBuilding(this._grid.getTile(tile.x, tile.z)?.building);
    }

    // ── Bootstrap spawns (at most once per type per month) ────────
    // Prevents cold-start deadlocks when demand hasn't built up yet.
    const bs = this._bootstrapSpawnedThisMonth;

    const tryBootstrap = (zoneType) => {
      if (bs[zoneType]) return;
      const buildingId = zoneMap[zoneType];
      const def        = BUILDINGS[buildingId];
      if (!def) return;
      if ((def.requires?.power || 0) > 0 && !powerOK) return;
      if ((def.requires?.water || 0) > 0 && !waterOK) return;

      const tile = this._grid.getAllTiles().find(
        t => t.type === 'zone' && t.zoneType === zoneType && !t.building && t.connected
      );
      if (!tile) return;

      this._grid.placeBuilding(tile.x, tile.z, buildingId);
      this._initCIBuilding(tile.building);
      bs[zoneType] = true;
    };

    const rTiles = stats.rZones > 0;
    const cBldg  = stats.cBuildings;
    const iBldg  = stats.iBuildings;
    const rBldg  = stats.rBuildings;

    // R tiles exist but no C yet → force one C
    if (rTiles && cBldg === 0) tryBootstrap('C');
    // R tiles exist but no I yet → force one I
    if (rTiles && iBldg === 0) tryBootstrap('I');
    // C or I exists but no R yet → force one R
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

  /** Paint a zone tile. Zone painting is free. */
  placeZone(x, z, zoneType) {
    const tile = this._grid.getTile(x, z);
    if (!tile) return { success: false, reason: 'Invalid tile' };
    const ok = this._grid.setTileZone(x, z, zoneType);
    if (!ok)   return { success: false, reason: 'Cannot zone this tile' };
    this.emit('stateChanged', this.getState());
    return { success: true };
  }

  /** Place a service, infra, or single road/bridge. Deducts cost. */
  placeBuilding(x, z, buildingId) {
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
      this.emit('stateChanged', this.getState());
      return { success: true };
    }

    if (tile.type === 'terrain' && tile.terrainType !== 'forest')
      return { success: false, reason: 'Cannot build on terrain' };
    if (tile.building && tile.type !== 'zone')
      return { success: false, reason: 'Tile already occupied' };
    if (this._state.money < def.cost)
      return { success: false, reason: `Not enough money (need €${def.cost})` };

    const ok = this._grid.placeBuilding(x, z, buildingId);
    if (!ok) return { success: false, reason: 'Cannot place here' };

    this._state.money -= def.cost;
    if (def.category === 'service') this._grid.recalculateServiceEffects();
    this._refreshResourceStats();
    this.emit('stateChanged', this.getState());
    return { success: true };
  }

  /** Place roads/bridges along a pre-computed tile list. Checks total cost first. */
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
      this.emit('stateChanged', this.getState());
    }
    return { placed, cost: spent, errors: [] };
  }

  /** Paint a zone rectangle. Zone painting is free. */
  placeZoneRect(tiles, zoneType) {
    let placed = 0, skipped = 0;
    for (const tile of tiles)
      this._grid.setTileZone(tile.x, tile.z, zoneType) ? placed++ : skipped++;
    if (placed > 0) this.emit('stateChanged', this.getState());
    return { placed, skipped };
  }

  /** Demolish building/road on a tile. */
  demolish(x, z) {
    const tile = this._grid.getTile(x, z);
    if (!tile)                   return { success: false, reason: 'Invalid tile' };
    if (tile.type === 'terrain' && !tile.isBridge)
                                 return { success: false, reason: 'Cannot demolish terrain' };
    if (tile.type === 'empty')   return { success: false, reason: 'Nothing to demolish' };

    const wasService = tile.building?.def?.category === 'service';
    this._grid.removeBuilding(x, z);
    if (wasService) this._grid.recalculateServiceEffects();
    this._refreshResourceStats();
    this.emit('stateChanged', this.getState());
    return { success: true };
  }

  // ── Detail getters (for modal dialogs) ──────────────────────────

  /**
   * Full financial breakdown for the monthly economy modal.
   * @returns {object}
   */
  getFinancialDetails() {
    const stats = this._grid.getStats();
    const CFG   = SIMULATION_CONFIG;

    // Recompute supply-chain tax multiplier (mirrors processMonth exactly)
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
      if      (def.zoneType === 'R') { rTax += (b.residents || 0) * 10 * ie;                                                               rCount++; groups.residential.amount += up; groups.residential.count++; }
      else if (def.zoneType === 'C') { if (b.laborState !== 'abandoned') cTax += 50 * cTaxMult * le * ie;                                  cCount++; groups.commercial.amount  += up; groups.commercial.count++;  }
      else if (def.zoneType === 'I') { if (b.laborState !== 'abandoned') iTax += 80 * (b.fillPercentage ?? 1.0) * le * ie;                 iCount++; groups.industrial.amount  += up; groups.industrial.count++;  }
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
      lastMonthNet: this._state.lastMonthNet,
    };
  }

  /**
   * Population breakdown for the population modal.
   * @returns {object}
   */
  getPopulationDetails() {
    const stats     = this._grid.getStats();
    const employed  = Math.min(stats.population, stats.totalJobs);
    const unemployed = Math.max(0, stats.population - stats.totalJobs);
    const empRate   = stats.population > 0 ? Math.round(employed / stats.population * 100) : 0;

    let rZones = 0, rBldg = 0, cZones = 0, cBldg = 0, iZones = 0, iBldg = 0;
    for (const t of this._grid.getAllTiles()) {
      if (t.type !== 'zone') continue;
      if      (t.zoneType === 'R') { rZones++; if (t.building) rBldg++; }
      else if (t.zoneType === 'C') { cZones++; if (t.building) cBldg++; }
      else if (t.zoneType === 'I') { iZones++; if (t.building) iBldg++; }
    }

    return {
      total: stats.population, employed, unemployed, empRate,
      totalJobs: stats.totalJobs,
      residential: { zones: rZones, buildings: rBldg },
      commercial:  { zones: cZones, buildings: cBldg },
      industrial:  { zones: iZones, buildings: iBldg },
    };
  }

  /**
   * Happiness breakdown for the happiness modal.
   * @returns {object}
   */
  getHappinessDetails() {
    const s       = this._state;
    const powerOK = s.totalPowerAvailable >= s.totalPowerNeeded;
    const waterOK = s.totalWaterAvailable >= s.totalWaterNeeded;

    // Aggregate service contributions grouped by building name
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

  /**
   * Per-zone demand breakdown with labelled modifier rows.
   * @returns {object}
   */
  getRCIDetails() {
    const s   = this._state;
    const bd  = this._rciBreakdown;         // may be null before first sim tick
    const tot = bd?.totals ?? {};
    const pct = v => `${Math.round((v ?? 0) * 100)}%`;
    const mk  = (label, good, note, score) => ({ label, good, note, score });
    const r   = v => Math.round(v ?? 0);

    return {
      R: {
        demand: s.rciDemand.R,
        modifiers: [
          mk('Job availability (×0.80)',
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
          mk('Worker supply (×0.40)',
             (bd?.c?.worker_supply?.score ?? 0) >= 0.5,
             `${r(tot.workers)} workers / ${r(tot.cJobs)} C-job slots → score ${pct(bd?.c?.worker_supply?.score)}`,
             bd?.c?.worker_supply?.score),
          mk('Customer base (×0.35)',
             (bd?.c?.customer_base?.score ?? 0) >= 0.5,
             `${r(tot.shoppers)} shoppers / (${r(tot.cBldg)} shops × 20) → score ${pct(bd?.c?.customer_base?.score)}`,
             bd?.c?.customer_base?.score),
          mk('Supply chain — I→C (×0.25)',
             (bd?.c?.supply_chain?.score ?? 0) >= 0.5,
             `${r(tot.suppliedCBuildings)} supplied / ${r(tot.cBldg)} C-buildings → score ${pct(bd?.c?.supply_chain?.score)}`,
             bd?.c?.supply_chain?.score),
        ],
      },
      I: {
        demand: s.rciDemand.I,
        modifiers: [
          mk('Worker supply (×0.45)',
             (bd?.i?.worker_supply?.score ?? 0) >= 0.5,
             `${r(tot.workers)} workers / ${r(tot.iJobs)} I-job slots → score ${pct(bd?.i?.worker_supply?.score)}`,
             bd?.i?.worker_supply?.score),
          mk('Market demand — C←I (×0.55)',
             (bd?.i?.market_demand?.score ?? 0) >= 0.5,
             `${r(tot.cBldg)} C-buildings / (${r(tot.iBldg)} I-buildings × ${SIMULATION_CONFIG.cSupplyRatio}) → score ${pct(bd?.i?.market_demand?.score)}`,
             bd?.i?.market_demand?.score),
        ],
      },
    };
  }
}
