/**
 * @module main
 * Entry point. Wires scene, grid, city, terrain, and UI together.
 * Owns the animation loop, raycaster, and all input handling including
 * drag-to-build for roads (straight lines) and zones (rectangles).
 */
import * as THREE from 'three';
import { initScene, getCamera, getRenderer, getControls, render, applyLaborStateColors, rebuildSceneFromGrid, showRangeOverlay, hideRangeOverlay, showHeatmap, hideHeatmap, updateRoadMarkings } from './scene.js';
import { Grid }    from './grid.js';
import { City }    from './city.js';
import { generateTerrain, clearForestAt } from './terrain.js';
import {
  initToolbar, initHUD, initNotifications, initDebugPanel,
  getActiveTool, resetTool, showTileInfo, showNotification,
  initSpeedControls, initPauseMenu,
  initHeatmapControls, getActiveHeatmap,
} from './ui.js';
import { BUILDINGS, createBuildingMesh } from './buildings.js';
import { initModalTriggers } from './modals.js';
import { TrafficSystem } from './traffic/trafficSystem.js';
import { TrafficLightSystem } from './traffic/trafficLights.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

const container = document.getElementById('game-container');
const { scene } = initScene(container);
const camera    = getCamera();
const renderer  = getRenderer();
const controls  = getControls();

const grid = new Grid(scene, 80);
const city = new City(grid);

generateTerrain(grid, scene);
grid.setDecorationRemover((x, z) => clearForestAt(scene, x, z));

initToolbar(city);
initHUD(city);
initNotifications(city);
initModalTriggers(city);
initDebugPanel(city);
initSpeedControls(city);
initPauseMenu(city);

city.on('laborStateChanged', applyLaborStateColors);

// ── Traffic system ───────────────────────────────────────────────────────────

const trafficSystem = new TrafficSystem();
trafficSystem.init(scene, grid);

// Expose for settings / handedness toggle
window._trafficSystem = trafficSystem;

city.on('stateChanged', () => trafficSystem.rebuild());

const trafficLights = new TrafficLightSystem();
trafficLights.init(scene, grid);
trafficSystem.setTrafficLights(trafficLights);
window._trafficLights = trafficLights;

city.on('stateChanged', () => trafficLights.rebuild());

// ── Heatmap ───────────────────────────────────────────────────────────────────

function _refreshHeatmap() {
  const type = getActiveHeatmap();
  if (type) showHeatmap(grid, type);
  else hideHeatmap();
}

initHeatmapControls(_refreshHeatmap);
city.on('stateChanged',   _refreshHeatmap);
city.on('dayTick',        _refreshHeatmap);
city.on('monthProcessed', _refreshHeatmap);

// ── Scene rebuild after load / reset ─────────────────────────────────────────

city.on('stateChanged', () => updateRoadMarkings(grid));

city.on('gameLoaded', ({ oldForestTiles, oldMeshes }) => {
  // Remove stale building meshes from scene.
  for (const mesh of oldMeshes) scene.remove(mesh);
  // Clear forest tree meshes.
  for (const { x, z } of oldForestTiles) clearForestAt(scene, x, z);
  // Rebuild floor colors and building meshes from grid state.
  rebuildSceneFromGrid(grid);
  updateRoadMarkings(grid);
  _refreshHeatmap();
  trafficSystem.clear(); trafficSystem.rebuild();
  trafficLights.clear(); trafficLights.rebuild();
});

city.on('gameReset', ({ oldForestTiles, oldMeshes }) => {
  // Remove stale building meshes from scene.
  for (const mesh of oldMeshes) scene.remove(mesh);
  // Clear all forest tree meshes.
  for (const { x, z } of oldForestTiles) clearForestAt(scene, x, z);
  // Regenerate fresh terrain (rivers, forests, trees).
  generateTerrain(grid, scene);
  grid.setDecorationRemover((x, z) => clearForestAt(scene, x, z));
  // Update floor colors.
  rebuildSceneFromGrid(grid);
  updateRoadMarkings(grid);
  _refreshHeatmap();
  trafficSystem.clear(); trafficSystem.rebuild();
  trafficLights.clear(); trafficLights.rebuild();
});

