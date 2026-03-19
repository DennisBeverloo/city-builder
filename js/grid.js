/**
 * @module grid
 * 40×40 tile grid: manages tile state AND Three.js floor/building meshes.
 */
import * as THREE from 'three';
import { createBuildingMesh, createBridgeMesh, BUILDINGS, createPlotGardenMesh, createGarageMesh } from './buildings.js';

// Tile floor colours
const C = {
  empty:   0x5a8a3c,
  zone_r:  0x81c784,
  zone_c:  0x64b5f6,
  zone_i:  0xb0bec5,
  road:    0x37474f,
  river:   0x1565c0,
  forest:  0x2e7d32,
  field:   0xf9a825,
  hover:   0xffff44,
  select:  0xffffff,
};

// Preview colours (shown during drag-to-build)
const PREVIEW = {
  road:         0x78909c,  // valid road tile
  bridge:       0x26c6da,  // bridge over river
  terrain_bad:  0xef9a9a,  // invalid terrain (forest/field)
  zone_r:       0xa5d6a7,
  zone_c:       0x90caf9,
  zone_i:       0xbdbdbd,
  zone_bad:     0xef9a9a,  // occupied / terrain
};

const TILE_W  = 1;
const TILE_H  = 0.06; // floor tile thickness

/** Shared floor geometry (reused by every tile mesh). */
const _floorGeo = new THREE.BoxGeometry(TILE_W - 0.02, TILE_H, TILE_W - 0.02);

export class Grid {
  /**
   * @param {THREE.Scene} scene
   * @param {number} size  Grid width = height in tiles.
   */
  constructor(scene, size = 40) {
    this._scene   = scene;
    this.size     = size;

    /** @type {object[][]} 2-D array [z][x] of tile objects */
    this._tiles   = [];
    /** @type {THREE.Mesh[][]} floor meshes [z][x] */
    this._meshes  = [];
    /** @type {Map<string, THREE.Object3D>} building / bridge meshes keyed "x_z" */
    this._bMeshes = new Map();

    this._hovered      = null;
    this._selected     = null;
    /** @type {Set<object>} tiles currently shown in drag preview */
    this._previewTiles = new Set();
    /** @type {function|null} called with (x, z) when a forest decoration is replaced */
    this._removeDecoration = null;

    this._build();
  }

  // ── Private ─────────────────────────────────────────────────────

  _build() {
    for (let z = 0; z < this.size; z++) {
      this._tiles[z]  = [];
      this._meshes[z] = [];
      for (let x = 0; x < this.size; x++) {
        const tile = {
          x, z,
          type:        'empty',   // empty | zone | road | service | infra | terrain
          zoneType:    null,      // R | C | I
          terrainType: null,      // river | forest | field
          isBridge:    false,     // road tile that was placed over river
          building:    null,      // { id, def, residents, fillPercentage, jobs, level, tileX, tileZ }
          connected:   false,     // has road access
          happiness:        50,   // 0–100, per-tile, driven by services + parks - pollution
          desirability:      0,   // 0–100, inputs: services, parks, -pollution
          pollution:         0,   // 0–100, driven by nearby I buildings
          serviceCoverage: { police: 0, fire: 0, hospital: 0, education: 0, parks: 0 },
          landValue:         0,   // 0–100, lags desirability (moves 10%/month toward it)
          mesh:        null,
        };

        const mat  = new THREE.MeshLambertMaterial({ color: C.empty });
        const mesh = new THREE.Mesh(_floorGeo, mat);
        mesh.position.set(x + 0.5, 0, z + 0.5);
        mesh.receiveShadow = true;
        mesh.userData.tile = tile;
        this._scene.add(mesh);

        tile.mesh          = mesh;
        this._tiles[z][x]  = tile;
        this._meshes[z][x] = mesh;
      }
    }
  }

  _key(x, z) { return `${x}_${z}`; }

  /** Return [w, d] from a building definition (handles both size:1 and size:[w,d]). */
  _getBuildingSize(def) {
    return Array.isArray(def.size) ? def.size : [def.size || 1, def.size || 1];
  }

  _tileColor(tile) {
    // Bridge tiles show river underneath the bridge deck
    if (tile.isBridge) return C.river;

    switch (tile.type) {
      case 'road':    return C.road;
      case 'terrain':
        return { river: C.river, forest: C.forest, field: C.field }[tile.terrainType] ?? C.empty;
      case 'zone':
      case 'service':
      case 'infra':
        if (tile.zoneType) return { R: C.zone_r, C: C.zone_c, I: C.zone_i }[tile.zoneType] ?? C.empty;
        if (tile.building) return tile.building.def.color;
        return C.empty;
      default:
        return C.empty;
    }
  }

