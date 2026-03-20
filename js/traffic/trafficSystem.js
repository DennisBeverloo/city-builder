/**
 * @module trafficSystem
 * Manages car spawning, routing, movement, and despawning.
 * Integrates with city simulation via hourTick events.
 */
import * as THREE from 'three';
import { buildRoadGraph, astar, findBuildingEntrances } from './roadGraph.js';
import {
  createSedan, createHatchback, createPickup, createSports,
  createTruck, createPoliceCar, createSchoolBus,
  updateCarLights, updatePoliceBar, randomCarColor,
} from './carModels.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Base speed in tiles per second at 1× game speed. */
const BASE_SPEED = 2.0;

/** Lane offset from tile centre (right-hand side). */
const LANE_OFFSET = 0.13;

/** Y position of car bottom (just above road surface). */
const CAR_Y_OFFSET = 0.072;

/** Maximum simultaneous active cars. */
const MAX_CARS = 150;

/** Parked duration range [min, max] in real milliseconds. */
const PARK_MS = [600, 1200];

/** Police patrol random walk length (tiles). */
const PATROL_LENGTH = 25;

// Spawn rate multiplier by hour (0-23), 0 = no spawning, 1 = peak
const HOUR_SPAWN_RATE = [
  0.02, 0.01, 0.01, 0.01, 0.02, 0.08,  // 00-05: night → early morning
  0.30, 0.90, 1.00, 0.55, 0.35, 0.30,  // 06-11: morning rush
  0.55, 0.35, 0.30, 0.35, 0.45, 0.95,  // 12-17: lunch, afternoon, evening rush start
  1.00, 0.65, 0.40, 0.25, 0.12, 0.05,  // 18-23: evening rush peak, wind-down
];

// Which direction traffic flows each hour
// 'out'=R→work, 'in'=work→R, 'leisure'=R→services, 'supply'=I→C, 'mixed'
const HOUR_TRAFFIC_TYPE = [
  'mixed','mixed','mixed','mixed','mixed','mixed',   // 00-05
  'out','out','out','supply','supply','leisure',      // 06-11
  'leisure','supply','supply','supply','out','in',    // 12-17
  'in','in','leisure','leisure','mixed','mixed',      // 18-23
];

// Personal car variants
const PERSONAL_VARIANTS = ['sedan','hatchback','pickup','sports'];

// ── Car class ─────────────────────────────────────────────────────────────────

/** Real-milliseconds a car may be blocked by another car before despawning.
 *  Does NOT apply when waiting at a red light (those cars wait indefinitely). */
const MAX_WAIT_MS = 7_000;

class Car {
  constructor(mesh, route, type, id) {
    this.id        = id;
    this.mesh      = mesh;
    this.route     = route;   // Array<{x,z}>
    this.routeIdx  = 0;
    this.progress  = 0;       // 0–1 within current segment
    this.state     = 'driving'; // 'driving'|'waiting'|'parked'|'done'
    this.parkTimer = 0;
    this.waitTimer = 0;       // real-ms spent waiting; despawn if exceeds MAX_WAIT_MS
    this.speed     = 0;      // 0–1 speed multiplier; eases in from rest
    this.lastDirX  = 1;      // last non-zero travel direction (for lane offset at final tile)
    this.lastDirZ  = 0;
    this.type      = type;    // 'personal'|'truck'|'police'
    this.elapsedMs = Math.random() * 1000; // stagger police flash
  }

  get currentTile()  { return this.route[this.routeIdx]; }
  get nextTile()     { return this.route[Math.min(this.routeIdx + 1, this.route.length - 1)]; }
}

// ── TrafficSystem ─────────────────────────────────────────────────────────────

export class TrafficSystem {
  constructor() {
    this._scene      = null;
    this._grid       = null;
    this._graph      = null;  // Map<string, {x,z}[]>
    this._cars       = [];
    this._nextId     = 0;
    this._leftHand   = false; // false = right-hand traffic (default)
    this._spawnAccum  = 0;     // accumulates fractional spawn debt
    this._busAccum    = 0;     // school bus spawn accumulator
    this._trafficLights = null;  // TrafficLightSystem reference
    this._lastIsNight = null;
  }

