/**
 * @module scene
 * Three.js scene, OrthographicCamera, renderer, and OrbitControls.
 * No game logic lives here.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBuildingMesh, createBridgeMesh, BUILDINGS } from './buildings.js';

const GRID_SIZE    = 40;
const GRID_CENTER  = new THREE.Vector3(GRID_SIZE / 2, 0, GRID_SIZE / 2);
const BASE_FRUSTUM = 35; // world units visible vertically at zoom=1

let _scene, _camera, _renderer, _controls;
let _container;

/**
 * Initialise the Three.js scene and attach the canvas to `container`.
 * @param {HTMLElement} container
 * @returns {{ scene, camera, renderer, controls }}
 */
export function initScene(container) {
  _container = container;

  // ── Scene ────────────────────────────────────────────────────────
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x87ceeb);
  _scene.fog = new THREE.Fog(0x87ceeb, 90, 130);

  // ── Camera ───────────────────────────────────────────────────────
  const aspect = container.clientWidth / container.clientHeight;
  _camera = new THREE.OrthographicCamera(
    -BASE_FRUSTUM * aspect / 2,
     BASE_FRUSTUM * aspect / 2,
     BASE_FRUSTUM / 2,
    -BASE_FRUSTUM / 2,
    0.1, 600,
  );

  // Isometric angle: 45° in XZ plane, ~35° elevation
  _camera.position.set(GRID_CENTER.x + 30, 30, GRID_CENTER.z + 30);
  _camera.lookAt(GRID_CENTER);
  _camera.updateProjectionMatrix();

  // ── Renderer ─────────────────────────────────────────────────────
  _renderer = new THREE.WebGLRenderer({ antialias: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderer.setSize(container.clientWidth, container.clientHeight);
  _renderer.shadowMap.enabled = true;
  _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(_renderer.domElement);

  // ── Lights ───────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  _scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(45, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { near: 1, far: 200, left: -55, right: 55, top: 55, bottom: -55 });
  _scene.add(sun);

  // Secondary fill light from opposite side
  const fill = new THREE.DirectionalLight(0xc8d8ff, 0.35);
  fill.position.set(-30, 20, -30);
  _scene.add(fill);

  // ── OrbitControls ────────────────────────────────────────────────
  // Middle/right drag = pan, wheel = zoom. Left handled by main.js.
  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableRotate = false;
  _controls.enableZoom   = true;
  _controls.enablePan    = true;
  _controls.zoomSpeed    = 1.2;
  _controls.panSpeed     = 0.7;
  _controls.minZoom      = 0.3;
  _controls.maxZoom      = 4.0;
  _controls.mouseButtons = {
    LEFT:   null,               // we handle left click ourselves
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT:  THREE.MOUSE.PAN,
  };
  _controls.target.copy(GRID_CENTER);
  _controls.update();

  // ── Resize ───────────────────────────────────────────────────────
  window.addEventListener('resize', _onResize);

  return { scene: _scene, camera: _camera, renderer: _renderer, controls: _controls };
}

function _onResize() {
  const w = _container.clientWidth;
  const h = _container.clientHeight;
  const aspect = w / h;
  const zoom   = _camera.zoom;  // preserve current zoom level

  _camera.left   = -BASE_FRUSTUM * aspect / 2;
  _camera.right  =  BASE_FRUSTUM * aspect / 2;
  _camera.top    =  BASE_FRUSTUM / 2;
  _camera.bottom = -BASE_FRUSTUM / 2;
  _camera.zoom   = zoom;
  _camera.updateProjectionMatrix();

  _renderer.setSize(w, h);
}

/** Render one frame (call each RAF). */
export function render() {
  _controls.update();
  _renderer.render(_scene, _camera);
}

export function getScene()    { return _scene;    }
export function getCamera()   { return _camera;   }
export function getRenderer() { return _renderer; }
export function getControls() { return _controls; }

// ── Range overlay ─────────────────────────────────────────────────────────────

const _OVERLAY_MAT = new THREE.MeshBasicMaterial({
  color: 0x4dd0e1, transparent: true, opacity: 0.30,
  depthWrite: false, side: THREE.DoubleSide,
});
const _OVERLAY_GEO = new THREE.PlaneGeometry(0.92, 0.92);

let _overlayPool   = [];
let _activeOverlay = [];

/**
 * Show a semi-transparent teal overlay on all tiles within Manhattan-distance
 * `radius` of world centre (cx, cz).
 * @param {number} cx  World-space X centre (may be fractional for multi-tile)
 * @param {number} cz  World-space Z centre
 * @param {number} radius
 */
export function showRangeOverlay(cx, cz, radius) {
  hideRangeOverlay();
  const tileY = _TILE_H + 0.005;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(GRID_SIZE - 1, Math.ceil(cx + radius));
  const z0 = Math.max(0, Math.floor(cz - radius));
  const z1 = Math.min(GRID_SIZE - 1, Math.ceil(cz + radius));
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      // Chebyshev distance → square in world space → diamond on isometric screen
      if (Math.abs((x + 0.5) - cx) > radius || Math.abs((z + 0.5) - cz) > radius) continue;
      let quad = _overlayPool.pop();
      if (!quad) {
        quad = new THREE.Mesh(_OVERLAY_GEO, _OVERLAY_MAT);
        quad.rotation.x = -Math.PI / 2;
      }
      quad.position.set(x + 0.5, tileY, z + 0.5);
      quad.visible = true;
      _scene.add(quad);
      _activeOverlay.push(quad);
    }
  }
}