  _setTileColor(tile, color) {
    tile.mesh.material = new THREE.MeshLambertMaterial({ color });
  }

  _restoreColor(tile) {
    // Road tiles use a shared textured material managed by scene.js.
    // Restore it directly so road markings are preserved after hover/preview.
    // (scene.js stores the material on tile._roadMat when updateRoadMarkings
    // runs, breaking the circular import that would otherwise be needed.)
    if (tile.type === 'road' && !tile.isBridge && tile._roadMat) {
      tile.mesh.material = tile._roadMat;
    } else {
      this._setTileColor(tile, this._tileColor(tile));
    }
  }

  _removeBuildingMesh(x, z) {
    const key  = this._key(x, z);
    const mesh = this._bMeshes.get(key);
    if (mesh) {
      this._scene.remove(mesh);
      this._bMeshes.delete(key);
    }
    const tile = this.getTile(x, z);
    if (tile?.building?.mesh && tile.building.mesh !== mesh) {
      this._scene.remove(tile.building.mesh);
    }
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Register a callback to remove decorative meshes (e.g. trees) when built over.
   * @param {function(number, number): void} fn
   */
  setDecorationRemover(fn) { this._removeDecoration = fn; }

  /** Get tile at grid coords, or null if out of bounds. */
  getTile(x, z) {
    if (x < 0 || x >= this.size || z < 0 || z >= this.size) return null;
    return this._tiles[z][x];
  }

  /** Flat array of all tiles. */
  getAllTiles() { return this._tiles.flat(); }

  /** All floor meshes, used for raycasting. */
  getRaycastTargets() { return this._meshes.flat(); }

  /**
   * Paint a zone on an empty tile.
   * @param {number} x @param {number} z @param {'R'|'C'|'I'} zoneType
   */
  setTileZone(x, z, zoneType) {
    const tile = this.getTile(x, z);
    if (!tile) return false;
    if (tile.type === 'road') return false;
    if (tile.type === 'terrain' && tile.terrainType !== 'forest') return false;
    if (tile.building) return false;

    if (tile.terrainType === 'forest') {
      this._removeDecoration?.(x, z);
      tile.terrainType = null;
    }

    tile.type     = 'zone';
    tile.zoneType = zoneType;
    this._setTileColor(tile, { R: C.zone_r, C: C.zone_c, I: C.zone_i }[zoneType]);
    return true;
  }

  /**
   * Place a plain road tile on any non-terrain tile.
   * @param {number} x @param {number} z
   */
  setTileRoad(x, z) {
    const tile = this.getTile(x, z);
    if (!tile || (tile.type === 'terrain' && tile.terrainType !== 'forest')) return false;

    if (tile.terrainType === 'forest') {
      this._removeDecoration?.(x, z);
      tile.terrainType = null;
    }

    if (tile.building) this._removeBuildingMesh(x, z);
    tile.type     = 'road';
    tile.zoneType = null;
    tile.building = null;
    this._setTileColor(tile, C.road);
    this.calculateRoadAccess();
    return true;
  }

  /**
   * Place a bridge on a river tile.
   * Creates a bridge Group mesh (deck + railings) on top of the blue tile.
   * @param {number} x @param {number} z
   */
  setTileBridge(x, z) {
    const tile = this.getTile(x, z);
    if (!tile || tile.terrainType !== 'river') return false;

    if (tile.building) this._removeBuildingMesh(x, z);

    const group = createBridgeMesh();
    // Sit the bridge group at tile-surface level
    group.position.set(x + 0.5, TILE_H / 2, z + 0.5);
    this._scene.add(group);
    this._bMeshes.set(this._key(x, z), group);

    tile.type     = 'road';
    tile.isBridge = true;
    tile.zoneType = null;
    tile.building = {
      id:        'bridge',
      def:       BUILDINGS.bridge,
      mesh:      group,
      residents: 0,
      jobs:      0,
      level:     1,
      tileX:     x,
      tileZ:     z,
    };

    // Tile floor stays river-blue (_tileColor returns C.river for isBridge)
    this._restoreColor(tile);
    this.calculateRoadAccess();
    return true;
  }

  /**
   * Place a service / infra / zone building.
   * For multi-tile buildings (size:[w,d]), ax/az is the SW anchor corner;
   * the footprint extends +x (east) and -z (north).
   * All footprint tiles share one building object reference.
   * @param {number} ax @param {number} az @param {string} buildingId
   * @param {number} [rotation=0]  Y-axis rotation in radians (faces south by default)
   */
  placeBuilding(ax, az, buildingId, rotation = 0) {
    const def = BUILDINGS[buildingId];
    if (!def) return false;

    const [w, d] = this._getBuildingSize(def);

    // Collect footprint tiles and validate each
    const footprint = [];
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const ft = this.getTile(ax + dx, az - dz);
        if (!ft) return false;
        if (ft.type === 'terrain' && ft.terrainType !== 'forest') return false;
        footprint.push(ft);
      }
    }