city.emit('stateChanged', city.getState());
city.emit('dayTick',      city.getState());
updateRoadMarkings(grid);

// ── Raycasting ───────────────────────────────────────────────────────────────

const raycaster  = new THREE.Raycaster();
const _mouseNDC  = new THREE.Vector2();
const rayTargets = grid.getRaycastTargets();

/**
 * Return the tile under the current mouse position, or null.
 * @param {MouseEvent} e
 */
function getTileUnderMouse(e) {
  const rect   = renderer.domElement.getBoundingClientRect();
  _mouseNDC.x  = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  _mouseNDC.y  = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
  raycaster.setFromCamera(_mouseNDC, camera);
  const hits = raycaster.intersectObjects(rayTargets, false);
  return hits.length ? hits[0].object.userData.tile : null;
}

// ── Drag-to-build helpers ────────────────────────────────────────────────────

/**
 * Compute tiles along the straighter axis between two tiles.
 * Used for road drags.
 * @param {object} a @param {object} b
 * @returns {object[]}
 */
function getRoadLineTiles(a, b) {
  const tiles = [];
  const dx    = b.x - a.x;
  const dz    = b.z - a.z;

  if (Math.abs(dx) >= Math.abs(dz)) {
    // Horizontal (X axis)
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    for (let x = minX; x <= maxX; x++) {
      const t = grid.getTile(x, a.z);
      if (t) tiles.push(t);
    }
  } else {
    // Vertical (Z axis)
    const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
    for (let z = minZ; z <= maxZ; z++) {
      const t = grid.getTile(a.x, z);
      if (t) tiles.push(t);
    }
  }
  return tiles;
}

/**
 * Compute all tiles in the axis-aligned rectangle between two tiles.
 * Used for zone drags.
 * @param {object} a @param {object} b
 * @returns {object[]}
 */
function getZoneRectTiles(a, b) {
  const tiles = [];
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minZ = Math.min(a.z, b.z), maxZ = Math.max(a.z, b.z);
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const t = grid.getTile(x, z);
      if (t) tiles.push(t);
    }
  }
  return tiles;
}

/** Whether the current tool supports drag-to-build. */
function isDraggable(tool) {
  return tool && (
    tool.type === 'zone' ||
    tool.type === 'demolish' ||
    (tool.type === 'building' && tool.buildingId === 'road')
  );
}

/** Compute drag tiles for the given tool and start/end tiles. */
function getDragTiles(tool, start, end) {
  if (tool.type === 'building' && tool.buildingId === 'road')
    return getRoadLineTiles(start, end);
  if (tool.type === 'zone' || tool.type === 'demolish')
    return getZoneRectTiles(start, end);
  return [];
}

/**
 * Compute preview cost summary for road/bridge drag.
 * @param {object[]} tiles
 * @returns {{ roadCount, bridgeCount, invalidCount, totalCost }}
 */
function calcRoadDragCost(tiles) {
  let roadCount = 0, bridgeCount = 0, invalidCount = 0, totalCost = 0;
  for (const t of tiles) {
    if (t.type === 'terrain' && t.terrainType !== 'river' && t.terrainType !== 'forest') { invalidCount++; continue; }
    if (t.type === 'terrain' && t.terrainType === 'river') {
      bridgeCount++; totalCost += BUILDINGS.bridge.cost;
    } else {
      roadCount++; totalCost += BUILDINGS.road.cost;
    }
  }
  return { roadCount, bridgeCount, invalidCount, totalCost };
}

// ── Heatmap tile value ────────────────────────────────────────────────────────

function _heatmapTileValue(type, tile) {
  switch (type) {
    case 'happiness':  return tile.happiness;
    case 'pollution':  return tile.pollution;
    case 'landValue':  return tile.landValue;
    case 'police':     return tile.serviceCoverage.police;
    case 'fire':       return tile.serviceCoverage.fire;
    case 'hospital':   return tile.serviceCoverage.hospital;
    case 'education':  return tile.serviceCoverage.education;
    default:           return 0;
  }
}

// ── Cost toast ───────────────────────────────────────────────────────────────

const _toastVec = new THREE.Vector3();

