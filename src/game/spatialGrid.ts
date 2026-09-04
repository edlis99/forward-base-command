import { GameState, Unit } from './types';

/**
 * Cheap uniform spatial hash over living units, rebuilt once per simulation
 * tick. Local avoidance and cohesion only ever query a 3x3 block of buckets,
 * so movement stays O(units * neighbours) instead of O(units^2).
 */
export const GRID_CELL = 64;

export interface UnitGrid {
  cell: number;
  buckets: Map<number, Unit[]>;
}

function key(gx: number, gy: number) { return gx * 100003 + gy; }

export function buildUnitGrid(state: GameState, cell = GRID_CELL): UnitGrid {
  const buckets = new Map<number, Unit[]>();
  for (const u of state.units) {
    if (!u.alive || u.insideOf) continue;
    const k = key(Math.floor(u.pos.x / cell), Math.floor(u.pos.y / cell));
    const list = buckets.get(k);
    if (list) list.push(u); else buckets.set(k, [u]);
  }
  return { cell, buckets };
}

/** Units within `radius` (bucket-approximate) of a point, excluding `self`. */
export function queryNeighbors(grid: UnitGrid, x: number, y: number, radius: number, self?: Unit): Unit[] {
  const out: Unit[] = [];
  const r = Math.max(1, Math.ceil(radius / grid.cell));
  const cx = Math.floor(x / grid.cell), cy = Math.floor(y / grid.cell);
  for (let gy = cy - r; gy <= cy + r; gy++) {
    for (let gx = cx - r; gx <= cx + r; gx++) {
      const list = grid.buckets.get(key(gx, gy));
      if (!list) continue;
      for (const u of list) if (u !== self) out.push(u);
    }
  }
  return out;
}

export function getUnitGrid(state: GameState): UnitGrid {
  const s = state.script as Record<string, unknown>;
  let g = s.__unitGrid as UnitGrid | undefined;
  if (!g) { g = buildUnitGrid(state); s.__unitGrid = g; }
  return g;
}

export function refreshUnitGrid(state: GameState) {
  (state.script as Record<string, unknown>).__unitGrid = buildUnitGrid(state);
}