    // Remove any existing buildings that overlap the new footprint
    const removedAnchors = new Set();
    for (const ft of footprint) {
      if (ft.terrainType === 'forest') {
        this._removeDecoration?.(ft.x, ft.z);
        ft.terrainType = null;
      }
      if (ft.building) {
        const ak = this._key(ft.building.tileX, ft.building.tileZ);
        if (!removedAnchors.has(ak)) {
          removedAnchors.add(ak);
          // Tear down the full old footprint
          const [ow, od] = this._getBuildingSize(ft.building.def);
          const oldMesh = this._bMeshes.get(ak);
          if (oldMesh) { this._scene.remove(oldMesh); this._bMeshes.delete(ak); }
          for (let ox = 0; ox < ow; ox++) {
            for (let oz = 0; oz < od; oz++) {
              const ot = this.getTile(ft.building.tileX + ox, ft.building.tileZ - oz);
              if (ot) ot.building = null;
            }
          }
        }
        ft.building = null;
      }
    }

    // Create mesh centred on the footprint
    const worldCX = ax + w / 2;
    const worldCZ = az - d / 2 + 1;
    const mesh = createBuildingMesh(buildingId, ax + az * this.size);
    mesh.position.set(worldCX, TILE_H / 2 + def.height / 2, worldCZ);
    mesh.rotation.y = rotation;
    mesh.userData.buildingId = buildingId;
    mesh.userData.tileX      = ax;
    mesh.userData.tileZ      = az;
    this._scene.add(mesh);
    this._bMeshes.set(this._key(ax, az), mesh);

    // Low-density houses (1×1 R) are instantly occupied by a family of 3–6.
    // High-density residential (apartments etc.) fills up gradually.
    const isLowDensityR = def.zoneType === 'R' && def.size === 1;
    const building = {
      id: buildingId, def, mesh,
      fillPercentage: isLowDensityR ? 1.0 : (def.zoneType ? 0.1 : 1.0),
      residents:      isLowDensityR ? (3 + Math.floor(Math.random() * 4))
                    : (def.zoneType === 'R' ? (def.provides?.capacity || 6) * 0.1 : 0),
      jobs:           def.provides?.jobs || 0,
      level:          1,
      rotation,
      tileX: ax, tileZ: az,
    };

    for (const ft of footprint) {
      ft.building = building;
      if (def.category === 'service')    ft.type = 'service';
      else if (def.category === 'infra') ft.type = 'infra';
      this._restoreColor(ft);
    }

