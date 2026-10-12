/** Plain A* on a boolean obstacle grid, 4-neighbour moves. No caching. */

export interface Tile {
  x: number;
  z: number;
}

/** grid[z][x] === true means blocked. */
export type ObstacleGrid = boolean[][];

export function isWalkable(grid: ObstacleGrid, x: number, z: number): boolean {
  const row = grid[z];
  if (!row) return false;
  return row[x] === false;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Returns the tiles to step through, excluding start and including goal.
 * An empty array means start === goal. null means unreachable.
 */
export function findPath(grid: ObstacleGrid, start: Tile, goal: Tile): Tile[] | null {
  if (start.x === goal.x && start.z === goal.z) return [];
  const depth = grid.length;
  const width = grid[0]?.length ?? 0;
  if (!isWalkable(grid, goal.x, goal.z)) return null;
  const key = (x: number, z: number) => z * width + x;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open: { k: number; f: number }[] = [];
  const h = (x: number, z: number) => Math.abs(x - goal.x) + Math.abs(z - goal.z);
  const startKey = key(start.x, start.z);
  const goalKey = key(goal.x, goal.z);
  gScore.set(startKey, 0);
  open.push({ k: startKey, f: h(start.x, start.z) });

  while (open.length > 0) {
    // Linear min scan: the grid is 40x30, so this is cheap enough.
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i];
      const b = open[bi];
      if (a && b && a.f < b.f) bi = i;
    }
    const current = open.splice(bi, 1)[0];
    if (!current) break;
    if (current.k === goalKey) {
      const path: Tile[] = [];
      let k = current.k;
      while (k !== startKey) {
        path.push({ x: k % width, z: Math.floor(k / width) });
        const prev = cameFrom.get(k);
        if (prev === undefined) break;
        k = prev;
      }
      path.reverse();
      return path;
    }
    if (closed.has(current.k)) continue;
    closed.add(current.k);
    const cx = current.k % width;
    const cz = Math.floor(current.k / width);
    const cg = gScore.get(current.k) ?? Infinity;
    for (const [dx, dz] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= depth) continue;
      if (!isWalkable(grid, nx, nz)) continue;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      const tentative = cg + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentative);
        cameFrom.set(nk, current.k);
        open.push({ k: nk, f: tentative + h(nx, nz) });
      }
    }
  }
  return null;
}

/** Breadth-first flood from a tile; returns the set of reachable keys "x,z". */
export function reachableFrom(grid: ObstacleGrid, start: Tile): Set<string> {
  const seen = new Set<string>();
  if (!isWalkable(grid, start.x, start.z)) return seen;
  const queue: Tile[] = [start];
  seen.add(`${start.x},${start.z}`);
  while (queue.length > 0) {
    const t = queue.shift();
    if (!t) break;
    for (const [dx, dz] of DIRS) {
      const nx = t.x + dx;
      const nz = t.z + dz;
      const k = `${nx},${nz}`;
      if (seen.has(k) || !isWalkable(grid, nx, nz)) continue;
      seen.add(k);
      queue.push({ x: nx, z: nz });
    }
  }
  return seen;
}

/** Nearest walkable tile to a target (square ring search), or null. */
export function nearestWalkable(grid: ObstacleGrid, target: Tile, maxRadius = 4): Tile | null {
  if (isWalkable(grid, target.x, target.z)) return target;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = target.x + dx;
        const z = target.z + dz;
        if (isWalkable(grid, x, z)) return { x, z };
      }
    }
  }
  return null;
}

export function tileDistance(a: Tile, b: Tile): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}