/**
 * Spawn a floating cost label at a 3-D world position, drifting upward.
 * @param {number} worldX @param {number} worldZ @param {number} cost
 */
function spawnCostToast(worldX, worldZ, cost) {
  _toastVec.set(worldX, 0, worldZ).project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const sx = (_toastVec.x + 1) / 2 * rect.width  + rect.left;
  const sy = (-_toastVec.y + 1) / 2 * rect.height + rect.top;
  const div = document.createElement('div');
  div.className = 'cost-toast';
  div.textContent = `-€${cost.toLocaleString()}`;
  div.style.left = `${sx}px`;
  div.style.top  = `${sy}px`;
  document.body.appendChild(div);
  div.addEventListener('animationend', () => div.remove(), { once: true });
}

// ── Drag-info HUD helper ─────────────────────────────────────────────────────

const _dragInfoEl = document.getElementById('drag-info');
const _dragTextEl = document.getElementById('drag-info-text');

function showDragInfo(tool, tiles) {
  if (!_dragInfoEl || !_dragTextEl) return;

  let text;
  if (tool.type === 'building' && tool.buildingId === 'road') {
    const { roadCount, bridgeCount, invalidCount, totalCost } = calcRoadDragCost(tiles);
    const parts = [];
    if (roadCount)   parts.push(`${roadCount} road`);
    if (bridgeCount) parts.push(`${bridgeCount} bridge`);
    if (invalidCount) parts.push(`${invalidCount} blocked`);
    text = parts.join(' + ') + ` — €${totalCost}`;
  } else {
    const placeable = tiles.filter(t =>
      (t.type !== 'terrain' || t.terrainType === 'forest') && t.type !== 'road' && !t.building
    ).length;
    text = `${tiles.length}×${tool.zoneType} zone (${placeable} new)`;
  }

  _dragTextEl.textContent = text;
  _dragInfoEl.classList.remove('hidden');
}

function hideDragInfo() {
  _dragInfoEl?.classList.add('hidden');
}

// ── Input state ──────────────────────────────────────────────────────────────

let _dragStart      = null;   // tile where left-drag started
let _dragActiveTool = null;   // tool captured at drag start
let _isDragging     = false;
let _mouseDownX     = 0;
let _mouseDownY     = 0;
let _rightMouseDownX = 0;
let _rightMouseDownY = 0;
let _lastHoveredTile = null;
let _selectedTile    = null;

// ── Ghost mesh (transparent building preview while placing) ───────────────────

let _ghostMesh      = null;   // current transparent preview mesh
let _ghostBuildingId = null;  // which building the ghost currently shows
let _ghostRotation  = 0;      // current auto-computed Y rotation

/**
 * Determine which direction the building should face based on adjacent roads.
 * Default facing is south (+z). Checks south → north → east → west.
 * Returns a Y-axis rotation in radians.
 */
function _computeBuildingRotation(tile, buildingId) {
  const def = BUILDINGS[buildingId];
  if (!def) return 0;
  const [bw, bd] = Array.isArray(def.size) ? def.size : [def.size || 1, def.size || 1];

  // South edge (z + 1): default facing → rotation 0
  for (let i = 0; i < bw; i++) {
    if (grid.getTile(tile.x + i, tile.z + 1)?.type === 'road') return 0;
  }
  // North edge (z - bd): rotation π
  for (let i = 0; i < bw; i++) {
    if (grid.getTile(tile.x + i, tile.z - bd)?.type === 'road') return Math.PI;
  }
  // East edge (x + bw): rotation +π/2 (face east = +X direction)
  for (let i = 0; i < bd; i++) {
    if (grid.getTile(tile.x + bw, tile.z - i)?.type === 'road') return Math.PI / 2;
  }
  // West edge (x - 1): rotation -π/2 (face west = -X direction)
  for (let i = 0; i < bd; i++) {
    if (grid.getTile(tile.x - 1, tile.z - i)?.type === 'road') return -Math.PI / 2;
  }
  return 0; // no road found — face south by default
}

function _clearGhostMesh() {
  if (_ghostMesh) {
    scene.remove(_ghostMesh);
    _ghostMesh.traverse(child => {
      if (child.isMesh) { child.geometry?.dispose(); child.material?.dispose(); }
    });
    _ghostMesh = null;
  }
  _ghostBuildingId = null;
  _ghostRotation   = 0;
}

