/**
 * @module trafficLights
 * Detects road junctions, manages per-junction signal state (actuated 2-phase timer),
 * places 3-D light-pole meshes and stop-line markings, and exposes isRedFor() for cars.
 */
import * as THREE from 'three';

const TILE_H = 0.06;

// ── Timing constants (game-ms = real-ms × speedMult) ──────────────────────────
const GREEN_MS  = 3_000;   // each direction gets exactly 3 game-seconds of green
const YELLOW_MS = 1_000;   // 1 game-second of yellow between phases

// ── Mesh helpers ──────────────────────────────────────────────────────────────

function _mat(color, emissive = 0, intensity = 0) {
  return new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: intensity, roughness: 0.6,
  });
}

/**
 * Build a traffic-light pole Group.
 * The housing face points in the +Z direction by default; caller rotates the
 * whole group so it faces the approaching cars.
 * @returns {THREE.Group}
 */
function createTrafficLightMesh() {
  const g = new THREE.Group();

  // Pole
  const poleMat = _mat(0x2c2c2c);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.40, 6),
    poleMat
  );
  pole.position.y = 0.20;
  g.add(pole);

  // Housing box
  const houseMat = _mat(0x1a1a1a);
  const house = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.18, 0.058), houseMat);
  house.position.set(0, 0.46, 0);
  g.add(house);

  // Light discs — face +Z by default (toward approaching traffic once group is rotated)
  const discGeo = new THREE.CircleGeometry(0.022, 12);
  const redMat  = _mat(0xff0000, 0xff0000, 0.0);
  const yelMat  = _mat(0xffaa00, 0xffaa00, 0.0);
  const grnMat  = _mat(0x00dd55, 0x00dd55, 0.0);

  const red = new THREE.Mesh(discGeo, redMat);
  const yel = new THREE.Mesh(discGeo, yelMat);
  const grn = new THREE.Mesh(discGeo, grnMat);

  red.position.set(0, 0.53, 0.030);
  yel.position.set(0, 0.46, 0.030);
  grn.position.set(0, 0.39, 0.030);
  g.add(red, yel, grn);

  g.userData.redMat = redMat;
  g.userData.yelMat = yelMat;
  g.userData.grnMat = grnMat;

  return g;
}

/** Update the emissive intensity of the three light discs. */
function setLightSignal(group, signal) {
  // signal: 'red' | 'yellow' | 'green'
  group.userData.redMat.emissiveIntensity = signal === 'red'    ? 1.8 : 0.08;
  group.userData.yelMat.emissiveIntensity = signal === 'yellow' ? 1.8 : 0.08;
  group.userData.grnMat.emissiveIntensity = signal === 'green'  ? 1.8 : 0.08;
  // Also dim the base color of inactive lights
  group.userData.redMat.color.setHex(signal === 'red'    ? 0xff2200 : 0x551100);
  group.userData.yelMat.color.setHex(signal === 'yellow' ? 0xffaa00 : 0x553300);
  group.userData.grnMat.color.setHex(signal === 'green'  ? 0x00ee55 : 0x004422);
}

/**
 * Create a white stop-line bar mesh.
 * @param {'NS'|'EW'} axis  Road axis this line crosses.
 */