  /**
   * @param {THREE.Scene} scene
   * @param {import('../grid.js').Grid} grid
   * @param {boolean} [leftHand=false]
   */
  init(scene, grid, leftHand = false) {
    this._scene    = scene;
    this._grid     = grid;
    this._leftHand = leftHand;
    this.rebuild();
  }

  /** Rebuild road graph after road changes. */
  rebuild() {
    if (!this._grid) return;
    this._graph = buildRoadGraph(this._grid);
    // Remove cars whose routes are now invalid
    for (const car of this._cars) {
      if (!car.route.every(t => this._graph.has(`${t.x},${t.z}`))) {
        this._removeCar(car);
      }
    }
    this._cars = this._cars.filter(c => c.state !== 'done');
  }

  /** Set left/right hand traffic. Affects lane offset direction. */
  setHandedness(leftHand) {
    this._leftHand = leftHand;
  }

  /** Wire up the traffic light system so cars can check red lights. */
  setTrafficLights(tl) {
    this._trafficLights = tl;
  }

  /**
   * Called every animation frame.
   * @param {number} dt - real milliseconds since last frame
   * @param {number} gameHour - 0-23
   * @param {number} speedMult - game speed multiplier (0=paused, 1=1×, 4=4×, etc.)
   * @param {object} cityState - city.getState()
   */
  tick(dt, gameHour, speedMult, cityState) {
    if (speedMult === 0) return; // paused

    const carSpeed   = BASE_SPEED * speedMult; // tiles/sec
    const isNight        = gameHour < 6 || gameHour >= 20;
    const isNightChanged = isNight !== this._lastIsNight;
    if (isNightChanged) this._lastIsNight = isNight;
    const elapsed    = dt * speedMult;         // scaled elapsed for police lights

    // Try to spawn cars based on hour demand
    this._trySpawn(dt, gameHour, speedMult, cityState);
    this._trySpawnBus(dt, gameHour, speedMult, cityState);

    // Update all active cars
    for (const car of this._cars) {
      if (car.state === 'done') continue;
      car.elapsedMs += elapsed;

      if (car.type === 'police') updatePoliceBar(car.mesh, car.elapsedMs);
      if (isNightChanged) updateCarLights(car.mesh, isNight);

      if (car.state === 'parked') {
        car.parkTimer -= dt;
        if (car.parkTimer <= 0) this._removeCar(car);
        continue;
      }

      // Compute once per frame — _isBlocked is O(n) in car count
      const blocked = this._isBlocked(car);

      if (car.state === 'waiting') {
        const ni = car.routeIdx + 1;
        const atRedLight = ni < car.route.length &&
          !!this._trafficLights?.isRedFor(car.route[car.routeIdx], car.route[ni]);

        if (atRedLight) {
          // Waiting at a red light — hold forever, no despawn
          car.speed = 0; continue;
        }
        if (blocked) {
          // Blocked by the car in front — despawn after 7 real seconds
          car.waitTimer += dt;
          if (car.waitTimer > MAX_WAIT_MS) { this._removeCar(car); continue; }
          car.speed = 0; continue;
        }
        // Nothing blocking — resume
        car.state = 'driving'; car.waitTimer = 0;
      }

      // ── Traffic light gate — lead car only (no car directly in front) ──────
      if (this._trafficLights && !blocked) {
        const ni = car.routeIdx + 1;
        if (ni < car.route.length &&
            this._trafficLights.isRedFor(car.route[car.routeIdx], car.route[ni])) {
          // Brake and hold at stop line
          car.speed = Math.max(0, car.speed - 3.6 * dt / 1000);
          if (car.progress > 0.40) car.progress = 0.40;
          this._updateCarTransform(car);
          continue;
        }
      }

      const carBlocked = blocked;
      if (carBlocked) {
        // Car-to-car block: brake and enter waiting state when fully stopped
        car.speed = Math.max(0, car.speed - 1.8 * dt / 1000);
        if (car.speed <= 0) { car.state = 'waiting'; car.waitTimer = 0; continue; }
      } else {
        // Free to move: accelerate and apply destination-approach speed cap
        car.speed = Math.min(1.0, car.speed + 1.8 * dt / 1000);
        const destDist = (car.route.length - 1 - car.routeIdx) + (1.0 - car.progress);
        if (destDist < 0.9) {
          // Floor at 0.05 so the car always crosses progress=1.0 and parks.
          // Without this, speed→0 asymptotically and the car freezes mid-road.
          car.speed = Math.min(car.speed, Math.max(0.05, destDist / 0.9));
        }
      }

      // Advance position at current speed
      const advance = (carSpeed * car.speed / 1000) * dt;
      car.progress += advance;

      while (car.progress >= 1.0 && car.routeIdx < car.route.length - 1) {
        // Safety net: never advance into a red-light junction
        if (this._trafficLights?.isRedFor(car.route[car.routeIdx], car.route[car.routeIdx + 1])) {
          car.progress = 0.40; car.speed = 0; break;
        }

        car.progress -= 1.0;
        car.routeIdx++;
        // School bus: check for a planned stop at the new tile
        if (car.type === 'bus' && car._busStopKeys) {
          const cur = car.route[car.routeIdx];
          const k   = `${cur.x},${cur.z}`;
          if (car._busStopKeys.has(k) && !car._visitedStops.has(k)) {
            car._visitedStops.add(k);
            car._busStopTimer = 2500 + Math.random() * 2000; // 2.5–4.5 s stop
          }
        }
      }

      if (car.routeIdx >= car.route.length - 1 && car.progress >= 1.0) {
        // Arrived at destination
        car.state = 'parked';
        car.mesh.visible = false;
        // Buses stop longer to pick up / drop off
        car.parkTimer = car._busParkMs ?? (PARK_MS[0] + Math.random() * (PARK_MS[1] - PARK_MS[0]));
        continue;
      }

      // Bus stop: hold position while timer counts down
      if (car.type === 'bus' && car._busStopTimer > 0) {
        car._busStopTimer -= dt;
        car.speed = Math.max(0, car.speed - 2.5 * dt / 1000);
        if (car._busStopTimer > 0) { this._updateCarTransform(car); continue; }
      }

      this._updateCarTransform(car);
    }

    // Purge done cars
    this._cars = this._cars.filter(c => c.state !== 'done');
  }

