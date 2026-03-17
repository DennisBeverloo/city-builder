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
    category: 'service', size: 1,
    cost: 8000, monthlyUpkeep: 1500,
    provides: { crime_reduction: 20, radius: 8 },
    requires: { power: 3, water: 1 },
    color: 0x1565c0, height: 1.2,
    unlockAtLevel: 1, description: 'Reduces crime, radius 8.',
  },
  fire_station: {
    id: 'fire_station', name: 'Fire Station',
    category: 'service', size: 1,
    cost: 8000, monthlyUpkeep: 1500,
    provides: { fire_protection: 20, radius: 8 },
    requires: { power: 2, water: 2 },
    color: 0xf44336, height: 1.2,
    unlockAtLevel: 1, description: 'Fire protection, radius 8.',
  },
  hospital: {
    id: 'hospital', name: 'Hospital',
    category: 'service', size: 1,
    cost: 25000, monthlyUpkeep: 4000,
    provides: { happiness: 15, radius: 12 },
    requires: { power: 5, water: 4 },
    color: 0xeceff1, height: 1.8,
    unlockAtLevel: 2, description: '+15 happiness, radius 12.',
  },
  primary_school: {
    id: 'primary_school', name: 'Primary School',
    category: 'service', size: 1,
    cost: 5000, monthlyUpkeep: 1000,
    provides: { edu_level: 1, happiness: 5, radius: 6 },
    requires: { power: 2, water: 1 },
    color: 0xffeb3b, height: 1.0,
    unlockAtLevel: 1, description: '+5 happiness, edu+1, radius 6.',
  },
  high_school: {
    id: 'high_school', name: 'High School',
    category: 'service', size: 1,
    cost: 12000, monthlyUpkeep: 2500,
    provides: { edu_level: 2, happiness: 8, radius: 10 },
    requires: { power: 3, water: 2 },
    color: 0xff9800, height: 1.3,
    unlockAtLevel: 2, description: '+8 happiness, edu+2, radius 10.',
  },
  university: {
    id: 'university', name: 'University',
    category: 'service', size: 1,
    cost: 30000, monthlyUpkeep: 6000,
    provides: { edu_level: 3, happiness: 12, radius: 15 },
    requires: { power: 8, water: 4 },
    color: 0x9c27b0, height: 2.2,
    unlockAtLevel: 3, description: '+12 happiness, edu+3, radius 15.',
  },
  park_small: {
    id: 'park_small', name: 'Small Park',
    category: 'service', size: 1,
    cost: 1000, monthlyUpkeep: 200,
    provides: { happiness: 5, radius: 4 },
    requires: {},
    color: 0xa5d6a7, height: 0.2,
    unlockAtLevel: 1, description: '+5 happiness, radius 4.',
  },
  park_medium: {
    id: 'park_medium', name: 'Medium Park',
    category: 'service', size: 1,
    cost: 3000, monthlyUpkeep: 500,
    provides: { happiness: 10, radius: 7 },
    requires: {},
    color: 0x66bb6a, height: 0.25,
    unlockAtLevel: 2, description: '+10 happiness, radius 7.',
  },
  park_large: {
    id: 'park_large', name: 'Large Park',
    category: 'service', size: 1,
    cost: 8000, monthlyUpkeep: 1200,
    provides: { happiness: 20, radius: 12 },
    requires: {},
    color: 0x388e3c, height: 0.3,
    unlockAtLevel: 3, description: '+20 happiness, radius 12.',
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
    category: 'infra', size: 1,
    cost: 3000, monthlyUpkeep: 600,
    provides: { power_kw: 150 },
    requires: {},
    color: 0xff9800, height: 0.9,
    unlockAtLevel: 1, description: 'Small diesel generator. Enough for a fledgling town.',
  },
  power_plant: {
    id: 'power_plant', name: 'Coal Power Plant',
    category: 'infra', size: 1,
    cost: 10000, monthlyUpkeep: 2000,
    provides: { power_kw: 600 },
    requires: {},
    color: 0xff5722, height: 1.5,
    unlockAtLevel: 1, description: 'Coal-fired plant. High output, high upkeep.',
  },
  solar_farm: {
    id: 'solar_farm', name: 'Solar Farm',
    category: 'infra', size: 1,
    cost: 20000, monthlyUpkeep: 500,
    provides: { power_kw: 400 },
    requires: {},
    color: 0xffee58, height: 0.3,
    unlockAtLevel: 3, description: 'Clean energy. No fuel cost, moderate output.',
  },
  nuclear_plant: {
    id: 'nuclear_plant', name: 'Nuclear Plant',
    category: 'infra', size: 1,
    cost: 80000, monthlyUpkeep: 3000,
    provides: { power_kw: 2000 },
    requires: {},
    color: 0x80cbc4, height: 2.0,
    unlockAtLevel: 5, description: 'Massive power output. Expensive to build.',
  },
  water_pump_small: {
    id: 'water_pump_small', name: 'Small Water Pump',
    category: 'infra', size: 1,
    cost: 2500, monthlyUpkeep: 500,
    provides: { water_units: 80 },
    requires: {},
    color: 0x4dd0e1, height: 0.7,
    unlockAtLevel: 1, description: 'Basic pump. Enough for early residential growth.',
  },
  water_pump: {
    id: 'water_pump', name: 'Water Pumping Station',
    category: 'infra', size: 1,
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

// Geometry/material caches to avoid repeated allocations.
const _geoCache  = new Map();
const _matCache  = new Map();

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

/**
 * Create a Three.js object for a building.
 * Zone buildings (R/C/I) return a THREE.Group with detail geometry;
 * all others return a plain THREE.Mesh.
 * The returned object is centered vertically so grid.js can position it at
 * (x+0.5, TILE_H/2 + def.height/2, z+0.5) without adjustment.
 * @param {string} buildingId
 * @returns {THREE.Object3D}
 */
export function createBuildingMesh(buildingId) {
  const def = BUILDINGS[buildingId];
  if (!def) throw new Error(`Unknown building id: ${buildingId}`);

  if (def.zoneType === 'R') return _createResidentialMesh(def);
  if (def.zoneType === 'C') return _createCommercialMesh(def);
  if (def.zoneType === 'I') return _createIndustrialMesh(def);

  // Plain box for services, infra, roads
  const geo  = cachedBox(0.78, def.height, 0.78);
  const mat  = new THREE.MeshLambertMaterial({ color: def.color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Residential: small house body + gable roof.
 * Total bounding box height = def.height (0.7).
 */
function _createResidentialMesh(def) {
  const group = new THREE.Group();
  const h     = def.height;       // 0.7
  const yBase = -h / 2;           // bottom of bounding box in local space

  // Walls
  const bodyH = h * 0.64;
  const body  = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, bodyH, 0.78),
    new THREE.MeshLambertMaterial({ color: def.color }),
  );
  body.position.y    = yBase + bodyH / 2;
  body.castShadow    = true;
  body.receiveShadow = true;
  group.add(body);

  // Gable roof — triangular prism via ExtrudeGeometry
  const roofH     = h - bodyH;
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-0.45, 0);
  roofShape.lineTo( 0.45, 0);
  roofShape.lineTo( 0,    roofH);
  roofShape.closePath();

  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 0.84, bevelEnabled: false });
  const roof    = new THREE.Mesh(
    roofGeo,
    new THREE.MeshLambertMaterial({ color: 0xb71c1c }),  // dark-red tiles
  );
  // Base of the triangle sits at top of body wall; extrusion centred on Z
  roof.position.set(0, yBase + bodyH, -0.42);
  roof.castShadow = true;
  group.add(roof);

  return group;
}

