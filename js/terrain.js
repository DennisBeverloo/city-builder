/**
 * @module terrain
 * Procedural landscape generation: river and forest clusters.
 * Works by marking tiles in the Grid and adding decorative Three.js objects.
 */
import * as THREE from 'three';

// Shared geometries for decoration meshes
const _trunkGeo  = new THREE.CylinderGeometry(0.06, 0.08, 0.35, 6);
const _crownGeo  = new THREE.ConeGeometry(0.22, 0.45, 6);
const _trunkMat  = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
const _crownMat  = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });

/** Map from "x_z" tile key → array of scene objects (trunk + crown). */
const _treeObjects = new Map();

/**
 * Generate the initial landscape. Marks tiles as terrain and adds meshes.
 * @param {import('./grid.js').Grid} grid
 * @param {THREE.Scene} scene
 */
export function generateTerrain(grid, scene) {
  _generateRiver(grid);
  _generateForest(grid, scene, 6,  6,  6);   // north-west cluster
  _generateForest(grid, scene, 30, 28, 5);   // south-east cluster
  _generateForest(grid, scene, 4,  30, 4);   // south-west cluster
}

/**
 * Remove any tree meshes on the given forest tile from the scene.
 * Called when the player builds over a forest tile.
 * @param {THREE.Scene} scene
 * @param {number} x
 * @param {number} z
 */
export function clearForestAt(scene, x, z) {
  const key = `${x}_${z}`;
  const objs = _treeObjects.get(key);
  if (objs) {
    for (const obj of objs) scene.remove(obj);
    _treeObjects.delete(key);
  }
}

/**
 * Draw a diagonal river strip from (0, 8) to (39, 28) roughly 2 tiles wide.
 * @param {import('./grid.js').Grid} grid
 */
function _generateRiver(grid) {
  const size  = grid.size;
  // Parametric line: z = 8 + (x / size) * 20
  for (let x = 0; x < size; x++) {
    const midZ = Math.round(8 + (x / (size - 1)) * 20);
    for (let dz = -1; dz <= 1; dz++) {
      const z = midZ + dz;
      if (z < 0 || z >= size) continue;
      // Narrow the river slightly at the edges for realism
      if (Math.abs(dz) === 1 && (x < 3 || x > size - 4)) continue;
      grid.setTileTerrain(x, z, 'river');
    }
  }
}

/**
 * Generate a roughly circular forest cluster.
 * @param {import('./grid.js').Grid} grid
 * @param {THREE.Scene} scene
 * @param {number} cx  Centre tile x
 * @param {number} cz  Centre tile z
 * @param {number} radius
 */
function _generateForest(grid, scene, cx, cz, radius) {
  const size = grid.size;
  for (let z = cz - radius; z <= cz + radius; z++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || x >= size || z < 0 || z >= size) continue;
      const dist = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
      // Irregular boundary using noise-like offset
      const edge = radius - 0.5 + ((x * 13 + z * 7) % 3) * 0.4;
      if (dist > edge) continue;

      const tile = grid.getTile(x, z);
      if (!tile || tile.type === 'river') continue;
      grid.setTileTerrain(x, z, 'forest');

      // Add a tree mesh on ~60% of forest tiles
      if ((x + z * 3) % 5 !== 0) {
        _addTree(scene, x, z);
      }
    }
  }
}

/**
 * Add a simple 3-D tree (trunk + cone crown) on the given tile.
 * Tracked in _treeObjects so it can be removed when built over.
 * @param {THREE.Scene} scene @param {number} tileX @param {number} tileZ
 */
function _addTree(scene, tileX, tileZ) {
  const wx = tileX + 0.5 + (Math.random() * 0.3 - 0.15);
  const wz = tileZ + 0.5 + (Math.random() * 0.3 - 0.15);

  const trunk = new THREE.Mesh(_trunkGeo, _trunkMat);
  trunk.position.set(wx, 0.06 + 0.175, wz);
  trunk.castShadow    = true;
  trunk.receiveShadow = true;
  scene.add(trunk);

  const crown = new THREE.Mesh(_crownGeo, _crownMat);
  crown.position.set(wx, 0.06 + 0.35 + 0.225, wz);
  crown.castShadow    = true;
  crown.receiveShadow = true;
  scene.add(crown);

  const key = `${tileX}_${tileZ}`;
  if (!_treeObjects.has(key)) _treeObjects.set(key, []);
  _treeObjects.get(key).push(trunk, crown);
}