  // ── Spawning ───────────────────────────────────────────────────────

  _trySpawn(dt, gameHour, speedMult, cityState) {
    if (this._cars.length >= MAX_CARS) return;
    if (!cityState || cityState.population < 5) return;

    const rate = HOUR_SPAWN_RATE[gameHour] ?? 0.1;
    // Spawn rate: up to N cars per second of real time, scaled by population and demand
    const carsPerSec = rate * Math.min(cityState.population / 30, 3.0) * speedMult * 0.8;
    this._spawnAccum += carsPerSec * (dt / 1000);

    while (this._spawnAccum >= 1 && this._cars.length < MAX_CARS) {
      this._spawnAccum -= 1;
      const type = HOUR_TRAFFIC_TYPE[gameHour] ?? 'mixed';
      this._spawnOne(type, cityState);
    }
  }

  _spawnOne(trafficType, cityState) {
    const stats = this._grid.getStats();
    const allB  = stats.allBuildings;

    let origin = null, dest = null, carType = 'personal';

    if (trafficType === 'supply' && Math.random() < 0.4) {
      // Truck: I → C
      const industrial  = allB.filter(b => b.def?.zoneType === 'I');
      const commercial  = allB.filter(b => b.def?.zoneType === 'C');
      if (industrial.length && commercial.length) {
        origin  = industrial[Math.floor(Math.random() * industrial.length)];
        dest    = commercial[Math.floor(Math.random() * commercial.length)];
        carType = 'truck';
      }
    } else if (trafficType === 'out') {
      // Commuter: R → C or I
      const residential = allB.filter(b => b.def?.zoneType === 'R');
      const workplaces  = allB.filter(b => b.def?.zoneType === 'C' || b.def?.zoneType === 'I');
      if (residential.length && workplaces.length) {
        origin = residential[Math.floor(Math.random() * residential.length)];
        dest   = workplaces[Math.floor(Math.random() * workplaces.length)];
      }
    } else if (trafficType === 'in') {
      // Return: C/I → R
      const residential = allB.filter(b => b.def?.zoneType === 'R');
      const workplaces  = allB.filter(b => b.def?.zoneType === 'C' || b.def?.zoneType === 'I');
      if (residential.length && workplaces.length) {
        dest   = residential[Math.floor(Math.random() * residential.length)];
        origin = workplaces[Math.floor(Math.random() * workplaces.length)];
      }
    } else if (trafficType === 'leisure') {
      // R → services
      const residential = allB.filter(b => b.def?.zoneType === 'R');
      const services    = allB.filter(b => b.def?.category === 'service');
      if (residential.length && services.length) {
        origin = residential[Math.floor(Math.random() * residential.length)];
        dest   = services[Math.floor(Math.random() * services.length)];
      }
    } else {
      // Mixed: random building to random building
      if (allB.length >= 2) {
        origin = allB[Math.floor(Math.random() * allB.length)];
        dest   = allB[Math.floor(Math.random() * allB.length)];
      }
    }

    // Police patrol: random chance each spawn
    const hasPolice = allB.some(b => b.id === 'police_station');
    if (hasPolice && Math.random() < 0.18 && carType !== 'truck') {
      this._spawnPolice(allB);
      return;
    }

    if (!origin || !dest || origin === dest) return;

    // Find road entrances for each building
    const originEntrances = findBuildingEntrances(this._grid, origin);
    const destEntrances   = findBuildingEntrances(this._grid, dest);
    if (!originEntrances.length || !destEntrances.length) return;

    const startTile = originEntrances[Math.floor(Math.random() * originEntrances.length)];
    const endTile   = destEntrances[Math.floor(Math.random() * destEntrances.length)];

    const route = astar(this._graph, startTile, endTile);
    if (!route || route.length < 2) return;

    this._createCar(carType, route);
  }

