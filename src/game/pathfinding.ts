import { TerrainCell, Position, UnitType } from './types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from './constants';
import { isPassable } from './terrain';

interface Node { gx: number; gy: number; g: number; f: number; parent: Node | null; }

function cellPassable(terrain: TerrainCell[][], gx: number, gy: number, vehicle: boolean, heli: boolean): boolean {
  if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) return false;
  return isPassable(terrain[gy][gx], vehicle, heli);
}

function moveCost(cell: TerrainCell): number {
  return Math.max(0.4, cell.movementCost);
}

const NEIGH = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41],
];

/** A* over terrain grid. Returns smoothed list of world-space waypoints (excluding start). */
export function findPath(
  terrain: TerrainCell[][],
  start: Position,
  goal: Position,
  type: UnitType,
): Position[] {
  const heli = type === 'helicopter';
  if (heli) return [{ x: goal.x, y: goal.y }];

  const vehicle = type === 'tank' || type === 'apc';
  const sx = Math.floor(start.x / CELL_SIZE);
  const sy = Math.floor(start.y / CELL_SIZE);
  let gx = Math.floor(goal.x / CELL_SIZE);
  let gy = Math.floor(goal.y / CELL_SIZE);

  // Snap goal to nearest passable cell if blocked
  if (!cellPassable(terrain, gx, gy, vehicle, heli)) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = gx + dx, ny = gy + dy;
          if (cellPassable(terrain, nx, ny, vehicle, heli)) {
            const d = dx * dx + dy * dy;
            if (!best || d < best.d) best = { x: nx, y: ny, d };
          }
        }
      }
      if (best) break;
    }
    if (!best) return [];
    gx = best.x; gy = best.y;
  }

  if (sx === gx && sy === gy) return [{ x: goal.x, y: goal.y }];

  const open: Node[] = [];
  const visited = new Map<number, number>(); // key=gy*COLS+gx -> g
  const key = (x: number, y: number) => y * MAP_COLS + x;

  const startNode: Node = { gx: sx, gy: sy, g: 0, f: Math.hypot(gx - sx, gy - sy), parent: null };
  open.push(startNode);
  visited.set(key(sx, sy), 0);

  let goalNode: Node | null = null;
  let iterations = 0;
  const MAX_ITER = 4000;

  while (open.length > 0 && iterations++ < MAX_ITER) {
    // pop best
    let bestI = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestI].f) bestI = i;
    const cur = open.splice(bestI, 1)[0];
    if (cur.gx === gx && cur.gy === gy) { goalNode = cur; break; }

    for (const [dx, dy, base] of NEIGH) {
      const nx = cur.gx + dx, ny = cur.gy + dy;
      if (!cellPassable(terrain, nx, ny, vehicle, heli)) continue;
      // diag corner cutting
      if (dx !== 0 && dy !== 0) {
        if (!cellPassable(terrain, cur.gx + dx, cur.gy, vehicle, heli)) continue;
        if (!cellPassable(terrain, cur.gx, cur.gy + dy, vehicle, heli)) continue;
      }
      const cell = terrain[ny][nx];
      const ng = cur.g + base * moveCost(cell);
      const k = key(nx, ny);
      const prev = visited.get(k);
      if (prev !== undefined && prev <= ng) continue;
      visited.set(k, ng);
      const h = Math.hypot(gx - nx, gy - ny);
      open.push({ gx: nx, gy: ny, g: ng, f: ng + h, parent: cur });
    }
  }

  if (!goalNode) return [];

  // Reconstruct
  const cells: { gx: number; gy: number }[] = [];
  let n: Node | null = goalNode;
  while (n) { cells.push({ gx: n.gx, gy: n.gy }); n = n.parent; }
  cells.reverse();

  // To world coords
  const worldPath = cells.map(c => ({ x: c.gx * CELL_SIZE + CELL_SIZE / 2, y: c.gy * CELL_SIZE + CELL_SIZE / 2 }));
  // Use exact goal at end
  if (worldPath.length > 0) worldPath[worldPath.length - 1] = { x: goal.x, y: goal.y };

  // String-pull / smooth: drop intermediate points where straight LOS is clear
  return smoothPath(terrain, start, worldPath, vehicle, heli);
}

function lineClear(terrain: TerrainCell[][], a: Position, b: Position, vehicle: boolean, heli: boolean): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / (CELL_SIZE * 0.4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t, y = a.y + dy * t;
    const gx = Math.floor(x / CELL_SIZE), gy = Math.floor(y / CELL_SIZE);
    if (!cellPassable(terrain, gx, gy, vehicle, heli)) return false;
  }
  return true;
}

function smoothPath(terrain: TerrainCell[][], start: Position, path: Position[], vehicle: boolean, heli: boolean): Position[] {
  if (path.length <= 1) return path;
  const out: Position[] = [];
  let anchor: Position = start;
  let i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !lineClear(terrain, anchor, path[j], vehicle, heli)) j--;
    out.push(path[j]);
    anchor = path[j];
    i = j + 1;
  }
  return out;
}
