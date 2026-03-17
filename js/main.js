/**
 * @module main
 * Entry point. Wires scene, grid, city, terrain, and UI together.
 * Owns the animation loop, raycaster, and all input handling including
 * drag-to-build for roads (straight lines) and zones (rectangles).
 */
import * as THREE from 'three';
import { initScene, getCamera, getRenderer, getControls, render, applyLaborStateColors } from './scene.js';
import { Grid }    from './grid.js';
import { City }    from './city.js';
import { generateTerrain, clearForestAt } from './terrain.js';
import {
  initToolbar, initHUD, initNotifications, initDebugPanel,
  getActiveTool, resetTool, showTileInfo, showNotification,
} from './ui.js';
import { BUILDINGS } from './buildings.js';
import { initModalTriggers } from './modals.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

const container = document.getElementById('game-container');
const { scene } = initScene(container);
const camera    = getCamera();
const renderer  = getRenderer();
const controls  = getControls();

const grid = new Grid(scene, 40);
const city = new City(grid);

generateTerrain(grid, scene);
grid.setDecorationRemover((x, z) => clearForestAt(scene, x, z));

initToolbar(city);
initHUD(city);
initNotifications(city);
initModalTriggers(city);
initDebugPanel(city);

city.on('laborStateChanged', applyLaborStateColors);

city.emit('stateChanged', city.getState());
city.emit('dayTick',      city.getState());

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
    (tool.type === 'building' && tool.buildingId === 'road')
  );
}

/** Compute drag tiles for the given tool and start/end tiles. */
function getDragTiles(tool, start, end) {
  if (tool.type === 'building' && tool.buildingId === 'road')
    return getRoadLineTiles(start, end);
  if (tool.type === 'zone')
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
let _lastHoveredTile = null;
let _selectedTile    = null;

const canvas = renderer.domElement;

// ── mousedown ─────────────────────────────────────────────────────

canvas.addEventListener('mousedown', e => {
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
    return; // suppress hover highlight during drag
  }

  // Regular hover
  grid.setHover(tile);
});

// ── mouseup ───────────────────────────────────────────────────────

canvas.addEventListener('mouseup', e => {
  // Right-click → cancel tool, suppress context menu
  if (e.button === 2) { resetTool(); return; }
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
  if (!_isDragging) grid.setHover(null);
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── Click handler ─────────────────────────────────────────────────

function _handleTileClick(tile, tool) {
  if (!tool) return;
  let result;

  if (tool.type === 'zone') {
    result = city.placeZone(tile.x, tile.z, tool.zoneType);

  } else if (tool.type === 'building') {
    result = city.placeBuilding(tile.x, tile.z, tool.buildingId);

  } else if (tool.type === 'demolish') {
    result = city.demolish(tile.x, tile.z);

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
  }

  // Refresh info panel if selected tile was in the drag
  if (_selectedTile && tiles.includes(_selectedTile)) showTileInfo(_selectedTile);
}

// ── Keyboard pan ─────────────────────────────────────────────────────────────

const _keys     = new Set();
const PAN_SPEED = 0.25;

window.addEventListener('keydown', e => _keys.add(e.code));
window.addEventListener('keyup',   e => _keys.delete(e.code));

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

function animate(ts) {
  requestAnimationFrame(animate);
  const dt = Math.min(ts - _lastTime, 200);
  _lastTime = ts;
  _handleKeyPan();
  city.tick(dt);
  render();
}

requestAnimationFrame(t => { _lastTime = t; animate(t); });