  _spawnPolice(allBuildings) {
    const stations = allBuildings.filter(b => b.id === 'police_station');
    if (!stations.length) return;
    const station  = stations[Math.floor(Math.random() * stations.length)];
    const entrances = findBuildingEntrances(this._grid, station);

    // Pick a starting road tile: prefer station entrance, fall back to any road node
    let start;
    if (entrances.length) {
      start = entrances[Math.floor(Math.random() * entrances.length)];
    } else {
      const nodes = [...this._graph.keys()];
      if (!nodes.length) return;
      const k = nodes[Math.floor(Math.random() * nodes.length)];
      const [x, z] = k.split(',').map(Number);
      start = { x, z };
    }

    // Build a patrol route: random walk of PATROL_LENGTH steps, then return
    let patrol = this._buildPatrolRoute(start, PATROL_LENGTH);

    // If the start tile is a dead-end with no neighbours, try a random road node instead
    if (!patrol || patrol.length < 2) {
      const nodes = [...this._graph.keys()];
      if (!nodes.length) return;
      const k = nodes[Math.floor(Math.random() * nodes.length)];
      const [x, z] = k.split(',').map(Number);
      patrol = this._buildPatrolRoute({ x, z }, PATROL_LENGTH);
    }

    if (!patrol || patrol.length < 2) return;
    this._createCar('police', patrol);
  }

  _buildPatrolRoute(start, steps) {
    const visited = [start];
    let current = start;
    const key = t => `${t.x},${t.z}`;

    for (let i = 0; i < steps; i++) {
      const neighbors = this._graph.get(key(current)) ?? [];
      if (!neighbors.length) break;
      // Prefer unvisited, but allow revisit if needed
      const unvisited = neighbors.filter(n => !visited.some(v => v.x === n.x && v.z === n.z));
      const choices   = unvisited.length ? unvisited : neighbors;
      current = choices[Math.floor(Math.random() * choices.length)];
      visited.push(current);
    }

    // Return path back to start
    const returnPath = astar(this._graph, current, start);
    if (!returnPath) return visited;
    return [...visited, ...returnPath.slice(1)];
  }

