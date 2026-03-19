/**
 * @module economy
 * Pure functions for budget calculation. No Three.js, no DOM.
 */
import { BUILDINGS } from './buildings.js';

/**
 * Process one game month: calculate tax income and building upkeep.
 *
 * Tax formulas (section 6 of economic model):
 *   R: residents * 10      (b.residents is already fill-adjusted; updated monthly)
 *   C: 50 * cTaxMultiplier (cTaxMultiplier scales with industrial supply coverage)
 *   I: 80 * fillPercentage (ramps up as the building matures)
 *
 * @param {object[]} placedBuildings  Building instance objects from grid.
 * @param {{ cSupplyRatio?: number, cUndersupplyEfficiency?: number }} simConfig
 * @returns {{ income: number, expenses: number, net: number, breakdown: object }}
 */
export function processMonth(placedBuildings, simConfig = {}) {
  const cSupplyRatio       = simConfig.cSupplyRatio          ?? 5;
  const cUndersupplyEff    = simConfig.cUndersupplyEfficiency ?? 0.50;

  // Pre-compute C supply chain multiplier
  const totalCBldg   = placedBuildings.filter(b => BUILDINGS[b.id]?.zoneType === 'C').length;
  const totalIBldg   = placedBuildings.filter(b => BUILDINGS[b.id]?.zoneType === 'I').length;
  const suppliedC    = Math.min(totalCBldg, totalIBldg * cSupplyRatio);
  const supplyRatio  = totalCBldg > 0 ? suppliedC / totalCBldg : 1.0;
  const cTaxMult     = cUndersupplyEff + (1 - cUndersupplyEff) * supplyRatio;

  let income = 0, expenses = 0;
  const breakdown = { residentialTax: 0, commercialTax: 0, industrialTax: 0, upkeep: 0 };

  for (const b of placedBuildings) {
    const def = BUILDINGS[b.id];
    if (!def) continue;

    expenses         += def.monthlyUpkeep;
    breakdown.upkeep += def.monthlyUpkeep;

    const plotArea = (b.plotWidth ?? 1) * (b.plotDepth ?? 1);
    if (def.zoneType === 'R') {
      const tax = (b.residents || 0) * 10;
      income += tax;  breakdown.residentialTax += tax;
    } else if (def.zoneType === 'C') {
      const tax = 50 * cTaxMult * plotArea;
      income += tax;  breakdown.commercialTax += tax;
    } else if (def.zoneType === 'I') {
      const tax = 80 * (b.fillPercentage ?? 1.0) * plotArea;
      income += tax;  breakdown.industrialTax += tax;
    }
  }

  return { income, expenses, net: income - expenses, breakdown };
}

/**
 * Sum power requirements and availability across all placed buildings.
 * @param {object[]} placedBuildings
 * @returns {{ needed: number, available: number }}
 */
export function calculatePower(placedBuildings) {
  let needed = 0, available = 0;
  for (const b of placedBuildings) {
    const def = BUILDINGS[b.id];
    if (!def) continue;
    available += def.provides?.power_kw    || 0;
    needed    += def.requires?.power       || 0;
  }
  return { needed, available };
}

/**
 * Sum water requirements and availability across all placed buildings.
 * @param {object[]} placedBuildings
 * @returns {{ needed: number, available: number }}
 */
export function calculateWater(placedBuildings) {
  let needed = 0, available = 0;
  for (const b of placedBuildings) {
    const def = BUILDINGS[b.id];
    if (!def) continue;
    available += def.provides?.water_units || 0;
    needed    += def.requires?.water       || 0;
  }
  return { needed, available };
}