function _updateGhostMesh(tile, buildingId) {
  const def = BUILDINGS[buildingId];
  // Only show ghost for service/infra buildings (not auto-spawned zone types)
  if (!def || def.zoneType) { _clearGhostMesh(); return; }

  // Recreate mesh only when the building type changes
  if (_ghostBuildingId !== buildingId) {
    _clearGhostMesh();
    const mesh = createBuildingMesh(buildingId, 0);
    mesh.traverse(child => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity     = 0.5;
        child.material.depthWrite  = false;
      }
    });
    scene.add(mesh);
    _ghostMesh       = mesh;
    _ghostBuildingId = buildingId;
  }

  let [bw, bd] = Array.isArray(def.size) ? def.size : [def.size || 1, def.size || 1];
  // Recompute rotation first so we can adjust positioning
  _ghostRotation = _computeBuildingRotation(tile, buildingId);
  // When rotated 90°, the visual footprint is bw↔bd swapped
  const _rot90 = Math.abs(Math.abs(_ghostRotation) - Math.PI / 2) < 0.01;
  if (_rot90) { const tmp = bw; bw = bd; bd = tmp; }
  const worldCX   = tile.x + bw / 2;
  const worldCZ   = tile.z - bd / 2 + 1;
  const TILE_H    = 0.06;

  _ghostMesh.position.set(worldCX, TILE_H / 2 + def.height / 2, worldCZ);
  _ghostMesh.rotation.y = _ghostRotation;
}

const canvas = renderer.domElement;

// ── mousedown ─────────────────────────────────────────────────────

canvas.addEventListener('mousedown', e => {
  if (e.button === 2) { _rightMouseDownX = e.clientX; _rightMouseDownY = e.clientY; return; }
  if (e.button !== 0) return;
  _mouseDownX = e.clientX;
  _mouseDownY = e.clientY;
  _isDragging = false;
  _dragStart  = null;

  const tool = getActiveTool();
  if (isDraggable(tool)) {
    const tile = getTileUnderMouse(e);
    if (tile) { _dragStart = tile; _dragActiveTool = tool; }
  }
});

// ── mousemove ─────────────────────────────────────────────────────

canvas.addEventListener('mousemove', e => {
  const tile = getTileUnderMouse(e);
  _lastHoveredTile = tile;

  // Detect drag threshold
  if (e.buttons === 1 && _dragStart) {
    const dx = e.clientX - _mouseDownX;
    const dy = e.clientY - _mouseDownY;
    if (!_isDragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) _isDragging = true;

    if (_isDragging && tile) {
      const tiles = getDragTiles(_dragActiveTool, _dragStart, tile);
      grid.setPreview(tiles, _dragActiveTool);
      showDragInfo(_dragActiveTool, tiles);
    }
    hideRangeOverlay();
    return; // suppress hover highlight during drag
  }

  // Range overlay for radius-based buildings
  const tool = getActiveTool();
  if (tool?.type === 'building' && tile) {
    const def = BUILDINGS[tool.buildingId];
    if (def?.provides?.radius) {
      const [w, d] = Array.isArray(def.size) ? def.size : [1, 1];
      showRangeOverlay(tile.x + w / 2, tile.z - d / 2 + 1, def.provides.radius);
    } else {
      hideRangeOverlay();
    }
  } else {
    hideRangeOverlay();
  }

  // Heatmap value tooltip on hover
  const heatmapType = getActiveHeatmap();
  if (heatmapType && tile && !_isDragging) {
    const val = _heatmapTileValue(heatmapType, tile);
    const label = { happiness: 'Happiness', pollution: 'Pollution', landValue: 'Land Value',
      police: 'Police', fire: 'Fire', hospital: 'Hospital', education: 'Education' }[heatmapType];
    _dragTextEl.textContent = `${label}: ${Math.round(val)}`;
    _dragInfoEl.classList.remove('hidden');
  } else if (!_isDragging) {
    hideDragInfo();
  }

  // Ghost mesh + footprint hover for building tools
  const def = tool?.type === 'building' ? BUILDINGS[tool.buildingId] : null;
  if (tool?.type === 'building' && tile) {
    // Show transparent 3D ghost (auto-rotated to face nearest road)
    _updateGhostMesh(tile, tool.buildingId);

    // Also tint footprint tiles for placement validity feedback
    // When rotated 90°, swap bw↔bd so the preview matches the visual ghost
    let [bw, bd] = Array.isArray(def?.size) ? def.size : [1, 1];
    const _fp90 = Math.abs(Math.abs(_ghostRotation) - Math.PI / 2) < 0.01;
    if (_fp90) { const tmp = bw; bw = bd; bd = tmp; }
    if (bw > 1 || bd > 1) {
      const footprintTiles = [];
      for (let dx = 0; dx < bw; dx++) {
        for (let dz = 0; dz < bd; dz++) {
          const ft = grid.getTile(tile.x + dx, tile.z - dz);
          if (ft) footprintTiles.push(ft);
        }
      }
      grid.setHover(null);
      grid.setPreview(footprintTiles, tool);
    } else {
      grid.clearPreview();
      grid.setHover(tile);
    }
  } else {
    _clearGhostMesh();
    grid.clearPreview();
    grid.setHover(tile);
  }
});