/**
 * Commercial: office block + flat-roof parapet.
 * Total bounding box height = def.height (1.2).
 */
function _createCommercialMesh(def) {
  const group = new THREE.Group();
  const h     = def.height;   // 1.2
  const yBase = -h / 2;

  // Main office block
  const blockH = h * 0.92;
  const block  = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, blockH, 0.78),
    new THREE.MeshLambertMaterial({ color: def.color }),
  );
  block.position.y    = yBase + blockH / 2;
  block.castShadow    = block.receiveShadow = true;
  group.add(block);

  // Parapet — thin border around the roof edge
  const parapetH = h - blockH;
  const roofY    = yBase + blockH + parapetH / 2;
  const parapetMat = new THREE.MeshLambertMaterial({ color: 0x37474f });

  for (const [sz, dim] of [[-0.37, [0.78, parapetH, 0.04]], [0.37, [0.78, parapetH, 0.04]]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...dim), parapetMat);
    m.position.set(0, roofY, sz);
    m.castShadow = true;
    group.add(m);
  }
  for (const [sx, dim] of [[-0.37, [0.04, parapetH, 0.78]], [0.37, [0.04, parapetH, 0.78]]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...dim), parapetMat);
    m.position.set(sx, roofY, 0);
    m.castShadow = true;
    group.add(m);
  }

  return group;
}

/**
 * Industrial: low factory building + chimney stack.
 * Total bounding box height = def.height (0.9).
 */
function _createIndustrialMesh(def) {
  const group = new THREE.Group();
  const h     = def.height;   // 0.9
  const yBase = -h / 2;

  // Factory shed
  const factoryH = h * 0.78;
  const factory  = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, factoryH, 0.78),
    new THREE.MeshLambertMaterial({ color: def.color }),
  );
  factory.position.y    = yBase + factoryH / 2;
  factory.castShadow    = factory.receiveShadow = true;
  group.add(factory);

  // Chimney — extends above the shed to fill remaining height plus a small overshoot
  const chimneyH   = (h - factoryH) + 0.04;
  const chimneyGeo = new THREE.CylinderGeometry(0.055, 0.07, chimneyH, 6);
  const chimney    = new THREE.Mesh(
    chimneyGeo,
    new THREE.MeshLambertMaterial({ color: 0x5d4037 }),
  );
  chimney.position.set(0.22, yBase + factoryH + chimneyH / 2, 0.22);
  chimney.castShadow = true;
  group.add(chimney);

  return group;
}

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