    this.calculateRoadAccess();
    return true;
  }

  /**
   * Demolish whatever is on a tile.
   * For multi-tile buildings, any footprint tile may be passed — the whole
   * building is removed.  Bridge tiles revert to river terrain.
   * @param {number} x @param {number} z
   */
  removeBuilding(x, z) {
    const tile = this.getTile(x, z);
    if (!tile) return false;
    if (tile.type === 'terrain' && !tile.isBridge) return false;

    // If this is a satellite tile, redirect demolish to the anchor.
    if (tile.building &&
        (tile.x !== tile.building.tileX || tile.z !== tile.building.tileZ)) {
      return this.removeBuilding(tile.building.tileX, tile.building.tileZ);
    }

    const wasBridge = tile.isBridge;

    if (tile.building) {
      const def = tile.building.def;

      // Remove garden and garage meshes if present (plot buildings)
      if (tile.building.gardenMesh) this._scene.remove(tile.building.gardenMesh);
      if (tile.building.garageMesh) this._scene.remove(tile.building.garageMesh);

      // Remove mesh (keyed by anchor)
      this._removeBuildingMesh(x, z);

      // For plot buildings, clear all plot tiles
      if (tile.building.plotTiles) {
        for (const pt of tile.building.plotTiles) {
          const ft = this.getTile(pt.x, pt.z);
          if (!ft) continue;
          ft.building = null;
          ft.type = ft.zoneType ? 'zone' : 'empty';
          this._restoreColor(ft);
        }
        this._bMeshes.delete(this._key(x, z));
        this.calculateRoadAccess();
        return true;
      }

      const [w, d] = this._getBuildingSize(def);

      // Clear every tile in the footprint (non-plot buildings)
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const ft = this.getTile(x + dx, z - dz);
          if (!ft) continue;
          ft.building = null;
          if (ft.zoneType) ft.type = 'zone';
          else             ft.type = 'empty';
          this._restoreColor(ft);
        }
      }
    }

    // Bridge-specific cleanup (bridges are always 1×1)
    if (wasBridge) {
      tile.type        = 'terrain';
      tile.terrainType = 'river';
      tile.isBridge    = false;
      tile.zoneType    = null;
      this._restoreColor(tile);
    }

    this.calculateRoadAccess();
    return true;
  }

  /**
   * Remove a plain road tile, reverting it to empty.
   * @param {number} x @param {number} z
   */
  removeRoad(x, z) {
    const tile = this.getTile(x, z);
    if (!tile || tile.type !== 'road' || tile.isBridge) return false;
    tile.type = 'empty';
    this._restoreColor(tile);
    this.calculateRoadAccess();
    return true;
  }

  /**
   * Remove zone paint from a tile, reverting it to empty.
   * @param {number} x @param {number} z
   */
  clearZone(x, z) {
    const tile = this.getTile(x, z);
    if (!tile || tile.type !== 'zone') return false;
    tile.type     = 'empty';
    tile.zoneType = null;
    this._restoreColor(tile);
    this.calculateRoadAccess();
    return true;
  }

  /**
   * Mark a tile as non-buildable terrain (called by terrain.js during init).
   * @param {number} x @param {number} z @param {'river'|'forest'|'field'} terrainType
   */
  setTileTerrain(x, z, terrainType) {
    const tile = this.getTile(x, z);
    if (!tile) return;
    tile.type        = 'terrain';
    tile.terrainType = terrainType;
    this._setTileColor(tile, { river: C.river, forest: C.forest, field: C.field }[terrainType] ?? C.empty);
  }

  /**
   * Recalculate road-access for every tile.
   * A tile is "connected" if it IS a road/bridge OR is directly adjacent to one.
   */
  calculateRoadAccess() {
    for (const t of this.getAllTiles()) t.connected = false;

    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        const tile = this._tiles[z][x];
        if (tile.type !== 'road') continue;
        tile.connected = true;
        for (const nb of this._neighbors(x, z)) {
          if (nb.type !== 'terrain' || nb.isBridge) nb.connected = true;
        }
      }
    }
  }

  _neighbors(x, z) {
    return [[-1,0],[1,0],[0,-1],[0,1]]
      .map(([dx, dz]) => this.getTile(x + dx, z + dz))
      .filter(Boolean);
  }

  /** @returns {Array<{tile, dist}>} */
  getTilesInRadius(cx, cz, radius) {
    const out = [];
    const x0 = Math.max(0,             Math.floor(cx - radius));
    const x1 = Math.min(this.size - 1, Math.ceil (cx + radius));
    const z0 = Math.max(0,             Math.floor(cz - radius));
    const z1 = Math.min(this.size - 1, Math.ceil (cz + radius));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.abs(x - cx) + Math.abs(z - cz);
        if (dist <= radius) out.push({ tile: this._tiles[z][x], dist });
      }
    }
    return out;
  }

  // ── Service coverage ─────────────────────────────────────────────

  /**
   * Maps building id → { field in serviceCoverage, strength per tile at source }.
   * Parks go into the 'parks' slot; other services into their named slot.
   */
  static get SERVICE_COVERAGE_MAP() {
    return {
      police_station: { field: 'police',    strength: 40 },
      fire_station:   { field: 'fire',      strength: 40 },
      hospital:       { field: 'hospital',  strength: 40 },
      primary_school: { field: 'education', strength: 25 },
      high_school:    { field: 'education', strength: 50 },
      university:     { field: 'education', strength: 75 },
      park_small:     { field: 'parks',     strength: 15 },
      park_medium:    { field: 'parks',     strength: 38 },
      park_large:     { field: 'parks',     strength: 65 },
    };
  }

  /**
   * Recompute serviceCoverage for every tile from placed service buildings,
   * then immediately refresh per-tile happiness (section 4d).
   * Call this whenever a service building is placed or demolished.
   */
  recalculateServiceEffects() {
    const map = Grid.SERVICE_COVERAGE_MAP;

    // Reset coverage
    for (const t of this.getAllTiles()) {
      t.serviceCoverage.police    = 0;
      t.serviceCoverage.fire      = 0;
      t.serviceCoverage.hospital  = 0;
      t.serviceCoverage.education = 0;
      t.serviceCoverage.parks     = 0;
    }

    // Apply each service building's radius (anchor tiles only)
    for (const t of this.getAllTiles()) {
      if (!t.building || t.building.def.category !== 'service') continue;
      // Skip satellite tiles — only process the anchor
      if (t.x !== t.building.tileX || t.z !== t.building.tileZ) continue;
      const cfg    = map[t.building.id];
      if (!cfg) continue;
      const radius = t.building.def.provides?.radius ?? 0;
      if (!radius) continue;

      // Use footprint centre for radius origin
      const [w, d] = this._getBuildingSize(t.building.def);
      const cx = t.x + (w - 1) / 2;
      const cz = t.z - (d - 1) / 2;

      for (const { tile, dist } of this.getTilesInRadius(cx, cz, radius)) {
        const falloff = 1 - (dist / radius);
        tile.serviceCoverage[cfg.field] = Math.min(100,
          tile.serviceCoverage[cfg.field] + cfg.strength * falloff);
      }
    }

    // Immediate per-tile happiness refresh (section 4d, uses current pollution)
    this._applyTileHappiness();
  }

  /** Section 4d: compute per-tile happiness from serviceCoverage + pollution. */
  _applyTileHappiness() {
    for (const t of this.getAllTiles()) {
      const sc = t.serviceCoverage;
      let score = 50;
      score += sc.police    * 0.20;
      score += sc.fire      * 0.18;
      score += sc.hospital  * 0.48;
      score += sc.education * 0.52;
      score += sc.parks     * 0.65;
      score -= t.pollution  * 0.50;
      t.happiness = Math.max(0, Math.min(100, score));
    }
  }

  /**
   * Full monthly tile map recalculation (sections 4a–4d).
   * Called once per game month before the simulation tick.
   * @param {{ industryPollutionRadius: number, industryPollutionStrength: number }} config
   */
  runMonthlyTileCalcs(config) {
    const { industryPollutionRadius, industryPollutionStrength } = config;
    const tiles = this.getAllTiles();

    // 4a: Pollution — reset then sum I-building contributions (anchor tiles only)
    for (const t of tiles) t.pollution = 0;
    for (const t of tiles) {
      if (!t.building?.def?.pollutes) continue;
      if (t.x !== t.building.tileX || t.z !== t.building.tileZ) continue;
      for (const { tile, dist } of this.getTilesInRadius(t.x, t.z, industryPollutionRadius)) {
        const falloff = 1 - (dist / industryPollutionRadius);
        tile.pollution = Math.min(100, tile.pollution + industryPollutionStrength * falloff);
      }
    }

    // 4b: Desirability — uses previous tick's happiness (lagging is intentional)
    for (const t of tiles) {
      const sc = t.serviceCoverage;
      let score = 50;
      score += sc.police    * 0.10;
      score += sc.fire      * 0.10;
      score += sc.hospital  * 0.15;
      score += sc.education * 0.15;
      score -= t.pollution  * 0.40;
      score += t.happiness  * 0.10;   // previous tick's happiness baked in
      t.desirability = Math.max(0, Math.min(100, score));
    }

    // 4c: Land value — lags 10% toward desirability each month
    for (const t of tiles) {
      t.landValue += (t.desirability - t.landValue) * 0.10;
      t.landValue  = Math.max(0, Math.min(100, t.landValue));
    }

    // 4d: Per-tile happiness — fresh computation this tick
    this._applyTileHappiness();
  }

  // ── Plot detection ───────────────────────────────────────────────

  /**
   * Returns array of unbuilt plot descriptors for all connected zone tiles
   * adjacent to roads. Max 4 wide × 4 deep per plot.
   */
  detectPlots() {
    const plots = [];
    const assigned = new Set(); // "x_z" keys

    // direction config: rdx/rdz = road neighbour delta, ddx/ddz = depth direction, wdx/wdz = width direction
    const DIRS = {
      N: { rdx:  0, rdz: -1, ddx:  0, ddz:  1, wdx: 1, wdz: 0 },
      S: { rdx:  0, rdz:  1, ddx:  0, ddz: -1, wdx: 1, wdz: 0 },
      E: { rdx:  1, rdz:  0, ddx: -1, ddz:  0, wdx: 0, wdz: 1 },
      W: { rdx: -1, rdz:  0, ddx:  1, ddz:  0, wdx: 0, wdz: 1 },
    };

    const getStrip = (sx, sz, ddx, ddz, zoneType, maxPlotDim) => {
      let totalAvail = 0, hasFarRoad = false;
      for (let d = 0; d < 8; d++) {
        const tx = sx + ddx * d, tz = sz + ddz * d;
        const t = this.getTile(tx, tz);
        if (!t || t.type !== 'zone' || t.zoneType !== zoneType) break;
        if (assigned.has(`${tx}_${tz}`)) break;
        totalAvail = d + 1;
        const far = this.getTile(tx + ddx, tz + ddz);
        if (far?.type === 'road') { hasFarRoad = true; break; }
      }
      const cap  = maxPlotDim ?? 4;
      const maxD = hasFarRoad
        ? Math.min(Math.ceil(totalAvail / 2), cap)
        : Math.min(totalAvail, cap);
      const strip = [];
      for (let d = 0; d < maxD; d++) {
        const tx = sx + ddx * d, tz = sz + ddz * d;
        const t = this.getTile(tx, tz);
        if (!t || t.type !== 'zone' || t.zoneType !== zoneType || assigned.has(`${tx}_${tz}`)) break;
        strip.push(t);
      }
      return strip;
    };

    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        const key = `${x}_${z}`;
        if (assigned.has(key)) continue;
        const tile = this._tiles[z][x];
        if (tile.type !== 'zone' || tile.building) continue;

        // Find which side has a road — prefer the direction with the longest adjacent road segment
        let roadDir = null;
        let roadDirLen = -1;
        for (const dir of ['N', 'S', 'E', 'W']) {
          const { rdx, rdz, wdx, wdz } = DIRS[dir];
          const nb = this.getTile(x + rdx, z + rdz);
          if (nb?.type !== 'road') continue;
          // Count consecutive road tiles in both width directions from this position
          let len = 1;
          for (let w = 1; w < this.size; w++) {
            if (this.getTile(x + rdx + wdx * w, z + rdz + wdz * w)?.type !== 'road') break;
            len++;
          }
          for (let w = 1; w < this.size; w++) {
            if (this.getTile(x + rdx - wdx * w, z + rdz - wdz * w)?.type !== 'road') break;
            len++;
          }
          if (len > roadDirLen) { roadDir = dir; roadDirLen = len; }
        }
        if (!roadDir) continue;

        const { ddx, ddz, wdx, wdz, rdx, rdz } = DIRS[roadDir];

        // Max plot dimension scales with land value: small in new cities, larger as area develops
        const lv = tile.landValue ?? 0;
        const maxPlotDim = lv < 33 ? 2 : lv < 66 ? 3 : 4;

        const firstStrip = getStrip(x, z, ddx, ddz, tile.zoneType, maxPlotDim);
        if (!firstStrip.length) continue;

        const depth = firstStrip.length;
        const strips = [firstStrip];

        // Expand width (up to maxPlotDim), each new strip must also be road-adjacent on the same side
        for (let w = 1; w < maxPlotDim; w++) {
          const nx = x + wdx * w, nz = z + wdz * w;
          const nt = this.getTile(nx, nz);
          if (!nt || nt.type !== 'zone' || nt.zoneType !== tile.zoneType) break;
          if (assigned.has(`${nx}_${nz}`)) break;
          const roadNb = this.getTile(nx + rdx, nz + rdz);
          if (roadNb?.type !== 'road') break;
          const strip = getStrip(nx, nz, ddx, ddz, tile.zoneType, maxPlotDim);
          if (strip.length < depth) break;
          strips.push(strip.slice(0, depth));
        }

        const allTiles = strips.flat();
        for (const t of allTiles) assigned.add(`${t.x}_${t.z}`);

        const anchor = strips[0][0];
        const xs = allTiles.map(t => t.x), zs = allTiles.map(t => t.z);
        plots.push({
          anchorX: anchor.x, anchorZ: anchor.z,
          width: strips.length, depth,
          zoneType: tile.zoneType,
          roadDir,
          tiles: allTiles,
          worldCX: (Math.min(...xs) + Math.max(...xs) + 1) / 2,
          worldCZ: (Math.min(...zs) + Math.max(...zs) + 1) / 2,
        });
      }
    }
    return plots;
  }

  /**
   * Place a plot building. Creates the building mesh centred on the plot,
   * adds a garden mesh (fence + props) and optionally a garage.
   * Assigns the same building object to all plot tiles.
   * @param {object} plot  Descriptor from detectPlots()
   * @param {string} buildingId
   * @returns {boolean}
   */
  placePlot(plot, buildingId) {
    const def = BUILDINGS[buildingId];
    if (!def) return false;

    // Validate all tiles are still free zone tiles
    for (const t of plot.tiles) {
      const tile = this.getTile(t.x, t.z);
      if (!tile || tile.type !== 'zone' || tile.building) return false;
    }

    const TILE_H = 0.06;
    const seed = plot.anchorX + plot.anchorZ * this.size;

    // Build the main building mesh centred on the plot
    const mesh = createBuildingMesh(buildingId, seed);
    const ROAD_DIR_ROTATION = { N: Math.PI, S: 0, E: -Math.PI / 2, W: Math.PI / 2 };
    const plotRotation = ROAD_DIR_ROTATION[plot.roadDir] ?? 0;
    mesh.rotation.y = plotRotation;
    mesh.position.set(plot.worldCX, TILE_H / 2 + def.height / 2, plot.worldCZ);
    mesh.userData.buildingId = buildingId;
    mesh.userData.tileX = plot.anchorX;
    mesh.userData.tileZ = plot.anchorZ;
    this._scene.add(mesh);
    this._bMeshes.set(this._key(plot.anchorX, plot.anchorZ), mesh);

    // Garden mesh (fence around plot perimeter + props)
    const gardenMesh = createPlotGardenMesh(plot, seed, def.zoneType);
    if (gardenMesh) {
      gardenMesh.position.set(0, TILE_H / 2, 0);
      this._scene.add(gardenMesh);
    }

    // Garage for larger residential plots (area >= 4)
    let garageMesh = null;
    if (def.zoneType === 'R' && plot.width * plot.depth >= 4) {
      garageMesh = createGarageMesh(seed);
      const offX = (plot.roadDir === 'E') ? -0.4 : 0.4;
      const offZ = (plot.roadDir === 'N') ? 0.35 : -0.35;
      garageMesh.position.set(plot.worldCX + offX, TILE_H / 2, plot.worldCZ + offZ);
      this._scene.add(garageMesh);
    }

    const isLowDensityR = def.zoneType === 'R';
    const plotArea      = plot.width * plot.depth;
    const building = {
      id: buildingId, def, mesh,
      gardenMesh: gardenMesh || null,
      garageMesh: garageMesh || null,
      fillPercentage: isLowDensityR ? 1.0 : 0.1,
      // Residents and jobs scale with plot area to maintain density parity
      residents: isLowDensityR ? (3 + Math.floor(Math.random() * 4)) * plotArea : 0,
      jobs: (def.provides?.jobs || 0) * plotArea,
      level: 1,
      rotation: plotRotation,
      tileX: plot.anchorX, tileZ: plot.anchorZ,
      plotWidth: plot.width, plotDepth: plot.depth,
      plotRoadDir: plot.roadDir,
      plotTiles: plot.tiles.map(t => ({ x: t.x, z: t.z })),
    };

    for (const t of plot.tiles) {
      const tile = this.getTile(t.x, t.z);
      if (tile) { tile.building = building; this._restoreColor(tile); }
    }

    this.calculateRoadAccess();
    return true;
  }

  getStats() {
    let population = 0, totalJobs = 0, cJobs = 0, iJobs = 0, serviceJobs = 0;
    let powerNeeded = 0, powerAvailable = 0;
    let waterNeeded = 0, waterAvailable = 0;
    let rZones = 0, cZones = 0, iZones = 0;
    let rBuildings = 0, cBuildings = 0, iBuildings = 0;
    let avgRFill = 0;   // sum of R fillPercentage, divide by rBuildings for average
    const allBuildings = [];

    for (const t of this.getAllTiles()) {
      if (t.type === 'zone') {
        if (t.zoneType === 'R') {
          rZones++;
          // Only count on the anchor tile to avoid double-counting plot buildings
          if (t.building && t.x === t.building.tileX && t.z === t.building.tileZ) {
            rBuildings++;
            avgRFill += t.building.fillPercentage ?? 0;
          }
        } else if (t.zoneType === 'C') {
          cZones++;
          if (t.building && t.x === t.building.tileX && t.z === t.building.tileZ) cBuildings++;
        } else if (t.zoneType === 'I') {
          iZones++;
          if (t.building && t.x === t.building.tileX && t.z === t.building.tileZ) iBuildings++;
        }
      }
      if (!t.building) continue;
      // Only count the anchor tile of multi-tile buildings (satellites share the same object)
      if (t.x !== t.building.tileX || t.z !== t.building.tileZ) continue;
      const b = t.building, def = b.def;
      allBuildings.push(b);
      population     += b.residents || 0;
      const jobs      = def.provides?.jobs || 0;
      totalJobs      += jobs;
      if (def.zoneType === 'C')          cJobs      += jobs;
      else if (def.zoneType === 'I')     iJobs      += jobs;
      else if (def.category === 'service') serviceJobs += jobs;
      powerAvailable += def.provides?.power_kw    || 0;
      waterAvailable += def.provides?.water_units || 0;
      powerNeeded    += def.requires?.power       || 0;
      waterNeeded    += def.requires?.water       || 0;
    }

    avgRFill = rBuildings > 0 ? avgRFill / rBuildings : 0;

    return { population, totalJobs, cJobs, iJobs, serviceJobs,
             rZones, cZones, iZones, rBuildings, cBuildings, iBuildings,
             avgRFill,
             powerNeeded, powerAvailable,
             waterNeeded, waterAvailable, allBuildings };
  }

  // ── Drag preview ─────────────────────────────────────────────────

  /**
   * Highlight a set of tiles with drag-preview colours.
   * @param {object[]} tiles    Array of tile objects to preview.
   * @param {object}   tool     Active tool { type, buildingId?, zoneType? }
   */
  setPreview(tiles, tool) {
    this.clearPreview();
    for (const tile of tiles) {
      this._previewTiles.add(tile);
      if (tile !== this._selected && tile !== this._hovered) {
        this._setTileColor(tile, this._previewColor(tile, tool));
      }
    }
  }

  /** Restore all previewed tiles to their natural colours. */
  clearPreview() {
    for (const tile of this._previewTiles) {
      if (tile !== this._selected && tile !== this._hovered)
        this._restoreColor(tile);
    }
    this._previewTiles.clear();
  }

  _previewColor(tile, tool) {
    if (tool.type === 'building' && tool.buildingId === 'road') {
      if (tile.type === 'terrain') {
        if (tile.terrainType === 'river')  return PREVIEW.bridge;
        if (tile.terrainType === 'forest') return PREVIEW.road;
        return PREVIEW.terrain_bad;
      }
      return PREVIEW.road;
    }
    if (tool.type === 'building' && tool.buildingId !== 'road') {
      if (tile.type === 'terrain' && tile.terrainType === 'river') return PREVIEW.zone_bad;
      if (tile.building) return PREVIEW.zone_bad;
      return 0xb3e5fc; // light blue: valid building placement
    }
    if (tool.type === 'zone') {
      if (tile.type === 'terrain' && tile.terrainType !== 'forest') return PREVIEW.zone_bad;
      if (tile.type === 'road') return PREVIEW.zone_bad;
      if (tile.building)        return PREVIEW.zone_bad;
      return PREVIEW[`zone_${tool.zoneType.toLowerCase()}`] ?? PREVIEW.zone_r;
    }
    return 0xf0f0f0;
  }

  // ── Hover / Select highlight ─────────────────────────────────────

  /** @param {object|null} tile */
  setHover(tile) {
    if (this._hovered && this._hovered !== this._selected &&
        !this._previewTiles.has(this._hovered)) {
      this._restoreColor(this._hovered);
    }
    this._hovered = tile;
    if (tile && tile !== this._selected && !this._previewTiles.has(tile)) {
      this._setTileColor(tile, C.hover);
    }
  }

  /** @param {object|null} tile */
  setSelected(tile) {
    if (this._selected) this._restoreColor(this._selected);
    this._selected = tile;
    if (tile) this._setTileColor(tile, C.select);
  }

  clearSelected() {
    if (this._selected) this._restoreColor(this._selected);
    this._selected = null;
  }
}