// ── mouseup ───────────────────────────────────────────────────────

canvas.addEventListener('mouseup', e => {
  // Right-click → cancel tool only on pure click (not a right-drag pan)
  if (e.button === 2) {
    const dx = e.clientX - _rightMouseDownX;
    const dy = e.clientY - _rightMouseDownY;
    if (Math.abs(dx) <= 4 && Math.abs(dy) <= 4) { resetTool(); _clearGhostMesh(); }
    return;
  }
  if (e.button !== 0) return;

  if (_isDragging && _dragStart) {
    // ── Apply drag ──────────────────────────────────────────────
    const endTile = getTileUnderMouse(e) ?? _lastHoveredTile;
    if (endTile) {
      const tiles = getDragTiles(_dragActiveTool, _dragStart, endTile);
      _applyDrag(_dragActiveTool, tiles);
    }
    grid.clearPreview();
    hideDragInfo();
    grid.setHover(_lastHoveredTile);
  } else {
    // ── Single click ────────────────────────────────────────────
    const tile = getTileUnderMouse(e);
    if (tile) _handleTileClick(tile, getActiveTool());
  }

  _dragStart      = null;
  _dragActiveTool = null;
  _isDragging     = false;
});

canvas.addEventListener('mouseleave', () => {
  if (!_isDragging) { grid.setHover(null); hideRangeOverlay(); hideDragInfo(); _clearGhostMesh(); }
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Click handler ─────────────────────────────────────────────────

function _handleTileClick(tile, tool) {
  if (!tool) return;
  let result;

  if (tool.type === 'zone') {
    result = city.placeZone(tile.x, tile.z, tool.zoneType);

  } else if (tool.type === 'building') {
    result = city.placeBuilding(tile.x, tile.z, tool.buildingId, _ghostRotation);
    if (result?.success) {
      const def = BUILDINGS[tool.buildingId];
      if (def) {
        const [w, d] = Array.isArray(def.size) ? def.size : [1, 1];
        spawnCostToast(tile.x + w / 2, tile.z - d / 2 + 1, def.cost);
      }
      // Road placement can create/destroy junctions — keep traffic lights in sync
      if (tool.buildingId === 'road') trafficLights.rebuild();
      hideRangeOverlay();
    }

  } else if (tool.type === 'trafficLight') {
    result = city.placeTrafficLight(tile.x, tile.z);
    if (result?.success) {
      trafficLights.rebuild();
      spawnCostToast(tile.x + 0.5, tile.z + 0.5, result.removed ? -250 : 500);
    }

  } else if (tool.type === 'demolish') {
    result = city.demolish(tile.x, tile.z);
    if (result?.success) trafficLights.rebuild();

  } else if (tool.type === 'select') {
    if (_selectedTile === tile) {
      grid.clearSelected();
      _selectedTile = null;
      showTileInfo(null);
    } else {
      grid.setSelected(tile);
      _selectedTile = tile;
      showTileInfo(tile);
    }
    return;
  }

  if (result && !result.success) {
    showNotification(result.reason, 'error');
  }
  if (_selectedTile === tile) showTileInfo(tile);
}

// ── Drag apply ────────────────────────────────────────────────────

function _applyDrag(tool, tiles) {
  if (tool.type === 'building' && tool.buildingId === 'road') {
    const result = city.placeRoadLine(tiles);
    if (result.errors.length) {
      showNotification(result.errors[0], 'error');
    } else if (result.placed > 0) {
      showNotification(`${result.placed} tiles placed — €${result.cost}`, 'info', 1800);
    }

  } else if (tool.type === 'zone') {
    const result = city.placeZoneRect(tiles, tool.zoneType);
    if (result.placed > 0) {
      showNotification(`${result.placed} ${tool.zoneType} zone tiles painted`, 'info', 1500);
    }
  } else if (tool.type === 'demolish') {
    let count = 0;
    for (const tile of tiles) {
      const r = city.demolish(tile.x, tile.z);
      if (r?.success) count++;
    }
    if (count > 0) showNotification(`${count} tile${count > 1 ? 's' : ''} demolished`, 'info', 1500);
  }

  // Refresh info panel if selected tile was in the drag
  if (_selectedTile && tiles.includes(_selectedTile)) showTileInfo(_selectedTile);
}

// ── Keyboard pan ─────────────────────────────────────────────────────────────

const _keys     = new Set();
const PAN_SPEED = 0.25;

window.addEventListener('keydown', e => _keys.add(e.code));
window.addEventListener('keyup',   e => _keys.delete(e.code));

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  // Don't fire when user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'b':
    case 'B': {
      // Select bulldozer (demolish) tool
      const demolishBtn = document.querySelector('button[data-tool="demolish"]');
      if (demolishBtn && !demolishBtn.classList.contains('locked')) {
        demolishBtn.click();
      }
      break;
    }
    case ' ':
      e.preventDefault();
      city.togglePause();
      break;
  }
});