  _trySpawnBus(dt, gameHour, speedMult, cityState) {
    if (speedMult === 0) return;
    // School bus hours: 7–9 morning and 14–16 afternoon
    const isBusHour = (gameHour >= 7 && gameHour <= 9) || (gameHour >= 14 && gameHour <= 16);
    if (!isBusHour) return;
    if (!cityState || cityState.population < 10) return;
    // 1 bus every ~20 real seconds during school hours (very occasional)
    const busRate = 0.05 * speedMult;
    this._busAccum += busRate * (dt / 1000);
    while (this._busAccum >= 1) {
      this._busAccum -= 1;
      this._spawnBus();
    }
  }

  _spawnBus() {
    const stats = this._grid.getStats();
    const allB  = stats.allBuildings;
    const schools = allB.filter(b => b.id === 'primary_school' || b.id === 'high_school');
    if (!schools.length) return;
    const school = schools[Math.floor(Math.random() * schools.length)];
    const schoolEntrances = findBuildingEntrances(this._grid, school);
    if (!schoolEntrances.length) return;
    const schoolStop = schoolEntrances[Math.floor(Math.random() * schoolEntrances.length)];

    const residential = allB.filter(b => b.def?.zoneType === 'R');
    if (residential.length < 2) return;

    // Pick 3–5 distinct R stops
    const numStops = 3 + Math.floor(Math.random() * 3);
    const rStops = [];
    const usedIdx = new Set();
    for (let attempt = 0; rStops.length < numStops && attempt < numStops * 4; attempt++) {
      const idx = Math.floor(Math.random() * residential.length);
      if (usedIdx.has(idx)) continue;
      usedIdx.add(idx);
      const ent = findBuildingEntrances(this._grid, residential[idx]);
      if (ent.length) rStops.push(ent[0]);
    }
    if (!rStops.length) return;

    // Build concatenated route: school → r1 → r2 → … → school
    const fullRoute = [];
    const stopKeys  = new Set();
    let from = schoolStop;
    for (const to of rStops) {
      const seg = astar(this._graph, from, to);
      if (!seg || seg.length < 2) continue;
      const base = fullRoute.length ? seg.slice(1) : seg;
      fullRoute.push(...base);
      stopKeys.add(`${to.x},${to.z}`);
      from = to;
    }
    // Return to school
    const ret = astar(this._graph, from, schoolStop);
    if (ret && ret.length > 1) fullRoute.push(...ret.slice(1));
    if (fullRoute.length < 2) return;

    const mesh = createSchoolBus();
    mesh.castShadow = true;
    this._scene.add(mesh);

    const car           = new Car(mesh, fullRoute, 'bus', this._nextId++);
    car._busStopKeys    = stopKeys;   // Set<"x,z"> of planned stop tiles
    car._busStopTimer   = 0;          // countdown ms remaining at current stop
    car._visitedStops   = new Set();  // prevent re-stopping at same tile
    mesh.userData.car = car;          // back-reference for debug raycasting
    this._updateCarTransform(car);
    updateCarLights(mesh, this._lastIsNight ?? false);
    this._cars.push(car);
  }

  // ── Car creation / removal ─────────────────────────────────────────

  _createCar(carType, route) {
    let mesh;
    if (carType === 'truck') {
      mesh = createTruck();
    } else if (carType === 'police') {
      mesh = createPoliceCar();
    } else {
      const variant = PERSONAL_VARIANTS[Math.floor(Math.random() * PERSONAL_VARIANTS.length)];
      const color   = randomCarColor();
      switch (variant) {
        case 'hatchback': mesh = createHatchback(color); break;
        case 'pickup':    mesh = createPickup(color);    break;
        case 'sports':    mesh = createSports(color);    break;
        default:          mesh = createSedan(color);     break;
      }
    }

    mesh.castShadow    = true;
    mesh.receiveShadow = false;
    this._scene.add(mesh);

    const car = new Car(mesh, route, carType, this._nextId++);
    mesh.userData.car = car; // back-reference for debug raycasting
    this._updateCarTransform(car);
    updateCarLights(mesh, this._lastIsNight ?? false);
    this._cars.push(car);
  }