function createStopLine(axis) {
  const geo = axis === 'NS'
    ? new THREE.BoxGeometry(0.72, 0.006, 0.065)   // wide in X, thin in Z
    : new THREE.BoxGeometry(0.065, 0.006, 0.72);  // wide in Z, thin in X
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

// ── Junction ──────────────────────────────────────────────────────────────────

/**
 * Represents a single junction with a simple fixed 2-phase timer.
 * Phases:  0 = Z-axis (N+S) green  →  1 = yellow  →  2 = X-axis (E+W) green  →  3 = yellow
 */
class Junction {
  constructor(x, z, approaches) {
    this.x = x;
    this.z = z;
    this.approaches = approaches;

    // Stagger startup so nearby junctions don't all flash in sync
    this.phase      = 0;
    this.phaseTimer = (GREEN_MS * Math.random()) | 0;
  }

  /** @param {number} dtMs  Scaled (game-speed) milliseconds */
  tick(dtMs) {
    this.phaseTimer += dtMs;
    const dur = (this.phase % 2 === 1) ? YELLOW_MS : GREEN_MS;
    if (this.phaseTimer >= dur) {
      this.phaseTimer = 0;
      this.phase = (this.phase + 1) % 4;
    }
    for (const ap of this.approaches) {
      if (ap.pole) setLightSignal(ap.pole, this._signalFor(ap.dir));
    }
  }

  /** Returns 'green' | 'yellow' | 'red' for a given approach direction. */
  _signalFor(dir) {
    if (this.phase === 1 || this.phase === 3) return 'yellow';
    const nsGreen = this.phase === 0;
    const isNS    = dir === 'N' || dir === 'S';
    return (nsGreen === isNS) ? 'green' : 'red';
  }

  /** Returns true if the approach from `fromDir` is currently RED. */
  isGreen(fromDir) {
    return this._signalFor(fromDir) === 'green';
  }
}

// ── TrafficLightSystem ────────────────────────────────────────────────────────

export class TrafficLightSystem {
  constructor() {
    this._scene     = null;
    this._grid      = null;
    this._leftHand  = false;       // mirrors traffic system handedness
    this._junctions = new Map();   // "jx,jz" → Junction
    this._meshes    = [];          // all Three.js objects owned by this system
  }

  init(scene, grid) {
    this._scene = scene;
    this._grid  = grid;
    this.rebuild();
  }

  /** Mirror the traffic system's handedness setting and rebuild pole positions. */
  setHandedness(leftHand) {
    this._leftHand = leftHand;
    this.rebuild();
  }

  /** Detect junctions and build poles + stop lines. */
  rebuild() {
    this._clearMeshes();
    this._junctions.clear();
    if (!this._grid) return;

    const g = this._grid;

    for (let z = 0; z < g.size; z++) {
      for (let x = 0; x < g.size; x++) {
        const tile = g.getTile(x, z);
        if (tile?.type !== 'road' || tile.isBridge) continue;

        // Count road neighbours
        const nb = [
          { dir: 'N', nx: x,   nz: z-1 },
          { dir: 'S', nx: x,   nz: z+1 },
          { dir: 'E', nx: x+1, nz: z   },
          { dir: 'W', nx: x-1, nz: z   },
        ].filter(n => g.getTile(n.nx, n.nz)?.type === 'road');

        if (nb.length < 3) continue;   // not a junction

        // Build approaches from the neighbour list
        const approaches = [];
        for (const n of nb) {
          const ap = {
            dir:  n.dir,
            ax:   n.nx,
            az:   n.nz,
            pole: null,
            stopLine: null,
          };

          // --- Pole ---
          const pole = createTrafficLightMesh();
          const { px, pz, ry } = this._poleTransform(x, z, n.dir);
          pole.position.set(px, TILE_H / 2, pz);
          pole.rotation.y = ry;
          setLightSignal(pole, 'red');  // initial state
          this._scene.add(pole);
          this._meshes.push(pole);
          ap.pole = pole;

          // --- Stop line ---
          const axis = (n.dir === 'N' || n.dir === 'S') ? 'NS' : 'EW';
          const sl   = createStopLine(axis);
          const { slx, slz } = this._stopLinePos(x, z, n.dir);
          sl.position.set(slx, TILE_H / 2 + 0.003, slz);
          this._scene.add(sl);
          this._meshes.push(sl);
          ap.stopLine = sl;

          approaches.push(ap);
        }

        const junction = new Junction(x, z, approaches);
        this._junctions.set(`${x},${z}`, junction);
      }
    }
  }

  /**
   * World position and Y-rotation for a traffic light pole.
   * The pole sits on the right-hand side of the road (from the driver's perspective)
   * at the near-junction edge of the approach tile.
   * @param {number} jx @param {number} jz  Junction tile coords
   * @param {'N'|'S'|'E'|'W'} dir  The approach direction
   */
  _poleTransform(jx, jz, dir) {
    // In right-hand traffic laneX = -dirZ*off, laneZ = dirX*off, so:
    //   southbound (dirZ=+1): laneX = -0.13  → west side  → right = west
    //   northbound (dirZ=-1): laneX = +0.13  → east side  → right = east
    //   westbound  (dirX=-1): laneZ = -0.13  → north side → right = north
    //   eastbound  (dirX=+1): laneZ = +0.13  → south side → right = south
    // Left-hand traffic mirrors each pair.
    const lh = this._leftHand;
    switch (dir) {
      // N approach: driver going south. RHT right = west (low X);  LHT right = east (high X).
      case 'N': return { px: lh ? jx + 0.88 : jx + 0.12, pz: jz - 0.10, ry: Math.PI };
      // S approach: driver going north. RHT right = east (high X); LHT right = west (low X).
      case 'S': return { px: lh ? jx + 0.12 : jx + 0.88, pz: jz + 1.10, ry: 0 };
      // E approach: driver going west.  RHT right = north (low Z); LHT right = south (high Z).
      case 'E': return { px: jx + 1.10, pz: lh ? jz + 0.88 : jz + 0.12, ry: Math.PI / 2 };
      // W approach: driver going east.  RHT right = south (high Z); LHT right = north (low Z).
      case 'W': return { px: jx - 0.10, pz: lh ? jz + 0.12 : jz + 0.88, ry: -Math.PI / 2 };
    }
  }

  /**
   * World position of the centre of the stop-line bar.
   * Placed 10% into the approach tile from the junction boundary.
   */
  _stopLinePos(jx, jz, dir) {
    switch (dir) {
      case 'N': return { slx: jx + 0.50, slz: jz - 0.11 };
      case 'S': return { slx: jx + 0.50, slz: jz + 1.11 };
      case 'E': return { slx: jx + 1.11, slz: jz + 0.50 };
      case 'W': return { slx: jx - 0.11, slz: jz + 0.50 };
    }
  }

  /**
   * @param {number} dt        Real milliseconds
   * @param {number} speedMult Game speed multiplier (0 = paused)
   */
  tick(dt, speedMult) {
    if (speedMult === 0) return;
    const dtGame = dt * speedMult;
    for (const junction of this._junctions.values()) {
      junction.tick(dtGame);
    }
  }

  /**
   * Returns true if a car moving from `fromTile` → `toTile` faces a RED light.
   * `toTile` must be the junction tile.
   */
  isRedFor(fromTile, toTile) {
    const key = `${toTile.x},${toTile.z}`;
    const junc = this._junctions.get(key);
    if (!junc) return false;

    const dx = toTile.x - fromTile.x;
    const dz = toTile.z - fromTile.z;

    // Determine which side the car is approaching from
    let dir;
    if      (dz === -1) dir = 'S';  // car moving north  (-Z), came from south
    else if (dz ===  1) dir = 'N';  // car moving south  (+Z), came from north
    else if (dx === -1) dir = 'E';  // car moving west   (-X), came from east
    else if (dx ===  1) dir = 'W';  // car moving east   (+X), came from west
    else return false;

    return !junc.isGreen(dir);
  }

  /** Remove all owned meshes from the scene. */
  _clearMeshes() {
    for (const m of this._meshes) {
      this._scene?.remove(m);
      m.traverse(o => {
        if (o.isMesh) {
          o.geometry?.dispose();
          if (Array.isArray(o.material)) o.material.forEach(mat => mat.dispose());
          else o.material?.dispose();
        }
      });
    }
    this._meshes = [];
  }

  /** Returns true when there is a managed junction at tile coordinates (x, z). */
  isJunction(x, z) { return this._junctions.has(`${x},${z}`); }

  clear() { this._clearMeshes(); this._junctions.clear(); }
}