function _handleKeyPan() {
  let dx = 0, dz = 0;
  if (_keys.has('ArrowLeft')  || _keys.has('KeyA')) dx -= PAN_SPEED;
  if (_keys.has('ArrowRight') || _keys.has('KeyD')) dx += PAN_SPEED;
  if (_keys.has('ArrowUp')    || _keys.has('KeyW')) dz -= PAN_SPEED;
  if (_keys.has('ArrowDown')  || _keys.has('KeyS')) dz += PAN_SPEED;
  if (!dx && !dz) return;
  camera.position.x  += dx;  camera.position.z  += dz;
  controls.target.x  += dx;  controls.target.z  += dz;
  controls.update();
}

// ── Animation loop ───────────────────────────────────────────────────────────

let _lastTime = 0;

// ── FPS counter ───────────────────────────────────────────────────────────────
const _fpsEl = document.createElement('div');
_fpsEl.id = 'fps-counter';
Object.assign(_fpsEl.style, {
  position: 'fixed', top: '8px', right: '8px',
  background: 'rgba(0,0,0,0.45)', color: '#fff',
  font: '11px/1.4 monospace', padding: '2px 7px',
  borderRadius: '4px', pointerEvents: 'none', zIndex: '9999',
  userSelect: 'none',
});
document.body.appendChild(_fpsEl);
let _fpsCount = 0, _fpsAccum = 0, _fpsDisplay = 0;

function animate(ts) {
  requestAnimationFrame(animate);
  const dt = Math.min(ts - _lastTime, 200);
  _lastTime = ts;
  _handleKeyPan();
  city.tick(dt);
  trafficSystem.tick(dt, city.getGameHour(), city.getSpeedMultiplier(), city.getState());
  trafficLights.tick(dt, city.getSpeedMultiplier(), trafficSystem.getCars());
  render();
  // FPS
  _fpsCount++;
  _fpsAccum += dt;
  if (_fpsAccum >= 500) {
    _fpsDisplay = Math.round(_fpsCount * 1000 / _fpsAccum);
    _fpsEl.textContent = `${_fpsDisplay} FPS`;
    _fpsCount = 0; _fpsAccum = 0;
  }
}

requestAnimationFrame(t => { _lastTime = t; animate(t); });