  _removeCar(car) {
    this._scene.remove(car.mesh);
    // Dispose geometries and materials
    car.mesh.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material?.dispose();
      }
    });
    car.state = 'done';
  }

  // ── Movement ──────────────────────────────────────────────────────

  _updateCarTransform(car) {
    const from = car.route[car.routeIdx];
    const to   = car.route[Math.min(car.routeIdx + 1, car.route.length - 1)];

    let dirX = to.x - from.x;
    let dirZ = to.z - from.z;
    // At the final waypoint from===to, preserve last known direction so the car
    // stays in its lane rather than snapping to the tile centre.
    if (dirX === 0 && dirZ === 0) {
      dirX = car.lastDirX;
      dirZ = car.lastDirZ;
    } else {
      car.lastDirX = dirX;
      car.lastDirZ = dirZ;
    }

    // World positions (tile centre = x+0.5, z+0.5)
    const fx = from.x + 0.5, fz = from.z + 0.5;
    const tx = to.x   + 0.5, tz = to.z   + 0.5;

    const px = fx + (tx - fx) * car.progress;
    const pz = fz + (tz - fz) * car.progress;

    // Lane offset: right of direction of travel
    // right = (-dirZ, dirX) in XZ when dirX/Z are unit cardinal
    const sign   = this._leftHand ? -1 : 1;
    // On the last route tile, glide toward the curb as the car slows to park
    let parkDrift = 0;
    if (car.routeIdx >= car.route.length - 1) {
      parkDrift = Math.min(1, Math.max(0, (car.progress - 0.55) / 0.45));
    }
    const effectiveLane = LANE_OFFSET + parkDrift * (0.34 - LANE_OFFSET);
    const laneX  = -dirZ * effectiveLane * sign;
    const laneZ  =  dirX * effectiveLane * sign;

    car.mesh.position.set(px + laneX, CAR_Y_OFFSET, pz + laneZ);

    // Face direction of travel; car model faces +X by default
    if (dirX !== 0 || dirZ !== 0) {
      car.mesh.rotation.y = Math.atan2(-dirZ, dirX);
    }
  }

  _isBlocked(car) {
    if (car.route.length < 2) return false;
    const from = car.route[car.routeIdx];
    const to   = car.route[Math.min(car.routeIdx + 1, car.route.length - 1)];
    const dirX = to.x - from.x;
    const dirZ = to.z - from.z;

    for (const other of this._cars) {
      if (other === car || other.state === 'parked' || other.state === 'done') continue;

      const dx   = other.mesh.position.x - car.mesh.position.x;
      const dz   = other.mesh.position.z - car.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 1.2 || dist < 0.01) continue;

      // Skip cars not travelling in roughly the same direction.
      // dot product <= 0 means opposite or perpendicular — a crossing car should
      // never block you; only a car ahead in your own lane counts.
      const otherFrom = other.route[other.routeIdx];
      const otherTo   = other.route[Math.min(other.routeIdx + 1, other.route.length - 1)];
      const odX = otherTo.x - otherFrom.x;
      const odZ = otherTo.z - otherFrom.z;
      if (dirX * odX + dirZ * odZ <= 0) continue; // opposite or perpendicular — ignore

      // The other car must be clearly ahead (not beside) and in roughly the same lane
      const dot       = dx * dirX + dz * dirZ;
      const perpX     = dx - dot * dirX;
      const perpZ     = dz - dot * dirZ;
      const lateralDist = Math.sqrt(perpX * perpX + perpZ * perpZ);
      if (dot > 0.25 && lateralDist < 0.30) return true;
    }
    return false;
  }

  /** Remove all cars (e.g., on game reset/load). */
  clear() {
    for (const car of this._cars) this._removeCar(car);
    this._cars = [];
  }

  get activeCarCount() { return this._cars.length; }

  /** Returns the live car array (for traffic light demand counting). */
  getCars() { return this._cars; }
}