/** Remove all range-overlay quads and return them to the pool. */
export function hideRangeOverlay() {
  for (const quad of _activeOverlay) {
    _scene.remove(quad);
    _overlayPool.push(quad);
  }
  _activeOverlay = [];
}

// ── Heatmap overlay ───────────────────────────────────────────────────────────

const _HEATMAP_GEO = new THREE.PlaneGeometry(0.92, 0.92);
const _hc1 = new THREE.Color();
const _hc2 = new THREE.Color();

let _heatmapQuads = null; // _heatmapQuads[z][x] = Mesh, lazily created

function _ensureHeatmapGrid() {
  if (_heatmapQuads) return;
  _heatmapQuads = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    _heatmapQuads[z] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const mat  = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.65, depthWrite: false });
      const quad = new THREE.Mesh(_HEATMAP_GEO, mat);
      quad.rotation.x = -Math.PI / 2;
      quad.position.set(x + 0.5, 0.076, z + 0.5); // _TILE_H + 0.016, above range overlay
      quad.visible = false;
      _scene.add(quad);
      _heatmapQuads[z][x] = quad;
    }
  }
}

function _triGradient(t, hexLow, hexMid, hexHigh) {
  if (t <= 0.5) return _hc1.setHex(hexLow).lerp(_hc2.setHex(hexMid), t * 2).getHex();
  return _hc1.setHex(hexMid).lerp(_hc2.setHex(hexHigh), (t - 0.5) * 2).getHex();
}

function _duoGradient(t, hexLow, hexHigh) {
  return _hc1.setHex(hexLow).lerp(_hc2.setHex(hexHigh), t).getHex();
}

function _tileHeatColor(type, tile) {
  switch (type) {
    case 'happiness':  return _triGradient(tile.happiness  / 100, 0xcc2200, 0xffcc00, 0x33bb33);
    case 'pollution':  return _triGradient(tile.pollution  / 100, 0x33bb33, 0xffcc00, 0xcc2200);
    case 'landValue':  return _triGradient(tile.landValue  / 100, 0x001155, 0x0099bb, 0xeeeeff);
    case 'police':     return _duoGradient(tile.serviceCoverage.police    / 100, 0x050520, 0x2244ff);
    case 'fire':       return _duoGradient(tile.serviceCoverage.fire      / 100, 0x200500, 0xff4400);
    case 'hospital':   return _duoGradient(tile.serviceCoverage.hospital  / 100, 0x011a0a, 0x00cc55);
    case 'education':  return _duoGradient(tile.serviceCoverage.education / 100, 0x150020, 0xaa33ff);
    default:           return 0x000000;
  }
}

/**
 * Render a full-grid heatmap overlay. Call on every dayTick / monthProcessed.
 * @param {import('./grid.js').Grid} grid
 * @param {'happiness'|'pollution'|'landValue'|'police'|'fire'|'hospital'|'education'} type
 */
export function showHeatmap(grid, type) {
  _ensureHeatmapGrid();
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const tile = grid.getTile(x, z);
      const quad = _heatmapQuads[z][x];
      if (!tile || !quad) continue;
      quad.material.color.setHex(_tileHeatColor(type, tile));
      quad.visible = true;
    }
  }
}

