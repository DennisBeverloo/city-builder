/**
 * @module buildings
 * Building definitions and Three.js mesh factory.
 */
import * as THREE from 'three';

/** All building and zone definitions keyed by id. */
export const BUILDINGS = {

  // ── Zones ────────────────────────────────────────────────────────
  residential_low: {
    id: 'residential_low', name: 'Residential (Low)',
    category: 'zone', zoneType: 'R', size: 1,
    cost: 200, monthlyUpkeep: 0,
    provides: { capacity: 6 },           // rBuildingCapacity; grows via fillPercentage
    requires: { power: 1, water: 1 },
    color: 0x4caf50, height: 0.7,
    unlockAtLevel: 1, description: 'Houses up to 6 residents (at 100% fill).',
  },
  commercial_low: {
    id: 'commercial_low', name: 'Commercial (Low)',
    category: 'zone', zoneType: 'C', size: 1,
    cost: 300, monthlyUpkeep: 0,
    provides: { jobs: 3 },               // cBuildingWorkers
    requires: { power: 2, water: 1 },
    shopperDemand:  20,                  // needs ~20 resident shoppers to be fully efficient
    requiresSupply: true,                // needs I-zone supply chain
    color: 0x2196f3, height: 1.2,
    unlockAtLevel: 1, description: 'Provides 3 jobs. Needs industrial supply.',
  },
  industrial_low: {
    id: 'industrial_low', name: 'Industrial (Low)',
    category: 'zone', zoneType: 'I', size: 1,
    cost: 400, monthlyUpkeep: 0,
    provides: { jobs: 10 },              // iBuildingWorkers
    requires: { power: 5, water: 3 },
    suppliesCount: 5,                    // can supply up to 5 commercial buildings
    pollutes:      true,                 // emits pollution (radius from SIMULATION_CONFIG)
    color: 0x9e9e9e, height: 0.9,
    unlockAtLevel: 1, description: 'Provides 10 jobs. Pollutes nearby tiles.',
  },

  // ── Services ─────────────────────────────────────────────────────
  police_station: {
    id: 'police_station', name: 'Police Station',
    category: 'service', size: [2, 2],
    cost: 8000, monthlyUpkeep: 1500,
    provides: { crime_reduction: 20, radius: 8, jobs: 8 },
    requires: { power: 3, water: 1 },
    color: 0x1565c0, height: 1.2,
    unlockAtLevel: 1, description: 'Reduces crime, radius 8. 8 jobs.',
  },
  fire_station: {
    id: 'fire_station', name: 'Fire Station',
    category: 'service', size: [2, 2],
    cost: 8000, monthlyUpkeep: 1500,
    provides: { fire_protection: 20, radius: 8, jobs: 6 },
    requires: { power: 2, water: 2 },
    color: 0xf44336, height: 1.2,
    unlockAtLevel: 1, description: 'Fire protection, radius 8. 6 jobs.',
  },
  hospital: {
    id: 'hospital', name: 'Hospital',
    category: 'service', size: [3, 2],
    cost: 25000, monthlyUpkeep: 4000,
    provides: { happiness: 15, radius: 12, jobs: 25 },
    requires: { power: 5, water: 4 },
    color: 0xeceff1, height: 1.8,
    unlockAtLevel: 2, description: '+15 happiness, radius 12. 25 jobs.',
  },
  primary_school: {
    id: 'primary_school', name: 'Primary School',
    category: 'service', size: [2, 2],
    cost: 5000, monthlyUpkeep: 1000,
    provides: { edu_level: 1, happiness: 5, radius: 6, jobs: 6 },
    requires: { power: 2, water: 1 },
    color: 0xffeb3b, height: 1.0,
    unlockAtLevel: 1, description: '+5 happiness, edu+1, radius 6. 6 jobs.',
  },
  high_school: {
    id: 'high_school', name: 'High School',
    category: 'service', size: [3, 2],
    cost: 12000, monthlyUpkeep: 2500,
    provides: { edu_level: 2, happiness: 8, radius: 10, jobs: 12 },
    requires: { power: 3, water: 2 },
    color: 0xff9800, height: 1.3,
    unlockAtLevel: 2, description: '+8 happiness, edu+2, radius 10. 12 jobs.',
  },
  university: {
    id: 'university', name: 'University',
    category: 'service', size: [4, 3],
    cost: 30000, monthlyUpkeep: 6000,
    provides: { edu_level: 3, happiness: 12, radius: 15, jobs: 40 },
    requires: { power: 8, water: 4 },
    color: 0x9c27b0, height: 2.2,
    unlockAtLevel: 3, description: '+12 happiness, edu+3, radius 15. 40 jobs.',
  },
  park_small: {
    id: 'park_small', name: 'Small Park',
    category: 'service', size: [1, 1],
    cost: 1000, monthlyUpkeep: 200,
    provides: { happiness: 5, radius: 4, jobs: 1 },
    requires: {},
    color: 0xa5d6a7, height: 0.2,
    unlockAtLevel: 1, description: '+5 happiness, radius 4. 1 job.',
  },
  park_medium: {
    id: 'park_medium', name: 'Medium Park',
    category: 'service', size: [2, 2],
    cost: 3000, monthlyUpkeep: 500,
    provides: { happiness: 10, radius: 7, jobs: 3 },
    requires: {},
    color: 0x66bb6a, height: 0.25,
    unlockAtLevel: 2, description: '+10 happiness, radius 7. 3 jobs.',
  },
  park_large: {
    id: 'park_large', name: 'Large Park',
    category: 'service', size: [3, 3],
    cost: 8000, monthlyUpkeep: 1200,
    provides: { happiness: 20, radius: 12, jobs: 6 },
    requires: {},
    color: 0x388e3c, height: 0.3,
    unlockAtLevel: 3, description: '+20 happiness, radius 12. 6 jobs.',
  },

  // ── Infrastructure ───────────────────────────────────────────────
  road: {
    id: 'road', name: 'Road',
    category: 'infra', size: 1,
    cost: 100, monthlyUpkeep: 0,
    provides: {}, requires: {},
    color: 0x424242, height: 0.05,
    unlockAtLevel: 1, description: 'Connects zones to services.',
  },
  generator_small: {
    id: 'generator_small', name: 'Diesel Generator',
    category: 'infra', size: [1, 1],
    cost: 3000, monthlyUpkeep: 600,
    provides: { power_kw: 150 },
    requires: {},
    color: 0xff9800, height: 0.9,
    unlockAtLevel: 1, description: 'Small diesel generator. Enough for a fledgling town.',
  },
  power_plant: {
    id: 'power_plant', name: 'Coal Power Plant',
    category: 'infra', size: [2, 2],
    cost: 10000, monthlyUpkeep: 2000,
    provides: { power_kw: 600 },
    requires: {},
    color: 0xff5722, height: 1.5,
    unlockAtLevel: 1, description: 'Coal-fired plant. High output, high upkeep.',
  },
  solar_farm: {
    id: 'solar_farm', name: 'Solar Farm',
    category: 'infra', size: [3, 3],
    cost: 20000, monthlyUpkeep: 500,
    provides: { power_kw: 400 },
    requires: {},
    color: 0xffee58, height: 0.3,
    unlockAtLevel: 3, description: 'Clean energy. No fuel cost, moderate output.',
  },
  nuclear_plant: {
    id: 'nuclear_plant', name: 'Nuclear Plant',
    category: 'infra', size: [3, 3],
    cost: 80000, monthlyUpkeep: 3000,
    provides: { power_kw: 2000 },
    requires: {},
    color: 0x80cbc4, height: 2.0,
    unlockAtLevel: 5, description: 'Massive power output. Expensive to build.',
  },
  water_pump_small: {
    id: 'water_pump_small', name: 'Small Water Pump',
    category: 'infra', size: [1, 1],
    cost: 2500, monthlyUpkeep: 500,
    provides: { water_units: 80 },
    requires: {},
    color: 0x4dd0e1, height: 0.7,
    unlockAtLevel: 1, description: 'Basic pump. Enough for early residential growth.',
  },
  water_pump: {
    id: 'water_pump', name: 'Water Pumping Station',
    category: 'infra', size: [2, 2],
    cost: 8000, monthlyUpkeep: 1500,
    provides: { water_units: 320 },
    requires: {},
    color: 0x00bcd4, height: 1.0,
    unlockAtLevel: 1, description: 'Full-scale pumping station for a growing city.',
  },

  // ── Bridge (placed automatically when road is drawn over river) ───
  bridge: {
    id: 'bridge', name: 'Bridge',
    category: 'infra', size: 1,
    cost: 150, monthlyUpkeep: 2,
    provides: {}, requires: {},
    color: 0x546e7a, height: 0.22,
    unlockAtLevel: 1, description: 'Road over water. Costs €150/tile.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Geometry / material caches
// ─────────────────────────────────────────────────────────────────────────────

const _geoCache = new Map();
const _matCache = new Map();

/** @param {number} w @param {number} h @param {number} d */
function cachedBox(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return _geoCache.get(k);
}

/** @param {number} color */
function cachedMat(color) {
  if (!_matCache.has(color))
    _matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return _matCache.get(color);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared permanent material map M
// ─────────────────────────────────────────────────────────────────────────────

const M = {
  window:       cachedMat(0x1a237e),
  windowShop:   cachedMat(0x0d47a1),
  path:         cachedMat(0x9e9e9e),
  chimney:      cachedMat(0x5d4037),
  chimneyMetal: cachedMat(0x546e7a),
  fencePost:    cachedMat(0x757575),
  fenceRail:    cachedMat(0x9e9e9e),
  crate:        cachedMat(0x8d6e63),
  barrel:       cachedMat(0x37474f),
  barrelRing:   cachedMat(0x78909c),
  asphalt:      cachedMat(0x424242),
  bush:         cachedMat(0x388e3c),
  tree:         cachedMat(0x1b5e20),
  treeTrunk:    cachedMat(0x5d4037),
  parkPath:     cachedMat(0xd7ccc8),
  bench:        cachedMat(0x6d4c41),
  garage:       cachedMat(0x78909c),
  garageDark:   cachedMat(0x37474f),
  gold:         cachedMat(0xffc107),
  fireRed:      cachedMat(0xb71c1c),
  concrete:     cachedMat(0xe0e0e0),
  tank:         cachedMat(0x607d8b),
  stripe:       cachedMat(0xfafafa),
  // Plot garden / garage materials
  wood:         cachedMat(0x8d6e63),  // brown fence
  darkMetal:    cachedMat(0x424242),  // dark grey garage door
  wall:         cachedMat(0xeceff1),  // garage wall
  roof2:        cachedMat(0x78909c),  // garage flat roof
};

// ─────────────────────────────────────────────────────────────────────────────
// Seeded RNG
// ─────────────────────────────────────────────────────────────────────────────

/** xorshift32 seeded RNG — returns a function that yields [0,1) floats. */
function mkRand(seed) {
  let s = (seed | 0) || 1;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

/** Pick a random element from arr using rng. */
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level builder helpers  (all add directly into a THREE.Group g)
// ─────────────────────────────────────────────────────────────────────────────

function addBox(g, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function addCyl(g, rt, rb, h, x, y, z, mat, segs = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/** Gable roof via ExtrudeGeometry — ridge runs along X axis. */
function addGableRoof(g, w, d, roofH, yBase, mat) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo( d / 2, 0);
  shape.lineTo( 0,     roofH);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  const m = new THREE.Mesh(geo, mat);
  // extrusion goes along Z, shift so it is centred
  m.position.set(-w / 2, yBase, -d / 2);
  // rotate so ridge runs along X (extrusion was along local Z, rotate -90° around Y)
  m.rotation.y = Math.PI / 2;
  // after rotation: local-Z extrusion becomes local-X, local-X triangle becomes local-Z
  // re-center X
  m.position.set(0, yBase, 0);
  // We need to redo this properly: extrude along Z, rotate so the triangle profile is in X-Y plane
  // Let's build it with the profile in X-Y and extrude along Z:
  m.castShadow = true;
  g.add(m);
  return m;
}

/** Flat roof slab sitting on yTop. */
function addFlatRoof(g, w, d, thick, yTop, mat) {
  return addBox(g, w, thick, d, 0, yTop - thick / 2, 0, mat);
}

/** N-S path strip (runs in Z direction). */
function addPath(g, zStart, zEnd, width, yBase) {
  const len = Math.abs(zEnd - zStart);
  const zMid = (zStart + zEnd) / 2;
  return addBox(g, width, 0.008, len, 0, yBase + 0.004, zMid, M.path);
}

/** Square brick chimney. */
function addChimney(g, cx, cz, height, yBase) {
  return addBox(g, 0.06, height, 0.06, cx, yBase + height / 2, cz, M.chimney);
}

/** Round metal chimney pipe. */
function addRoundChimney(g, cx, cz, height, yBase) {
  return addCyl(g, 0.04, 0.05, height, cx, yBase + height / 2, cz, M.chimneyMetal, 6);
}

/** Small wooden crate. */
function addCrate(g, cx, cz, yBase, size = 0.09) {
  return addBox(g, size, size, size, cx, yBase + size / 2, cz, M.crate);
}

/** Metal barrel with ring bands. */
function addBarrel(g, cx, cz, yBase) {
  addCyl(g, 0.04, 0.05, 0.12, cx, yBase + 0.06, cz, M.barrel, 8);
  addCyl(g, 0.051, 0.051, 0.015, cx, yBase + 0.04, cz, M.barrelRing, 8);
  addCyl(g, 0.051, 0.051, 0.015, cx, yBase + 0.09, cz, M.barrelRing, 8);
}

/** Simple tree: trunk + two foliage spheres approximated by cylinders. */
function addTree(g, cx, cz, yBase) {
  // trunk
  addCyl(g, 0.025, 0.03, 0.12, cx, yBase + 0.06, cz, M.treeTrunk, 6);
  // foliage — stacked cylinders to approximate a cone
  addCyl(g, 0.09, 0.11, 0.10, cx, yBase + 0.17, cz, M.tree, 7);
  addCyl(g, 0.06, 0.09, 0.09, cx, yBase + 0.25, cz, M.tree, 7);
  addCyl(g, 0.02, 0.06, 0.07, cx, yBase + 0.32, cz, M.tree, 7);
}

/** Round bush. */
function addBush(g, cx, cz, yBase) {
  addCyl(g, 0.07, 0.08, 0.09, cx, yBase + 0.045, cz, M.bush, 7);
}

/** Fence strip along X at constant Z. */
function addFenceX(g, x1, x2, z, yBase) {
  const len = Math.abs(x2 - x1);
  const mid = (x1 + x2) / 2;
  // rail
  addBox(g, len, 0.02, 0.015, mid, yBase + 0.07, z, M.fenceRail);
  addBox(g, len, 0.02, 0.015, mid, yBase + 0.12, z, M.fenceRail);
  // posts every ~0.18
  const count = Math.max(2, Math.round(len / 0.18));
  for (let i = 0; i <= count; i++) {
    const px = x1 + (x2 - x1) * (i / count);
    addBox(g, 0.015, 0.16, 0.015, px, yBase + 0.08, z, M.fencePost);
  }
}

/** Fence strip along Z at constant X. */
function addFenceZ(g, z1, z2, x, yBase) {
  const len = Math.abs(z2 - z1);
  const mid = (z1 + z2) / 2;
  addBox(g, 0.015, 0.02, len, x, yBase + 0.07, mid, M.fenceRail);
  addBox(g, 0.015, 0.02, len, x, yBase + 0.12, mid, M.fenceRail);
  const count = Math.max(2, Math.round(len / 0.18));
  for (let i = 0; i <= count; i++) {
    const pz = z1 + (z2 - z1) * (i / count);
    addBox(g, 0.015, 0.16, 0.015, x, yBase + 0.08, pz, M.fencePost);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gable roof — proper implementation
// A triangular prism with ridge along X, resting on yBase, spanning ±d/2 in Z.
// ─────────────────────────────────────────────────────────────────────────────

function _gableRoof(g, w, d, roofH, yBase, mat) {
  // Profile triangle in X-Y plane, extruded along -Z
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo( w / 2, 0);
  shape.lineTo( 0,     roofH);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  const m = new THREE.Mesh(geo, mat);
  // ExtrudeGeometry extrudes along +Z from z=0 to z=depth.
  // We want it centred: shift -d/2 so it spans -d/2 to +d/2 in Z.
  m.position.set(0, yBase, -d / 2);
  m.castShadow = true;
  g.add(m);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIDENTIAL variants
// ─────────────────────────────────────────────────────────────────────────────

const WALL_COLORS  = [0xfff8dc, 0xffccbc, 0xe0e0e0, 0xc8e6c9, 0xfafafa, 0xffe0b2, 0xf5deb3];
const ROOF_COLORS  = [0xb71c1c, 0x5d4037, 0xbf360c, 0x455a64, 0x2e7d32];
const DOOR_COLORS  = [0xc62828, 0x1b5e20, 0x0d47a1, 0xe65100, 0x212121, 0x880e4f];

/** Variant 0 — Classic gable cottage */
function _r0Cottage(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat = cachedMat(pick(rng, WALL_COLORS));
  const roofMat = cachedMat(pick(rng, ROOF_COLORS));
  const doorMat = cachedMat(pick(rng, DOOR_COLORS));

  // Body
  addBox(g, 0.70, 0.44, 0.66, 0, yBot + 0.22, 0, wallMat);
  // Gable roof
  _gableRoof(g, 0.74, 0.70, 0.24, yBot + 0.44, roofMat);
  // Chimney (70%)
  if (rng() < 0.70) addChimney(g, 0.18, -0.20, 0.16, yBot + 0.44 + 0.24 * 0.65);
  // South face (+Z) — door + 2 flanking windows
  addBox(g, 0.10, 0.15, 0.012, 0,      yBot + 0.12, 0.333, doorMat);
  addBox(g, 0.13, 0.10, 0.012, -0.22,  yBot + 0.28, 0.333, M.window);
  addBox(g, 0.13, 0.10, 0.012,  0.22,  yBot + 0.28, 0.333, M.window);
  // East face (+X) — 2 windows
  addBox(g, 0.012, 0.10, 0.13, 0.35, yBot + 0.28, -0.10, M.window);
  addBox(g, 0.012, 0.10, 0.13, 0.35, yBot + 0.28,  0.10, M.window);
  // Path
  addPath(g, 0.33, 0.46, 0.12, yBot);
  return g;
}

/** Variant 1 — Modern flat-roof */
function _r1Modern(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;
  const yTop =  h / 2;

  const wallMat = cachedMat(pick(rng, [0xe0e0e0, 0xfafafa, 0xeceff1, 0xf5f5f5]));
  const doorMat = cachedMat(pick(rng, DOOR_COLORS));

  // Body
  addBox(g, 0.76, 0.50, 0.64, 0, yBot + 0.25, 0, wallMat);
  // Flat roof slab
  addBox(g, 0.80, 0.04, 0.68, 0, yTop - 0.02, 0, cachedMat(0x9e9e9e));
  // Parapet strips
  const pMat = cachedMat(0x78909c);
  addBox(g, 0.80, 0.05, 0.04, 0,      yTop + 0.025,  0.32, pMat); // south
  addBox(g, 0.80, 0.05, 0.04, 0,      yTop + 0.025, -0.32, pMat); // north
  addBox(g, 0.04, 0.05, 0.68, 0.38,  yTop + 0.025,  0,    pMat); // east
  addBox(g, 0.04, 0.05, 0.68, -0.38, yTop + 0.025,  0,    pMat); // west
  // South face — large horizontal window + door
  addBox(g, 0.42, 0.18, 0.012, 0,     yBot + 0.32, 0.32, M.windowShop);
  addBox(g, 0.10, 0.18, 0.012, 0.27,  yBot + 0.17, 0.32, doorMat);
  // East face — 2 square windows
  addBox(g, 0.012, 0.12, 0.12, 0.38, yBot + 0.30, -0.12, M.window);
  addBox(g, 0.012, 0.12, 0.12, 0.38, yBot + 0.30,  0.12, M.window);
  // Path
  addPath(g, 0.32, 0.46, 0.12, yBot);
  return g;
}

/** Variant 2 — L-shaped bungalow */
function _r2LShape(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat1 = cachedMat(pick(rng, WALL_COLORS));
  const wallMat2 = cachedMat(pick(rng, WALL_COLORS));
  const roofMat  = cachedMat(0x607d8b);
  const doorMat  = cachedMat(pick(rng, DOOR_COLORS));

  // Main body (wide)
  addBox(g, 0.72, 0.38, 0.46, -0.10, yBot + 0.19, -0.12, wallMat1);
  // Wing body (deep)
  addBox(g, 0.36, 0.34, 0.54,  0.22, yBot + 0.17,  0.10, wallMat2);
  // Flat roofs
  addBox(g, 0.74, 0.04, 0.48, -0.10, yBot + 0.40, -0.12, roofMat);
  addBox(g, 0.38, 0.04, 0.56,  0.22, yBot + 0.37,  0.10, roofMat);
  // Door on south face of main body
  addBox(g, 0.10, 0.16, 0.012, -0.10, yBot + 0.12, 0.12, doorMat);
  // Windows — main body south
  addBox(g, 0.12, 0.10, 0.012, -0.32, yBot + 0.26, 0.12, M.window);
  addBox(g, 0.12, 0.10, 0.012,  0.10, yBot + 0.26, 0.12, M.window);
  // Wing east face
  addBox(g, 0.012, 0.10, 0.12, 0.40, yBot + 0.24, 0.05, M.window);
  // Path
  addPath(g, 0.12, 0.46, 0.12, yBot);
  return g;
}

/** Variant 3 — Tall narrow Victorian */
function _r3Tall(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat = cachedMat(pick(rng, [0xfff8dc, 0xffccbc, 0xffe0b2, 0xf5deb3]));
  const roofMat = cachedMat(pick(rng, ROOF_COLORS));
  const doorMat = cachedMat(pick(rng, DOOR_COLORS));

  // Body
  addBox(g, 0.56, 0.52, 0.60, 0, yBot + 0.26, 0, wallMat);
  // Steep gable roof
  _gableRoof(g, 0.60, 0.64, 0.30, yBot + 0.52, roofMat);
  // Tall chimney
  addChimney(g, 0.16, -0.18, 0.20, yBot + 0.52 + 0.30 * 0.50);
  // South face — narrow door + 2 tall windows
  addBox(g, 0.09, 0.20, 0.012, 0,     yBot + 0.18, 0.30, doorMat);
  addBox(g, 0.09, 0.20, 0.012, -0.19, yBot + 0.32, 0.30, M.window);
  addBox(g, 0.09, 0.20, 0.012,  0.19, yBot + 0.32, 0.30, M.window);
  // East face — 1 tall window
  addBox(g, 0.012, 0.20, 0.09, 0.28, yBot + 0.32, 0, M.window);
  // Path
  addPath(g, 0.30, 0.46, 0.10, yBot);
  return g;
}

/** Variant 4 — Wide ranch/bungalow */
function _r4Ranch(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat    = cachedMat(pick(rng, WALL_COLORS));
  const garageMat  = cachedMat(0xeceff1);
  const roofMat    = cachedMat(0x607d8b);
  const doorMat    = cachedMat(pick(rng, DOOR_COLORS));

  // Main body
  addBox(g, 0.82, 0.36, 0.54, 0, yBot + 0.18, 0, wallMat);
  // Garage stub (east side)
  addBox(g, 0.28, 0.32, 0.40, 0.27, yBot + 0.16, -0.10, garageMat);
  // Flat roofs
  addBox(g, 0.84, 0.04, 0.56, 0,    yBot + 0.38, 0,     roofMat);
  addBox(g, 0.30, 0.04, 0.42, 0.27, yBot + 0.34, -0.10, roofMat);
  // Wide south window + door
  addBox(g, 0.40, 0.14, 0.012, -0.14, yBot + 0.24, 0.27, M.windowShop);
  addBox(g, 0.10, 0.18, 0.012,  0.20, yBot + 0.15, 0.27, doorMat);
  // East face — garage door
  addBox(g, 0.012, 0.22, 0.30, 0.415, yBot + 0.14, -0.10, M.garageDark);
  // Path
  addPath(g, 0.27, 0.46, 0.14, yBot);
  return g;
}

function _createResidentialMesh(def, rng) {
  const variants = [_r0Cottage, _r1Modern, _r2LShape, _r3Tall, _r4Ranch];
  const idx = Math.floor(rng() * variants.length);
  return variants[idx](def, rng);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMERCIAL variants
// ─────────────────────────────────────────────────────────────────────────────

const COMMERCIAL_WALL   = [0xfff8e1, 0xe3f2fd, 0xeceff1, 0xfbe9e7, 0xf3e5f5, 0xfafafa];
const AWNING_COLORS     = [0xc62828, 0x1565c0, 0x2e7d32, 0xe65100, 0x6a1b9a, 0x00695c];

/** Variant 0 — Single story shop with awning */
function _c0Shop(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat   = cachedMat(pick(rng, COMMERCIAL_WALL));
  const awningCol = pick(rng, AWNING_COLORS);
  const awningMat = cachedMat(awningCol);
  const doorMat   = cachedMat(pick(rng, DOOR_COLORS));

  // Body
  addBox(g, 0.78, 0.68, 0.76, 0, yBot + 0.34, 0, wallMat);
  // Flat roof
  addBox(g, 0.80, 0.04, 0.78, 0, yBot + 0.70, 0, cachedMat(0x9e9e9e));
  // Sign band (south)
  addBox(g, 0.78, 0.12, 0.015, 0, yBot + 0.56, 0.388, awningMat);
  // Shop window (south)
  addBox(g, 0.52, 0.28, 0.012, 0, yBot + 0.28, 0.397, M.windowShop);
  // Door (south, offset)
  addBox(g, 0.11, 0.22, 0.012, 0.27, yBot + 0.13, 0.397, doorMat);
  // Awning slab
  addBox(g, 0.60, 0.04, 0.14, 0, yBot + 0.52, 0.460, awningMat);
  // East windows
  addBox(g, 0.012, 0.16, 0.18, 0.39, yBot + 0.36, -0.15, M.window);
  addBox(g, 0.012, 0.16, 0.18, 0.39, yBot + 0.36,  0.15, M.window);
  // Path
  addPath(g, 0.38, 0.48, 0.14, yBot);
  return g;
}

/** Variant 1 — Two-story building */
function _c1TwoStory(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallCol1  = pick(rng, COMMERCIAL_WALL);
  // slightly darker upper floor
  const wallMat1  = cachedMat(wallCol1);
  const wallMat2  = cachedMat(0xbdbdbd);
  const doorMat   = cachedMat(pick(rng, DOOR_COLORS));
  const parapetMat = cachedMat(0x78909c);

  // Ground floor
  addBox(g, 0.78, 0.55, 0.78, 0, yBot + 0.275, 0, wallMat1);
  // Upper floor
  addBox(g, 0.72, 0.52, 0.72, 0, yBot + 0.55 + 0.26, 0, wallMat2);
  // Roof parapet
  const rY = yBot + 1.09;
  addBox(g, 0.72, 0.06, 0.04, 0,      rY, 0.34,  parapetMat);
  addBox(g, 0.72, 0.06, 0.04, 0,      rY, -0.34, parapetMat);
  addBox(g, 0.04, 0.06, 0.72, 0.34,  rY, 0,     parapetMat);
  addBox(g, 0.04, 0.06, 0.72, -0.34, rY, 0,     parapetMat);
  // Ground floor south: large window + door
  addBox(g, 0.52, 0.24, 0.012, -0.06, yBot + 0.24, 0.39, M.windowShop);
  addBox(g, 0.12, 0.26, 0.012,  0.30, yBot + 0.17, 0.39, doorMat);
  // Upper floor south: 3 windows
  addBox(g, 0.14, 0.18, 0.012, -0.24, yBot + 0.81, 0.36, M.window);
  addBox(g, 0.14, 0.18, 0.012,  0.00, yBot + 0.81, 0.36, M.window);
  addBox(g, 0.14, 0.18, 0.012,  0.24, yBot + 0.81, 0.36, M.window);
  // East face: ground + upper windows
  addBox(g, 0.012, 0.20, 0.22, 0.39, yBot + 0.28, -0.05, M.window);
  addBox(g, 0.012, 0.18, 0.20, 0.36, yBot + 0.80,  0.00, M.window);
  // Path
  addPath(g, 0.39, 0.50, 0.14, yBot);
  return g;
}

/** Variant 2 — Wide shop with parking */
function _c2Parking(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat   = cachedMat(pick(rng, COMMERCIAL_WALL));
  const awningMat = cachedMat(pick(rng, AWNING_COLORS));
  const doorMat   = cachedMat(pick(rng, DOOR_COLORS));

  // Body
  addBox(g, 0.82, 0.62, 0.68, 0, yBot + 0.31, 0, wallMat);
  // Flat roof
  addBox(g, 0.84, 0.04, 0.70, 0, yBot + 0.64, 0, cachedMat(0x9e9e9e));
  // Parking slab in front (south)
  addBox(g, 0.82, 0.005, 0.30, 0, yBot + 0.003, 0.49, M.asphalt);
  // Parking stripes
  addBox(g, 0.010, 0.006, 0.22, -0.20, yBot + 0.006, 0.49, M.stripe);
  addBox(g, 0.010, 0.006, 0.22,  0.20, yBot + 0.006, 0.49, M.stripe);
  // Shop window south
  addBox(g, 0.60, 0.26, 0.012, 0, yBot + 0.30, 0.34, M.windowShop);
  // Door south
  addBox(g, 0.11, 0.24, 0.012, 0.30, yBot + 0.15, 0.34, doorMat);
  // Sign strip south
  addBox(g, 0.82, 0.10, 0.015, 0, yBot + 0.52, 0.348, awningMat);
  // East windows
  addBox(g, 0.012, 0.18, 0.20, 0.41, yBot + 0.36, -0.10, M.window);
  addBox(g, 0.012, 0.18, 0.20, 0.41, yBot + 0.36,  0.10, M.window);
  return g;
}

/** Variant 3 — Corner-style with full-width canopy */
function _c3Corner(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat   = cachedMat(pick(rng, COMMERCIAL_WALL));
  const canopyMat = cachedMat(pick(rng, AWNING_COLORS));
  const doorMat   = cachedMat(pick(rng, DOOR_COLORS));

  // Body
  addBox(g, 0.80, 0.64, 0.80, 0, yBot + 0.32, 0, wallMat);
  // Flat roof
  addBox(g, 0.82, 0.04, 0.82, 0, yBot + 0.66, 0, cachedMat(0x9e9e9e));
  // South canopy
  addBox(g, 0.84, 0.06, 0.18, 0, yBot + 0.56, 0.49, canopyMat);
  // East canopy
  addBox(g, 0.18, 0.06, 0.84, 0.49, yBot + 0.56, 0, canopyMat);
  // Large south window
  addBox(g, 0.54, 0.30, 0.012, -0.05, yBot + 0.30, 0.40, M.windowShop);
  // Door south (offset)
  addBox(g, 0.12, 0.26, 0.012,  0.28, yBot + 0.17, 0.40, doorMat);
  // Large east window
  addBox(g, 0.012, 0.30, 0.54, 0.40, yBot + 0.30, -0.05, M.windowShop);
  // Path
  addPath(g, 0.40, 0.50, 0.14, yBot);
  return g;
}

function _createCommercialMesh(def, rng) {
  const variants = [_c0Shop, _c1TwoStory, _c2Parking, _c3Corner];
  const idx = Math.floor(rng() * variants.length);
  return variants[idx](def, rng);
}

// ─────────────────────────────────────────────────────────────────────────────
// INDUSTRIAL variants
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRIAL_WALL = [0x78909c, 0x9e9e9e, 0x795548, 0x607d8b, 0xb0bec5, 0x5d4037];

/** Variant 0 — Warehouse with loading bay + crates */
function _i0Warehouse(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat = cachedMat(pick(rng, INDUSTRIAL_WALL));

  // Main shed
  addBox(g, 0.82, 0.58, 0.78, 0, yBot + 0.29, 0, wallMat);
  // Flat metal roof
  addBox(g, 0.84, 0.04, 0.80, 0, yBot + 0.60, 0, M.garage);
  // Loading bay (south)
  addBox(g, 0.50, 0.16, 0.20, 0, yBot + 0.08, 0.49, cachedMat(0xb0bec5));
  // Roll-up door (south)
  addBox(g, 0.44, 0.32, 0.012, 0, yBot + 0.22, 0.39, M.garageDark);
  // Small high windows south
  addBox(g, 0.12, 0.08, 0.012, -0.22, yBot + 0.50, 0.39, M.window);
  addBox(g, 0.12, 0.08, 0.012,  0.22, yBot + 0.50, 0.39, M.window);
  // Crates near SE corner
  addCrate(g,  0.28, 0.28, yBot);
  addCrate(g,  0.38, 0.20, yBot);
  addCrate(g,  0.28, 0.38, yBot, 0.08);
  // Barrel
  addBarrel(g, 0.38, 0.35, yBot);
  // Pipe chimney (NE)
  addRoundChimney(g, 0.28, -0.28, 0.18, yBot + 0.60);
  return g;
}

/** Variant 1 — Factory with 2 chimneys */
function _i1Factory(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat = cachedMat(pick(rng, INDUSTRIAL_WALL));

  // Factory body
  addBox(g, 0.80, 0.60, 0.80, 0, yBot + 0.30, 0, wallMat);
  // Flat roof
  addBox(g, 0.82, 0.04, 0.82, 0, yBot + 0.62, 0, M.garage);
  // 2 round chimneys
  addRoundChimney(g,  0.22, -0.22, 0.28, yBot + 0.62);
  addRoundChimney(g, -0.22, -0.22, 0.28, yBot + 0.62);
  // Monitor windows on roof (sawtooth hint)
  addBox(g,  0.30, 0.08, 0.04, 0, yBot + 0.66, -0.10, M.window);
  addBox(g,  0.30, 0.08, 0.04, 0, yBot + 0.66,  0.10, M.window);
  // South windows (high)
  addBox(g, 0.10, 0.08, 0.012, -0.28, yBot + 0.50, 0.40, M.window);
  addBox(g, 0.10, 0.08, 0.012,  0.00, yBot + 0.50, 0.40, M.window);
  addBox(g, 0.10, 0.08, 0.012,  0.28, yBot + 0.50, 0.40, M.window);
  // East windows (high)
  addBox(g, 0.012, 0.08, 0.10, 0.40, yBot + 0.50, -0.20, M.window);
  addBox(g, 0.012, 0.08, 0.10, 0.40, yBot + 0.50,  0.00, M.window);
  addBox(g, 0.012, 0.08, 0.10, 0.40, yBot + 0.50,  0.20, M.window);
  // Industrial door (south)
  addBox(g, 0.16, 0.28, 0.012, 0, yBot + 0.18, 0.40, M.garageDark);
  return g;
}

/** Variant 2 — Metal shed with fence yard + barrels */
function _i2FenceYard(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat = cachedMat(pick(rng, [0x78909c, 0x9e9e9e, 0x607d8b, 0xb0bec5]));

  // Main shed
  addBox(g, 0.72, 0.52, 0.72, 0, yBot + 0.26, 0, wallMat);
  // Roof
  addBox(g, 0.74, 0.04, 0.74, 0, yBot + 0.54, 0, M.chimneyMetal);
  // Pipe chimney
  addRoundChimney(g, -0.22, -0.22, 0.20, yBot + 0.54);
  // Metal door south
  addBox(g, 0.14, 0.24, 0.012, 0, yBot + 0.14, 0.36, M.garageDark);
  // Windows south
  addBox(g, 0.10, 0.08, 0.012, -0.22, yBot + 0.42, 0.36, M.window);
  addBox(g, 0.10, 0.08, 0.012,  0.22, yBot + 0.42, 0.36, M.window);
  // Fence yard in SE corner: fence from (0.10,0.10) to (0.42,0.42)
  addFenceX(g, 0.10, 0.42, 0.42, yBot);
  addFenceX(g, 0.10, 0.42, 0.10, yBot);
  addFenceZ(g, 0.10, 0.42, 0.10, yBot);
  addFenceZ(g, 0.10, 0.42, 0.42, yBot);
  // Barrels inside yard
  addBarrel(g, 0.20, 0.22, yBot);
  addBarrel(g, 0.30, 0.22, yBot);
  addBarrel(g, 0.20, 0.32, yBot);
  return g;
}

/** Variant 3 — Processing plant with storage tank */
function _i3Tank(def, rng) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat = cachedMat(pick(rng, INDUSTRIAL_WALL));

  // Building body
  addBox(g, 0.64, 0.62, 0.64, 0, yBot + 0.31, 0, wallMat);
  // Roof
  addBox(g, 0.66, 0.04, 0.66, 0, yBot + 0.64, 0, M.chimneyMetal);
  // Cylindrical storage tank
  addCyl(g, 0.14, 0.14, 0.40, 0.28, yBot + 0.20, -0.15, M.tank, 10);
  // Dome on tank
  addCyl(g, 0.14, 0.01, 0.06, 0.28, yBot + 0.43, -0.15, M.tank, 10);
  // Connection pipe (thin horizontal)
  addBox(g, 0.20, 0.04, 0.04, 0.14, yBot + 0.24, -0.15, M.chimneyMetal);
  // Fence around tank
  addFenceX(g, 0.12, 0.44, -0.30, yBot);
  addFenceX(g, 0.12, 0.44,  0.00, yBot);
  addFenceZ(g, -0.30, 0.00, 0.12, yBot);
  addFenceZ(g, -0.30, 0.00, 0.44, yBot);
  // Windows on building
  addBox(g, 0.10, 0.08, 0.012, -0.18, yBot + 0.48, 0.32, M.window);
  addBox(g, 0.10, 0.08, 0.012,  0.10, yBot + 0.48, 0.32, M.window);
  addBox(g, 0.012, 0.08, 0.10, 0.32, yBot + 0.48, -0.10, M.window);
  return g;
}

function _createIndustrialMesh(def, rng) {
  const variants = [_i0Warehouse, _i1Factory, _i2FenceYard, _i3Tank];
  const idx = Math.floor(rng() * variants.length);
  return variants[idx](def, rng);
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE BUILDINGS
// ─────────────────────────────────────────────────────────────────────────────

function _createPoliceStation(def) {
  const g    = new THREE.Group();
  const [bw, bd] = [2, 2];
  const h    = def.height;
  const yBot = -h / 2;

  const mainMat    = cachedMat(0xbbdefb);
  const upperMat   = cachedMat(0x90caf9);
  const garageMat  = cachedMat(0xeceff1);
  const frameMat   = cachedMat(0x78909c);

  // Main building body
  addBox(g, 1.72, 0.80, 1.10, 0, yBot + 0.40, -0.20, mainMat);
  // Second story
  addBox(g, 1.50, 0.32, 0.90, 0, yBot + 0.96, -0.20, upperMat);
  // Flat roof on main
  addBox(g, 1.74, 0.04, 1.12, 0, yBot + 0.82, -0.20, frameMat);
  // Garage section (south)
  addBox(g, 1.72, 0.55, 0.60, 0, yBot + 0.275, 0.56, garageMat);
  addBox(g, 1.74, 0.04, 0.62, 0, yBot + 0.57,  0.56, frameMat);
  // Garage door openings (south face of garage)
  addBox(g, 0.52, 0.38, 0.014, -0.42, yBot + 0.22, 0.868, M.garageDark);
  addBox(g, 0.52, 0.38, 0.014,  0.42, yBot + 0.22, 0.868, M.garageDark);
  // Door frames
  addBox(g, 0.56, 0.42, 0.010, -0.42, yBot + 0.22, 0.864, frameMat);
  addBox(g, 0.56, 0.42, 0.010,  0.42, yBot + 0.22, 0.864, frameMat);
  // Police badge (gold disc on main roof)
  addCyl(g, 0.20, 0.20, 0.025, 0, yBot + 0.845, -0.20, M.gold, 12);
  addCyl(g, 0.10, 0.10, 0.030, 0, yBot + 0.875, -0.20, cachedMat(0xe65100), 12);
  // Entrance step
  addBox(g, 0.40, 0.04, 0.16, 0, yBot + 0.04, 0.25, cachedMat(0xbdbdbd));
  // Entrance door
  addBox(g, 0.14, 0.22, 0.012, 0, yBot + 0.16, 0.257, cachedMat(0x0d47a1));
  // Windows on main building south face
  for (let xi = -3; xi <= 3; xi += 2) {
    if (Math.abs(xi) > 0.1) {
      addBox(g, 0.16, 0.14, 0.012, xi * 0.22, yBot + 0.56, 0.26, M.window);
    }
  }
  // Windows east face
  addBox(g, 0.012, 0.14, 0.16, 0.86, yBot + 0.56, -0.40, M.window);
  addBox(g, 0.012, 0.14, 0.16, 0.86, yBot + 0.56, -0.10, M.window);
  addBox(g, 0.012, 0.14, 0.16, 0.86, yBot + 0.56,  0.20, M.window);
  return g;
}

function _createFireStation(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const mainMat    = cachedMat(0xffccbc);
  const upperMat   = cachedMat(0xffab91);
  const garageMat  = cachedMat(0xef9a9a);
  const frameMat   = cachedMat(0xbf360c);
  const accentMat  = cachedMat(0xb71c1c);

  // Main building
  addBox(g, 1.72, 0.80, 1.10, 0, yBot + 0.40, -0.20, mainMat);
  // Upper section
  addBox(g, 1.50, 0.30, 0.90, 0, yBot + 0.95, -0.20, upperMat);
  // Flat roof
  addBox(g, 1.74, 0.04, 1.12, 0, yBot + 0.82, -0.20, frameMat);
  // Garage section
  addBox(g, 1.72, 0.60, 0.60, 0, yBot + 0.30, 0.56, garageMat);
  addBox(g, 1.74, 0.04, 0.62, 0, yBot + 0.62, 0.56, frameMat);
  // Garage doors
  addBox(g, 0.52, 0.38, 0.014, -0.42, yBot + 0.22, 0.868, M.garageDark);
  addBox(g, 0.52, 0.38, 0.014,  0.42, yBot + 0.22, 0.868, M.garageDark);
  addBox(g, 0.56, 0.42, 0.010, -0.42, yBot + 0.22, 0.864, frameMat);
  addBox(g, 0.56, 0.42, 0.010,  0.42, yBot + 0.22, 0.864, frameMat);
  // Fire emblem: red disc + gold disc
  addCyl(g, 0.22, 0.22, 0.025, 0, yBot + 0.845, -0.20, M.fireRed, 12);
  addCyl(g, 0.10, 0.10, 0.030, 0, yBot + 0.875, -0.20, M.gold, 12);
  // Red accent corner strips
  addBox(g, 0.04, 0.82, 0.04,  0.86, yBot + 0.41, -0.76, accentMat);
  addBox(g, 0.04, 0.82, 0.04, -0.86, yBot + 0.41, -0.76, accentMat);
  addBox(g, 0.04, 0.82, 0.04,  0.86, yBot + 0.41,  0.76, accentMat);
  addBox(g, 0.04, 0.82, 0.04, -0.86, yBot + 0.41,  0.76, accentMat);
  // Windows on main building
  addBox(g, 0.16, 0.14, 0.012, -0.44, yBot + 0.56, 0.26, M.window);
  addBox(g, 0.16, 0.14, 0.012,  0.00, yBot + 0.56, 0.26, M.window);
  addBox(g, 0.16, 0.14, 0.012,  0.44, yBot + 0.56, 0.26, M.window);
  addBox(g, 0.012, 0.14, 0.16, 0.86, yBot + 0.56, -0.30, M.window);
  addBox(g, 0.012, 0.14, 0.16, 0.86, yBot + 0.56,  0.00, M.window);
  return g;
}

function _createHospital(def) {
  const g    = new THREE.Group();
  const [bw, bd] = [3, 2];
  const h    = def.height;
  const yBot = -h / 2;

  const mainMat  = cachedMat(0xfafafa);
  const wingMat  = cachedMat(0xeceff1);
  const roofMat  = cachedMat(0xe0e0e0);
  const accentMat = cachedMat(0x90caf9);

  // Main block: 3×2 footprint
  const bboxW = bw - 0.22;   // 2.78
  const bboxD = bd - 0.22;   // 1.78
  // Multi-story main body
  addBox(g, bboxW, 1.40, bboxD, 0, yBot + 0.70, 0, mainMat);
  // Upper floor (slightly recessed)
  addBox(g, bboxW - 0.20, 0.36, bboxD - 0.10, 0, yBot + 1.58, 0, wingMat);
  // Flat roof
  addBox(g, bboxW, 0.05, bboxD, 0, yBot + 1.425, 0, roofMat);
  // Red cross on roof
  addBox(g, 0.40, 0.06, 0.12, 0, yBot + 1.46, 0, M.fireRed);
  addBox(g, 0.12, 0.06, 0.40, 0, yBot + 1.46, 0, M.fireRed);
  // Entrance canopy (south)
  addBox(g, 0.60, 0.06, 0.20, 0, yBot + 0.80, bboxD / 2 + 0.10, accentMat);
  // Entrance door
  addBox(g, 0.18, 0.28, 0.012, 0, yBot + 0.20, bboxD / 2 + 0.01, cachedMat(0x1565c0));
  // Ground floor windows south
  for (let xi = -1; xi <= 1; xi++) {
    if (xi !== 0) {
      addBox(g, 0.20, 0.20, 0.012, xi * 0.70, yBot + 0.48, bboxD / 2 + 0.01, M.window);
      addBox(g, 0.20, 0.20, 0.012, xi * 0.70, yBot + 0.90, bboxD / 2 + 0.01, M.window);
    }
  }
  // Upper floor windows south
  for (let xi = -2; xi <= 2; xi++) {
    addBox(g, 0.18, 0.18, 0.012, xi * 0.50, yBot + 1.26, bboxD / 2 + 0.01, M.window);
  }
  // East face windows
  for (let zi = -1; zi <= 1; zi++) {
    addBox(g, 0.012, 0.20, 0.20, bboxW / 2 + 0.01, yBot + 0.48, zi * 0.45, M.window);
    addBox(g, 0.012, 0.20, 0.20, bboxW / 2 + 0.01, yBot + 0.90, zi * 0.45, M.window);
  }
  return g;
}

function _createPrimarySchool(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const mainMat    = cachedMat(0xfff9c4);
  const upperMat   = cachedMat(0xffee58);
  const roofMat    = cachedMat(0xf9a825);
  const accentMat  = cachedMat(0xf57f17);

  // Main building: 2×2, bbox ~1.78 wide, ~1.78 deep
  addBox(g, 1.70, 0.72, 1.55, 0, yBot + 0.36, 0, mainMat);
  // Second story partial
  addBox(g, 1.20, 0.22, 1.20, 0, yBot + 0.83, 0, upperMat);
  // Flat roof
  addBox(g, 1.72, 0.04, 1.57, 0, yBot + 0.74, 0, roofMat);
  // Entrance step
  addBox(g, 1.00, 0.08, 0.20, 0, yBot + 0.04, 0.87, cachedMat(0xbdbdbd));
  // Entrance door
  addBox(g, 0.16, 0.28, 0.012, 0, yBot + 0.18, 0.78, accentMat);
  // Entrance canopy
  addBox(g, 0.30, 0.05, 0.16, 0, yBot + 0.46, 0.855, accentMat);
  // Ground floor south windows (6 evenly spaced)
  const winPositionsX = [-0.60, -0.36, -0.12, 0.12, 0.36, 0.60];
  for (const wx of winPositionsX) {
    addBox(g, 0.14, 0.16, 0.012, wx, yBot + 0.46, 0.778, M.window);
  }
  // Upper floor south windows (4)
  for (const wx of [-0.36, -0.12, 0.12, 0.36]) {
    addBox(g, 0.14, 0.14, 0.012, wx, yBot + 0.85, 0.61, M.window);
  }
  // East face windows (4)
  for (const wz of [-0.40, -0.13, 0.13, 0.40]) {
    addBox(g, 0.012, 0.16, 0.14, 0.86, yBot + 0.46, wz, M.window);
  }
  // 2 small trees flanking entrance
  addTree(g, -0.40, 0.60, yBot);
  addTree(g,  0.40, 0.60, yBot);
  return g;
}

function _createHighSchool(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  // 3×2 footprint: bboxW≈2.78, bboxD≈1.78
  const mainMat   = cachedMat(0xffe082);
  const upperMat  = cachedMat(0xffd54f);
  const roofMat   = cachedMat(0xf9a825);
  const accentMat = cachedMat(0xe65100);

  // Main building
  addBox(g, 2.70, 0.90, 1.70, 0, yBot + 0.45, 0, mainMat);
  // Third floor partial
  addBox(g, 2.20, 0.32, 1.40, 0, yBot + 1.06, 0, upperMat);
  // Flat roof
  addBox(g, 2.72, 0.04, 1.72, 0, yBot + 0.92, 0, roofMat);
  // Large entrance canopy (south)
  addBox(g, 0.70, 0.06, 0.22, 0, yBot + 0.78, 0.96, accentMat);
  // Entrance door
  addBox(g, 0.18, 0.30, 0.012, 0, yBot + 0.20, 0.86, accentMat);
  // Entrance step
  addBox(g, 0.50, 0.06, 0.14, 0, yBot + 0.04, 0.93, cachedMat(0xbdbdbd));
  // Parking strip (south, in front)
  addBox(g, 2.70, 0.006, 0.36, 0, yBot + 0.003, 1.24, M.asphalt);
  // Parking stripes
  for (let xi = -1; xi <= 1; xi++) {
    addBox(g, 0.010, 0.008, 0.28, xi * 0.65, yBot + 0.007, 1.24, M.stripe);
  }
  // Ground floor windows south (7)
  for (let i = -3; i <= 3; i++) {
    if (i !== 0) addBox(g, 0.18, 0.20, 0.012, i * 0.36, yBot + 0.54, 0.86, M.window);
  }
  // Upper floor windows south (7)
  for (let i = -3; i <= 3; i++) {
    addBox(g, 0.16, 0.18, 0.012, i * 0.30, yBot + 1.10, 0.72, M.window);
  }
  // East face windows (3 per floor)
  for (const wz of [-0.40, 0, 0.40]) {
    addBox(g, 0.012, 0.20, 0.18, 1.36, yBot + 0.54, wz, M.window);
    addBox(g, 0.012, 0.18, 0.16, 1.36, yBot + 1.10, wz, M.window);
  }
  // 4 trees in parking area
  addTree(g, -0.90, 1.28, yBot);
  addTree(g, -0.30, 1.28, yBot);
  addTree(g,  0.30, 1.28, yBot);
  addTree(g,  0.90, 1.28, yBot);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARKS
// ─────────────────────────────────────────────────────────────────────────────

function _createParkSmall(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;  // -0.1

  // Fence perimeter ~±0.38
  addFenceX(g, -0.38, 0.38,  0.38, yBot);
  addFenceX(g, -0.38, 0.38, -0.38, yBot);
  addFenceZ(g, -0.38, 0.38,  0.38, yBot);
  addFenceZ(g, -0.38, 0.38, -0.38, yBot);
  // N-S path through park
  addPath(g, -0.38, 0.38, 0.10, yBot);
  // 2-3 bushes inside
  addBush(g, -0.22, -0.18, yBot);
  addBush(g,  0.22,  0.18, yBot);
  addBush(g, -0.18,  0.22, yBot);
  return g;
}

function _createParkMedium(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;  // -0.125

  // Fence perimeter ~±0.87
  addFenceX(g, -0.87, 0.87,  0.87, yBot);
  addFenceX(g, -0.87, 0.87, -0.87, yBot);
  addFenceZ(g, -0.87, 0.87,  0.87, yBot);
  addFenceZ(g, -0.87, 0.87, -0.87, yBot);
  // Cross-shaped paths
  addPath(g, -0.87, 0.87, 0.12, yBot);
  addBox(g, 1.74, 0.006, 0.12, 0, yBot + 0.003, 0, M.parkPath);
  // 4 trees at corners
  addTree(g, -0.55,  0.55, yBot);
  addTree(g,  0.55,  0.55, yBot);
  addTree(g, -0.55, -0.55, yBot);
  addTree(g,  0.55, -0.55, yBot);
  // Fountain in center
  addCyl(g, 0.10, 0.12, 0.05, 0, yBot + 0.025, 0, M.concrete, 10);
  addCyl(g, 0.14, 0.14, 0.015, 0, yBot + 0.055, 0, cachedMat(0x1565c0), 10);
  // Benches near fountain
  addBox(g, 0.12, 0.03, 0.04,  0.22, yBot + 0.02,  0.00, M.bench);
  addBox(g, 0.12, 0.03, 0.04, -0.22, yBot + 0.02,  0.00, M.bench);
  addBox(g, 0.04, 0.03, 0.12,  0.00, yBot + 0.02,  0.22, M.bench);
  addBox(g, 0.04, 0.03, 0.12,  0.00, yBot + 0.02, -0.22, M.bench);
  return g;
}

function _createParkLarge(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;  // -0.15

  // Fence perimeter ~±1.37
  addFenceX(g, -1.37, 1.37,  1.37, yBot);
  addFenceX(g, -1.37, 1.37, -1.37, yBot);
  addFenceZ(g, -1.37, 1.37,  1.37, yBot);
  addFenceZ(g, -1.37, 1.37, -1.37, yBot);
  // Cross-shaped main paths
  addPath(g, -1.37, 1.37, 0.14, yBot);
  addBox(g, 2.74, 0.006, 0.14, 0, yBot + 0.003, 0, M.parkPath);
  // Ring path around center (approximated with 4 sections)
  addBox(g, 0.70, 0.006, 0.08, 0, yBot + 0.003,  0.38, M.parkPath);
  addBox(g, 0.70, 0.006, 0.08, 0, yBot + 0.003, -0.38, M.parkPath);
  addBox(g, 0.08, 0.006, 0.70, 0.38, yBot + 0.003, 0, M.parkPath);
  addBox(g, 0.08, 0.006, 0.70, -0.38, yBot + 0.003, 0, M.parkPath);
  // 6 trees
  addTree(g, -0.80,  0.80, yBot);
  addTree(g,  0.80,  0.80, yBot);
  addTree(g, -0.80, -0.80, yBot);
  addTree(g,  0.80, -0.80, yBot);
  addTree(g, -0.80,  0.00, yBot);
  addTree(g,  0.80,  0.00, yBot);
  // Central gazebo
  // Central post
  addBox(g, 0.06, 0.24, 0.06, 0, yBot + 0.12, 0, M.bench);
  // 4 corner posts
  for (const [px, pz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
    addBox(g, 0.05, 0.20, 0.05, px, yBot + 0.10, pz, M.bench);
  }
  // Gazebo roof
  addBox(g, 0.44, 0.04, 0.44, 0, yBot + 0.22, 0, cachedMat(0x5d4037));
  // Bushes along fence inner edge (sampled positions)
  const bushPositions = [
    [-1.10, 1.20], [0, 1.20], [1.10, 1.20],
    [-1.10, -1.20], [0, -1.20], [1.10, -1.20],
    [1.20, 0.60], [1.20, -0.60],
    [-1.20, 0.60], [-1.20, -0.60],
  ];
  for (const [bx, bz] of bushPositions) addBush(g, bx, bz, yBot);
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// INFRASTRUCTURE detailed meshes
// ─────────────────────────────────────────────────────────────────────────────

function _createGeneratorSmall(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const housingMat = cachedMat(0xff9800);
  const darkMat    = cachedMat(0xe65100);

  // Generator housing
  addBox(g, 0.60, 0.46, 0.50, 0, yBot + 0.23, 0, housingMat);
  // Roof
  addBox(g, 0.62, 0.06, 0.52, 0, yBot + 0.49, 0, darkMat);
  // Control panel strip (south)
  addBox(g, 0.30, 0.16, 0.012, -0.12, yBot + 0.34, 0.251, cachedMat(0x37474f));
  // Ventilation grilles (east)
  addBox(g, 0.012, 0.08, 0.22, 0.301, yBot + 0.22, 0, cachedMat(0x616161));
  // Exhaust pipe
  addRoundChimney(g, 0.18, 0.10, 0.36, yBot + 0.49);
  return g;
}

function _createPowerPlant(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat  = cachedMat(0x78909c);
  const darkMat  = cachedMat(0x455a64);
  const roofMat  = cachedMat(0x546e7a);

  // Main building (2×2 footprint ~1.78)
  addBox(g, 1.60, 0.90, 1.60, 0, yBot + 0.45, 0, wallMat);
  addBox(g, 1.62, 0.04, 1.62, 0, yBot + 0.92, 0, roofMat);
  // Control tower section
  addBox(g, 0.60, 0.56, 0.60, -0.40, yBot + 1.20, -0.40, darkMat);
  addBox(g, 0.62, 0.04, 0.62, -0.40, yBot + 1.50, -0.40, roofMat);
  // Large chimney stack
  addRoundChimney(g, 0.32, 0.32, 0.60, yBot + 0.92);
  addRoundChimney(g, -0.10, 0.32, 0.50, yBot + 0.92);
  // Windows on main building south
  addBox(g, 0.18, 0.18, 0.012, -0.40, yBot + 0.50, 0.80, M.window);
  addBox(g, 0.18, 0.18, 0.012,  0.00, yBot + 0.50, 0.80, M.window);
  addBox(g, 0.18, 0.18, 0.012,  0.40, yBot + 0.50, 0.80, M.window);
  // Door south
  addBox(g, 0.16, 0.26, 0.012, 0, yBot + 0.17, 0.80, M.garageDark);
  return g;
}

function _createSolarFarm(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const panelMat  = cachedMat(0x1565c0);
  const frameMat  = cachedMat(0x546e7a);
  const baseMat   = cachedMat(0x616161);

  // 3×3 footprint ~2.78
  // 9 panels in a 3×3 grid
  const panelW = 0.76;
  const panelD = 0.76;
  const offsets = [-0.88, 0, 0.88];
  for (const ox of offsets) {
    for (const oz of offsets) {
      // Panel mount/frame
      addBox(g, panelW + 0.04, 0.02, panelD + 0.04, ox, yBot + 0.08, oz, frameMat);
      // Panel surface (tilted slightly — approximate with flat panel)
      addBox(g, panelW, 0.04, panelD, ox, yBot + 0.14, oz, panelMat);
      // Support legs
      addBox(g, 0.04, 0.14, 0.04, ox - 0.30, yBot + 0.07, oz, baseMat);
      addBox(g, 0.04, 0.14, 0.04, ox + 0.30, yBot + 0.07, oz, baseMat);
    }
  }
  // Small control box
  addBox(g, 0.20, 0.18, 0.16, -1.20, yBot + 0.09, -1.20, cachedMat(0x78909c));
  return g;
}

function _createNuclearPlant(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat   = cachedMat(0x80cbc4);
  const towerMat  = cachedMat(0xe0e0e0);
  const roofMat   = cachedMat(0x4db6ac);
  const darkMat   = cachedMat(0x00796b);

  // 3×3 footprint ~2.78
  // Main reactor building
  addBox(g, 1.40, 1.60, 1.40, -0.40, yBot + 0.80, 0, wallMat);
  addBox(g, 1.42, 0.04, 1.42, -0.40, yBot + 1.62, 0, roofMat);
  // Cooling tower (truncated cylinder) — east side
  addCyl(g, 0.45, 0.60, 1.90, 0.80, yBot + 0.95, 0, towerMat, 14);
  // Cooling tower inner hole hint (darker top rim)
  addCyl(g, 0.40, 0.40, 0.06, 0.80, yBot + 1.93, 0, darkMat, 14);
  // Dome on reactor building
  addCyl(g, 0.30, 0.30, 0.36, -0.40, yBot + 1.84, 0, cachedMat(0x4db6ac), 10);
  // Control building
  addBox(g, 0.80, 0.60, 0.80, -0.90, yBot + 0.30, -0.80, darkMat);
  addBox(g, 0.82, 0.04, 0.82, -0.90, yBot + 0.62, -0.80, roofMat);
  // Windows reactor building south
  addBox(g, 0.20, 0.20, 0.012, -0.70, yBot + 0.80, 0.71, M.window);
  addBox(g, 0.20, 0.20, 0.012, -0.40, yBot + 0.80, 0.71, M.window);
  addBox(g, 0.20, 0.20, 0.012, -0.10, yBot + 0.80, 0.71, M.window);
  return g;
}

function _createWaterPumpSmall(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat = cachedMat(0x4dd0e1);
  const roofMat = cachedMat(0x00acc1);
  const pipeMat = cachedMat(0x546e7a);

  // Pump house
  addBox(g, 0.58, 0.44, 0.52, 0, yBot + 0.22, 0, wallMat);
  // Gabled roof hint (flat for simplicity)
  addBox(g, 0.60, 0.06, 0.54, 0, yBot + 0.47, 0, roofMat);
  // Pipe on top
  addCyl(g, 0.04, 0.05, 0.22, 0.14, yBot + 0.58, 0.10, pipeMat, 6);
  addCyl(g, 0.03, 0.03, 0.08, 0.14, yBot + 0.72, 0.10, pipeMat, 6);
  // Door south
  addBox(g, 0.12, 0.20, 0.012, 0, yBot + 0.14, 0.26, cachedMat(0x00838f));
  // Window south
  addBox(g, 0.14, 0.12, 0.012, -0.18, yBot + 0.30, 0.26, M.window);
  return g;
}

function _createWaterPump(def) {
  const g    = new THREE.Group();
  const h    = def.height;
  const yBot = -h / 2;

  const wallMat  = cachedMat(0x00bcd4);
  const roofMat  = cachedMat(0x0097a7);
  const tankMat  = cachedMat(0x00838f);
  const pipeMat  = cachedMat(0x546e7a);

  // 2×2 footprint ~1.78
  // Main pump building
  addBox(g, 1.60, 0.62, 1.60, 0, yBot + 0.31, 0, wallMat);
  addBox(g, 1.62, 0.04, 1.62, 0, yBot + 0.64, 0, roofMat);
  // Water tank on top
  addCyl(g, 0.34, 0.34, 0.34, 0, yBot + 0.85, 0, tankMat, 12);
  addCyl(g, 0.35, 0.35, 0.02, 0, yBot + 1.035, 0, pipeMat, 12);
  // Pipe connections
  addBox(g, 0.06, 0.06, 0.30, 0.30, yBot + 0.52, 0, pipeMat);
  addBox(g, 0.06, 0.06, 0.30, -0.30, yBot + 0.52, 0, pipeMat);
  // Windows on south face
  addBox(g, 0.18, 0.16, 0.012, -0.38, yBot + 0.40, 0.80, M.window);
  addBox(g, 0.18, 0.16, 0.012,  0.00, yBot + 0.40, 0.80, M.window);
  addBox(g, 0.18, 0.16, 0.012,  0.38, yBot + 0.40, 0.80, M.window);
  // Door south
  addBox(g, 0.16, 0.28, 0.012, 0, yBot + 0.18, 0.80, cachedMat(0x006064));
  return g;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge mesh (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a bridge mesh: road deck + corner posts + four railing bars.
 * Returns a THREE.Group so the internal positions are self-contained.
 * Position the group at tile-surface level (y = TILE_H / 2).
 * @returns {THREE.Group}
 */
export function createBridgeMesh() {
  const group = new THREE.Group();

  // ── Road deck ────────────────────────────────────────────────────
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x546e7a }); // blue-grey tarmac
  const deck    = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.07, 0.92), deckMat);
  deck.position.y   = 0.035;
  deck.castShadow   = true;
  deck.receiveShadow = true;
  group.add(deck);

  // ── Railings ─────────────────────────────────────────────────────
  const railMat  = new THREE.MeshLambertMaterial({ color: 0x90a4ae }); // steel blue-grey
  const railH    = 0.13;
  const railY    = 0.07 + railH / 2;   // sits on top of deck

  // Four railing bars, one per side
  const sides = [
    new THREE.BoxGeometry(0.04, railH, 0.84), // west  (-X)
    new THREE.BoxGeometry(0.04, railH, 0.84), // east  (+X)
    new THREE.BoxGeometry(0.84, railH, 0.04), // north (-Z)
    new THREE.BoxGeometry(0.84, railH, 0.04), // south (+Z)
  ];
  const offsets = [[-0.44,0,0],[0.44,0,0],[0,0,-0.44],[0,0,0.44]];
  sides.forEach((geo, i) => {
    const bar = new THREE.Mesh(geo, railMat);
    bar.position.set(offsets[i][0], railY, offsets[i][2]);
    bar.castShadow = true;
    group.add(bar);
  });

  // Four corner posts (slightly taller than the bars)
  const postGeo = new THREE.BoxGeometry(0.07, railH + 0.05, 0.07);
  for (const [sx, sz] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    const post = new THREE.Mesh(postGeo, railMat);
    post.position.set(sx * 0.44, railY + 0.025, sz * 0.44);
    post.castShadow = true;
    group.add(post);
  }

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main dispatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Three.js object for a building.
 * Zone buildings (R/C/I) return a THREE.Group with procedural detail geometry;
 * service buildings return detailed THREE.Groups;
 * simple infra returns a plain THREE.Mesh.
 *
 * The returned object is centered vertically so grid.js can position it at
 * (x+0.5, TILE_H/2 + def.height/2, z+0.5) without adjustment.
 *
 * @param {string} buildingId
 * @param {number} [seed=0]  Seed for seeded random variants
 * @returns {THREE.Object3D}
 */
export function createBuildingMesh(buildingId, seed = 0) {
  const def = BUILDINGS[buildingId];
  if (!def) throw new Error(`Unknown building id: ${buildingId}`);

  const rng = mkRand(seed);

  if (def.zoneType === 'R') return _createResidentialMesh(def, rng);
  if (def.zoneType === 'C') return _createCommercialMesh(def, rng);
  if (def.zoneType === 'I') return _createIndustrialMesh(def, rng);

  // Service buildings
  if (buildingId === 'police_station')  return _createPoliceStation(def);
  if (buildingId === 'fire_station')    return _createFireStation(def);
  if (buildingId === 'hospital')        return _createHospital(def);
  if (buildingId === 'primary_school')  return _createPrimarySchool(def);
  if (buildingId === 'high_school')     return _createHighSchool(def);
  if (buildingId === 'park_small')      return _createParkSmall(def);
  if (buildingId === 'park_medium')     return _createParkMedium(def);
  if (buildingId === 'park_large')      return _createParkLarge(def);
  // Infrastructure detailed meshes
  if (buildingId === 'generator_small') return _createGeneratorSmall(def);
  if (buildingId === 'power_plant')     return _createPowerPlant(def);
  if (buildingId === 'solar_farm')      return _createSolarFarm(def);
  if (buildingId === 'nuclear_plant')   return _createNuclearPlant(def);
  if (buildingId === 'water_pump_small') return _createWaterPumpSmall(def);
  if (buildingId === 'water_pump')      return _createWaterPump(def);

  // Fallback plain box for any remaining buildings (university, road, bridge …)
  const [bw, bd] = Array.isArray(def.size) ? def.size : [def.size || 1, def.size || 1];
  const geo  = cachedBox(bw - 0.22, def.height, bd - 0.22);
  const mat  = cachedMat(def.color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the definition for a building id, or null.
 * @param {string} id
 * @returns {object|null}
 */
export function getBuildingDef(id) {
  return BUILDINGS[id] ?? null;
}

/**
 * Return all buildings whose unlockAtLevel <= cityLevel.
 * @param {number} level
 * @returns {object[]}
 */
export function getUnlockedBuildings(level) {
  return Object.values(BUILDINGS).filter(b => b.unlockAtLevel <= level);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plot garden and garage mesh helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a garden Group for a plot: fence around perimeter + random props.
 * The group is positioned at world-space origin (0,0,0); caller sets position.
 * @param {{ tiles: {x,z}[], roadDir: string, width: number, depth: number }} plot
 * @param {number} seed
 * @param {string} zoneType  'R' | 'C' | 'I'
 * @returns {THREE.Group|null}
 */
export function createPlotGardenMesh(plot, seed, zoneType) {
  const rng = mkRand(seed + 9999);
  const group = new THREE.Group();
  const { tiles, roadDir } = plot;
  const xs = tiles.map(t => t.x), zs = tiles.map(t => t.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const W = maxX - minX + 1, D = maxZ - minZ + 1;
  const cx = minX + W / 2, cz = minZ + D / 2; // world centre

  const fenceT = 0.04;

  // Helper: fence segment using existing fence helpers
  const fenceSgmX = (wx1, wx2, wz) => addFenceX(group, wx1, wx2, wz, 0);
  const fenceSgmZ = (wz1, wz2, wx) => addFenceZ(group, wz1, wz2, wx, 0);

  const gapW = Math.min(0.5, W * 0.4); // entrance gap width

  // North fence (z = minZ edge)
  if (roadDir !== 'N') {
    fenceSgmX(minX, maxX + 1, minZ);
  } else {
    const lEnd = cx - gapW / 2;
    const rStart = cx + gapW / 2;
    if (lEnd > minX)    fenceSgmX(minX, lEnd, minZ);
    if (rStart < maxX + 1) fenceSgmX(rStart, maxX + 1, minZ);
  }
  // South fence (z = maxZ + 1 edge)
  if (roadDir !== 'S') {
    fenceSgmX(minX, maxX + 1, maxZ + 1);
  } else {
    const lEnd = cx - gapW / 2;
    const rStart = cx + gapW / 2;
    if (lEnd > minX)    fenceSgmX(minX, lEnd, maxZ + 1);
    if (rStart < maxX + 1) fenceSgmX(rStart, maxX + 1, maxZ + 1);
  }
  // West fence (x = minX edge)
  if (roadDir !== 'W') {
    fenceSgmZ(minZ, maxZ + 1, minX);
  }
  // East fence (x = maxX + 1 edge)
  if (roadDir !== 'E') {
    fenceSgmZ(minZ, maxZ + 1, maxX + 1);
  }

  // Props: trees and bushes scattered inside plot
  const area = W * D;
  const propCount = Math.floor(area * 0.8 + rng() * area);
  for (let i = 0; i < propCount; i++) {
    const px = minX + 0.3 + rng() * (W - 0.6);
    const pz = minZ + 0.3 + rng() * (D - 0.6);
    // Don't overlap the building mesh (rough centre exclusion)
    const dx = px - cx, dz = pz - cz;
    if (Math.abs(dx) < 0.4 && Math.abs(dz) < 0.4) continue;
    if (rng() < 0.4) addTree(group, px, pz, 0);
    else             addBush(group, px, pz, 0);
  }

  // For residential plots: a thin path strip from road-facing edge inward
  if (zoneType === 'R' && area >= 2) {
    const pathH = 0.01;
    let pathMesh;
    if (roadDir === 'N' || roadDir === 'S') {
      pathMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, pathH, D * 0.6), M.path);
      const pz2 = roadDir === 'N' ? minZ + D * 0.3 : maxZ + 1 - D * 0.3;
      pathMesh.position.set(cx, pathH / 2, pz2);
    } else {
      pathMesh = new THREE.Mesh(new THREE.BoxGeometry(D * 0.6, pathH, 0.15), M.path);
      const px2 = roadDir === 'W' ? minX + D * 0.3 : maxX + 1 - D * 0.3;
      pathMesh.position.set(px2, pathH / 2, cz);
    }
    pathMesh.castShadow = true;
    group.add(pathMesh);
  }

  return group;
}

/**
 * Small garage box for larger residential plots.
 * @param {number} seed
 * @returns {THREE.Group}
 */
export function createGarageMesh(seed) {
  const rng = mkRand(seed + 77777);
  const group = new THREE.Group();
  // Garage body
  const gw = 0.28 + rng() * 0.06, gd = 0.22 + rng() * 0.04, gh = 0.18;
  addBox(group, gw, gh, gd, 0, gh / 2, 0, M.wall);
  // Flat roof
  addBox(group, gw + 0.02, 0.02, gd + 0.02, 0, gh + 0.01, 0, M.roof2);
  // Garage door (dark rectangle on front face, -Z side)
  addBox(group, gw * 0.7, gh * 0.65, 0.01, 0, gh * 0.4, -gd / 2 - 0.001, M.darkMetal);
  return group;
}
