/**
 * @module roadGraph
 * Builds an adjacency graph from road tiles and provides A* pathfinding.
 */

/**
 * Build adjacency graph from all road tiles in the grid.
 * @param {import('../grid.js').Grid} grid
 * @returns {Map<string, Array<{x:number,z:number}>>}
 */
export function buildRoadGraph(grid) {
  const graph = new Map();
  for (let z = 0; z < grid.size; z++) {
    for (let x = 0; x < grid.size; x++) {
      const tile = grid.getTile(x, z);
      if (!tile || tile.type !== 'road') continue;
      const key = `${x},${z}`;
      const neighbors = [];
      for (const [dx, dz] of [[0,-1],[0,1],[1,0],[-1,0]]) {
        const nb = grid.getTile(x+dx, z+dz);
        if (nb && nb.type === 'road') neighbors.push({ x: x+dx, z: z+dz });
      }
      graph.set(key, neighbors);
    }
  }
  return graph;
}

/**
 * A* pathfinding between two road tiles.
 * @param {Map} graph - from buildRoadGraph
 * @param {{x:number,z:number}} start
 * @param {{x:number,z:number}} goal
 * @returns {Array<{x:number,z:number}>|null} path including start and goal, or null
 */
export function astar(graph, start, goal) {
  const key = t => `${t.x},${t.z}`;
  const h   = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

  const startKey = key(start);
  const goalKey  = key(goal);
  if (startKey === goalKey) return [start];

  const openSet  = new Set([startKey]);
  const cameFrom = new Map();
  const gScore   = new Map([[startKey, 0]]);
  const fScore   = new Map([[startKey, h(start, goal)]]);

  while (openSet.size > 0) {
    let current = null, lowestF = Infinity;
    for (const k of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < lowestF) { lowestF = f; current = k; }
    }

    if (current === goalKey) {
      const path = [];
      let c = current;
      while (c) {
        const [cx, cz] = c.split(',').map(Number);
        path.unshift({ x: cx, z: cz });
        c = cameFrom.get(c);
      }
      return path;
    }

    openSet.delete(current);
    const [cx, cz] = current.split(',').map(Number);
    for (const nb of (graph.get(current) ?? [])) {
      const nk = key(nb);
      const tentG = (gScore.get(current) ?? Infinity) + 1;
      if (tentG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, current);
        gScore.set(nk, tentG);
        fScore.set(nk, tentG + h(nb, goal));
        openSet.add(nk);
      }
    }
  }
  return null;
}

/**
 * Find all road tiles adjacent to a building's footprint.
 * @param {import('../grid.js').Grid} grid
 * @param {{ tileX:number, tileZ:number, def:{ size:number|number[] } }} building
 * @returns {Array<{x:number,z:number}>}
 */
export function findBuildingEntrances(grid, building) {
  const size = building.def?.size ?? 1;
  const [w, d] = Array.isArray(size) ? size : [size, size];
  const ax = building.tileX, az = building.tileZ;
  // Footprint: x in [ax, ax+w-1], z in [az-d+1, az]
  const footprint = new Set();
  for (let dx = 0; dx < w; dx++)
    for (let dz = 0; dz < d; dz++)
      footprint.add(`${ax+dx},${az-dz}`);

  const entrances = [];
  const seen = new Set();
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const fx = ax + dx, fz = az - dz;
      for (const [ox, oz] of [[0,-1],[0,1],[1,0],[-1,0]]) {
        const nx = fx+ox, nz = fz+oz;
        const k = `${nx},${nz}`;
        if (seen.has(k) || footprint.has(k)) continue;
        seen.add(k);
        const t = grid.getTile(nx, nz);
        if (t && t.type === 'road') entrances.push({ x: nx, z: nz });
      }
    }
  }
  return entrances;
}