/** Remove the heatmap overlay. */
export function hideHeatmap() {
  if (!_heatmapQuads) return;
  for (const row of _heatmapQuads)
    for (const quad of row) quad.visible = false;
}

// ── Post-load scene rebuild ───────────────────────────────────────────────────

const _TILE_H = 0.06;

/** Mirror of grid.js _tileColor — derives floor hex from tile state. */
function _deriveFloorColor(tile) {
  if (tile.isBridge) return 0x1565c0;
  switch (tile.type) {
    case 'road':    return 0x37474f;
    case 'terrain':
      return { river: 0x1565c0, forest: 0x2e7d32, field: 0xf9a825 }[tile.terrainType] ?? 0x5a8a3c;
    case 'zone':
    case 'service':
    case 'infra':
      if (tile.zoneType) return { R: 0x81c784, C: 0x64b5f6, I: 0xb0bec5 }[tile.zoneType] ?? 0x5a8a3c;
      if (tile.building) return tile.building.def.color;
      return 0x5a8a3c;
    default:
      return 0x5a8a3c;
  }
}

/**
 * Rebuild Three.js building meshes after a game load or reset.
 * Caller must remove old meshes from the scene BEFORE calling this.
 * Updates every floor tile's color and creates building meshes for tiles
 * where tile.building exists but tile.building.mesh is null.
 * Also repopulates grid._bMeshes so demolish / replace work correctly.
 * @param {import('./grid.js').Grid} grid
 */
export function rebuildSceneFromGrid(grid) {
  // Clear stale building mesh map — old meshes were already removed by caller.
  if (grid._bMeshes) grid._bMeshes.clear();

  for (const tile of grid.getAllTiles()) {
    // Restore floor color (direct mutation avoids importing Grid internals).
    if (tile.mesh) {
      tile.mesh.material = new THREE.MeshLambertMaterial({ color: _deriveFloorColor(tile) });
    }

    if (!tile.building || tile.building.mesh !== null) continue;
    // Only create mesh for anchor tiles; satellites share the same building object
    if (tile.x !== tile.building.tileX || tile.z !== tile.building.tileZ) continue;

    const { x, z } = tile;
    const { id, def } = tile.building;

    let mesh;
    if (tile.isBridge) {
      mesh = createBridgeMesh();
      mesh.position.set(x + 0.5, _TILE_H / 2, z + 0.5);
    } else {
      const [bw, bd] = Array.isArray(def.size) ? def.size : [def.size || 1, def.size || 1];
      const worldCX = x + bw / 2;
      const worldCZ = z - bd / 2 + 1;
      mesh = createBuildingMesh(id);
      mesh.position.set(worldCX, _TILE_H / 2 + def.height / 2, worldCZ);
    }
    mesh.userData.buildingId = id;
    mesh.userData.tileX      = x;
    mesh.userData.tileZ      = z;
    _scene.add(mesh);
    tile.building.mesh = mesh;
    if (grid._bMeshes) grid._bMeshes.set(`${x}_${z}`, mesh);
  }

  // Apply labor state colors immediately so loaded state is visually correct.
  const allBuildings = grid.getAllTiles()
    .filter(t => t.building?.mesh)
    .map(t => t.building);
  applyLaborStateColors(allBuildings);
}

/**
 * Update mesh colours for C and I buildings based on their laborState.
 * Call this whenever 'laborStateChanged' is emitted by the City.
 * @param {object[]} buildings  Array of building instances with .mesh, .laborState, .baseColor
 */
export function applyLaborStateColors(buildings) {
  for (const b of buildings) {
    if (!b.mesh) continue;
    const zt = b.def?.zoneType;
    if (zt !== 'C' && zt !== 'I') continue;

    const base = new THREE.Color(b.baseColor ?? b.def?.color ?? 0xffffff);
    let target;

    if (b.recovering) {
      target = new THREE.Color(0x222222);
      target.lerp(base, 0.4);
    } else if (b.laborState === 'abandoned') {
      target = new THREE.Color(0x222222);
    } else if (b.laborState === 'struggling') {
      target = base.clone().multiplyScalar(0.6);
      target.lerp(new THREE.Color(0xff6600), 0.2);
    } else {
      target = base.clone();
    }

    b.mesh.traverse(child => {
      if (child.isMesh) child.material.color.copy(target);
    });
  }
}
