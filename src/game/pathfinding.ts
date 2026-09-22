import { TerrainCell, Position, UnitType } from './types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from './constants';
import { isPassable, isFootprintPassable, isWorldFootprintPassable } from './terrain';

interface Node { gx: number; gy: number; g: number; f: number; parent: Node | null; }

class MinHeap {
  private items: Node[] = [];
  get length() { return this.items.length; }
  push(node: Node) {
    this.items.push(node);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.items[parent].f <= node.f) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = node;
  }
  pop(): Node | undefined {
    const root = this.items[0];
    const last = this.items.pop();
    if (!root || !last || this.items.length === 0) return root;
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      if (left >= this.items.length) break;
      const right = left + 1;
      const child = right < this.items.length && this.items[right].f < this.items[left].f ? right : left;
      if (this.items[child].f >= last.f) break;
      this.items[i] = this.items[child];
      i = child;
    }
    this.items[i] = last;
    return root;
  }
}

function cellPassable(terrain: TerrainCell[][], gx: number, gy: number, vehicle: boolean, heli: boolean): boolean {
  if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) return false;
  if (vehicle) return isFootprintPassable(terrain, gx, gy, true, false);
  return isPassable(terrain[gy][gx], vehicle, heli);
}

function moveCost(cell: TerrainCell): number {
  return Math.max(0.4, cell.movementCost / cell.traction);
}

const NEIGH = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Reuse indexed search storage across orders. A generation stamp avoids
// clearing 140,800 entries or allocating a Map for every selected unit.
const searchCost = new Float64Array(MAP_COLS * MAP_ROWS);
const searchStamp = new Uint32Array(MAP_COLS * MAP_ROWS);
let searchGeneration = 0;

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
  let snapped = false;

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
    snapped = true;
  }

  const destination = snapped ? { x: (gx + 0.5) * CELL_SIZE, y: (gy + 0.5) * CELL_SIZE } : goal;
  if (sx === gx && sy === gy) return [{ ...destination }];

  const open = new MinHeap();
  searchGeneration = (searchGeneration + 1) >>> 0;
  if (!searchGeneration) { searchStamp.fill(0); searchGeneration = 1; }
  const generation = searchGeneration;
  const key = (x: number, y: number) => y * MAP_COLS + x;

  // Admissible lower bound: roads cost less than one unit per cell.
  const startNode: Node = { gx: sx, gy: sy, g: 0, f: Math.hypot(gx - sx, gy - sy) * 0.4, parent: null };
  open.push(startNode);
  searchStamp[key(sx, sy)] = generation; searchCost[key(sx, sy)] = 0;

  let goalNode: Node | null = null;
  let iterations = 0;
  const MAX_ITER = MAP_COLS * MAP_ROWS;

  while (open.length > 0 && iterations < MAX_ITER) {
    const cur = open.pop();
    if (!cur) break;
    // Ignore stale heap entries superseded by a cheaper route.
    if (searchCost[key(cur.gx, cur.gy)] < cur.g) continue;
    iterations++;
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
      if (searchStamp[k] === generation && searchCost[k] <= ng) continue;
      searchStamp[k] = generation; searchCost[k] = ng;
      const h = Math.hypot(gx - nx, gy - ny) * 0.4;
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
  if (worldPath.length > 0) worldPath[worldPath.length - 1] = { ...destination };

  // String-pull / smooth: drop intermediate points where straight LOS is clear
  return smoothPath(terrain, start, worldPath, vehicle, heli);
}

function segmentCost(terrain: TerrainCell[][], a: Position, b: Position, vehicle: boolean, heli: boolean): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (CELL_SIZE * 0.2)));
  let cost = 0;
  let px = Math.floor(a.x / CELL_SIZE), py = Math.floor(a.y / CELL_SIZE);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t, y = a.y + dy * t;
    const gx = Math.floor(x / CELL_SIZE), gy = Math.floor(y / CELL_SIZE);
    if (!cellPassable(terrain, gx, gy, vehicle, heli) ||
        (vehicle && !isWorldFootprintPassable(terrain, x, y, true))) return Infinity;
    // Sampling must not allow a diagonal to clip an impassable corner.
    if (gx !== px && gy !== py &&
        (!cellPassable(terrain, gx, py, vehicle, heli) || !cellPassable(terrain, px, gy, vehicle, heli))) return Infinity;
    cost += moveCost(terrain[gy][gx]) * dist / steps;
    px = gx; py = gy;
  }
  return cost;
}

function smoothPath(terrain: TerrainCell[][], start: Position, path: Position[], vehicle: boolean, heli: boolean): Position[] {
  if (path.length <= 1) return path;
  const out: Position[] = [];
  let anchor: Position = start;
  // Compare travel time, not only obstacle clearance. Otherwise string-pulling
  // erases the road detour A* deliberately chose for its speed advantage.
  const prefix = [0];
  for (let k = 1; k < path.length; k++) {
    prefix[k] = prefix[k - 1] + segmentCost(terrain, path[k - 1], path[k], vehicle, heli);
  }
  let i = 0;
  while (i < path.length) {
    // Bound shortcut work on long regional orders. Every original segment
    // still contributes to travel cost; this only limits smoothing lookahead.
    let j = Math.min(path.length - 1, i + 40);
    const entryCost = segmentCost(terrain, anchor, path[i], vehicle, heli);
    while (j > i) {
      const direct = segmentCost(terrain, anchor, path[j], vehicle, heli);
      const original = entryCost + prefix[j] - prefix[i];
      if (Number.isFinite(direct) && direct <= original * 1.015 + 0.01) break;
      j--;
    }
    out.push(path[j]);
    anchor = path[j];
    i = j + 1;
  }
  return out;
}
