import { TerrainCell, Position, UnitType } from './types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from './constants';
import { isPassable, isFootprintPassable, isWorldFootprintPassable, deckUnder, spanAxis, spanCoords, walkableAt, type BridgeSpan } from './terrain';

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

/** A diagonal step between two cells that runs on a bridge deck (one of them a deck cell). */
function deckLink(terrain: TerrainCell[][], ax: number, ay: number, bx: number, by: number): boolean {
  if (!terrain[ay]?.[ax]?.bridge && !terrain[by]?.[bx]?.bridge) return false;
  const x = (ax + bx + 1) / 2 * CELL_SIZE, y = (ay + by + 1) / 2 * CELL_SIZE;
  return !!deckUnder(terrain, x, y, .2);
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
      // diag corner cutting, except along a bridge deck: a skewed deck's cells
      // sometimes meet the road only at a corner, with the river on both sides
      // (the only way across; where one corner is land the route goes round it as before).
      if (dx !== 0 && dy !== 0) {
        const sideA = cellPassable(terrain, cur.gx + dx, cur.gy, vehicle, heli), sideB = cellPassable(terrain, cur.gx, cur.gy + dy, vehicle, heli);
        if ((!sideA || !sideB) && !(!sideA && !sideB && deckLink(terrain, cur.gx, cur.gy, nx, ny))) continue;
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

/**
 * Rule M14: a route over a bridge runs straight along the deck, from a point
 * on the road just before one end to a point just past the other, instead of
 * cutting across its deck cells (the deck is narrower than its cells: the
 * rest is the river). Routes that only touch a deck cell are left alone.
 */
export function alignBridgeCrossings(terrain: TerrainCell[][], start: Position, path: Position[], vehicle: boolean): Position[] {
  if (!path.length) return path;
  const points = [start, ...path];
  // Sample the route; note each run of samples over one span's deck cells.
  const samples: { x: number; y: number; seg: number; span?: BridgeSpan }[] = [];
  for (let s = 0; s < points.length - 1; s++) {
    const p = points[s], q = points[s + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (CELL_SIZE * .25)));
    for (let k = s ? 1 : 0; k <= n; k++) {
      const x = p.x + (q.x - p.x) * k / n, y = p.y + (q.y - p.y) * k / n;
      samples.push({ x, y, seg: s, span: terrain[Math.floor(y / CELL_SIZE)]?.[Math.floor(x / CELL_SIZE)]?.bridge });
    }
  }
  const cuts: { from: number; to: number; entry: Position; exit: Position; onDeck: boolean }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const span = samples[i].span;
    if (!span) continue;
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].span === span) j++;
    // A route that starts on the deck (a unit re-planning half way over) only needs its way off.
    const onDeck = i === 0, before = onDeck ? samples[0] : samples[i - 1], after = samples[j + 1];
    i = j;
    if (!after) continue;
    // A crossing comes in at one end and leaves by the other.
    const { L } = spanAxis(span);
    const b0 = spanCoords(span, before.x, before.y).along, a1 = spanCoords(span, after.x, after.y).along;
    if (onDeck ? !(a1 < 0 || a1 > L) : !((b0 < L * .5 && a1 > L * .5) || (b0 > L * .5 && a1 < L * .5))) continue;
    const { ax, ay, ux, uy } = spanAxis(span);
    const end = (t: number, out: number) => {
      // A little way out along the axis onto the road, or the end itself where that is blocked.
      for (const o of [out, out * .5, 0]) {
        const at = { x: (ax + ux * (t + Math.sign(t - L / 2) * o)) * CELL_SIZE, y: (ay + uy * (t + Math.sign(t - L / 2) * o)) * CELL_SIZE };
        if (walkableAt(terrain, at.x, at.y, vehicle)) return at;
      }
      return { x: (ax + ux * t) * CELL_SIZE, y: (ay + uy * t) * CELL_SIZE };
    };
    const forward = b0 < a1;
    cuts.push({ from: onDeck ? 0 : before.seg, to: after.seg, entry: end(forward ? 0 : L, .7), exit: end(forward ? L : 0, .7), onDeck });
  }
  if (!cuts.length) return path.map(p => ontoDeck(terrain, p));
  // Rebuild: waypoints up to each crossing, its entry and exit, then the rest.
  const out: Position[] = [];
  let next = 1;
  for (const cut of cuts) {
    for (; next <= cut.from; next++) out.push(points[next]);
    const prev = out[out.length - 1] ?? start;
    const dirX = cut.exit.x - cut.entry.x, dirY = cut.exit.y - cut.entry.y;
    // No turning back for an entry already behind the unit.
    if (!cut.onDeck && (cut.entry.x - prev.x) * dirX + (cut.entry.y - prev.y) * dirY > 0) out.push(cut.entry);
    out.push(cut.exit);
    next = Math.max(next, cut.to + 1);
    // Nor back to a route point the exit already lies beyond.
    while (next < points.length - 1 && (points[next].x - cut.exit.x) * dirX + (points[next].y - cut.exit.y) * dirY < 0) next++;
  }
  for (; next < points.length; next++) out.push(points[next]);
  return out.map(p => ontoDeck(terrain, p));
}
/** A route point on the river part of a deck cell, moved onto the deck's centre line. */
function ontoDeck(terrain: TerrainCell[][], p: Position): Position {
  const span = terrain[Math.floor(p.y / CELL_SIZE)]?.[Math.floor(p.x / CELL_SIZE)]?.bridge;
  if (!span || deckUnder(terrain, p.x, p.y)) return p;
  const { ax, ay, ux, uy, L } = spanAxis(span);
  const t = Math.max(0, Math.min(L, spanCoords(span, p.x, p.y).along));
  return { ...p, x: (ax + ux * t) * CELL_SIZE, y: (ay + uy * t) * CELL_SIZE };
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
