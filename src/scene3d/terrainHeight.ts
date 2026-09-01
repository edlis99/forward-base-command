import { TerrainCell, TerrainType } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';

/**
 * Single source of truth for the landscape's surface height.
 *
 * The ground is a displaced mesh (rolling hills + per-type soil level), so
 * anything that sits *on* the ground — units, trees, buildings, trenches,
 * markers, VFX — must sample the same function or it floats in the air or
 * sinks under the hill (tanks disappearing below terrain).
 */

const W = MAP_COLS;
const H = MAP_ROWS;

/** Vertical offset of the soil surface for each type (world/cell units). */
export const GROUND_LEVEL: Record<TerrainType | string, number> = {
  open: 0, tall_grass: 0.01, forest: 0.02, hedgerow: 0.02,
  road: -0.03, gravel: -0.01, urban: 0, wall: 0,
  rubble: 0.04, sandbag: 0.02, mud: -0.06, crater: -0.42,
  trench: -0.02, water: -0.55,
};

/** How strongly natural micro-relief shows through (roads/urban are graded). */
export const RELIEF: Record<TerrainType | string, number> = {
  open: 1, tall_grass: 1, forest: 1.15, hedgerow: 1, road: 0.12,
  gravel: 0.35, urban: 0.15, wall: 0.3, rubble: 1.2, sandbag: 0.8,
  mud: 0.9, crater: 1.3, trench: 0.5, water: 0.25,
};

export function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

export function fbm(x: number, y: number) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(x * f, y * f) * amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return sum;
}

/**
 * Surface height (world Y, in cell units) at continuous grid coordinates.
 * Must stay identical to the vertex displacement used by GroundSurface.
 */
export function groundHeightAt(terrain: TerrainCell[][] | undefined, gx: number, gz: number): number {
  if (!terrain || terrain.length === 0) return 0;
  const cellAt = (cx: number, cy: number): TerrainCell => {
    const row = terrain[Math.max(0, Math.min(H - 1, cy))] ?? terrain[0];
    return row[Math.max(0, Math.min(W - 1, cx))] ?? row[0];
  };
  const u = gx - 0.5, v = gz - 0.5;
  const ix = Math.floor(u), iz = Math.floor(v);
  const fx = u - ix, fz = v - iz;
  const wts: Array<[TerrainCell, number]> = [
    [cellAt(ix, iz), (1 - fx) * (1 - fz)],
    [cellAt(ix + 1, iz), fx * (1 - fz)],
    [cellAt(ix, iz + 1), (1 - fx) * fz],
    [cellAt(ix + 1, iz + 1), fx * fz],
  ];
  let level = 0, relief = 0, elev = 0;
  for (const [c, w] of wts) {
    if (w <= 0 || !c) continue;
    level += (GROUND_LEVEL[c.type] ?? 0) * w;
    relief += (RELIEF[c.type] ?? 1) * w;
    elev += ((c.elevation ?? 1) - 1) * w;
  }
  const hills = (fbm(gx * 0.03, gz * 0.03) - 0.5) * 2.4;
  const mid = (fbm(gx * 0.11, gz * 0.11) - 0.5) * 0.36;
  const fine = (fbm(gx * 0.45, gz * 0.45) - 0.5) * 0.06;
  return level + elev * 1.05 + (hills + mid + fine) * relief;
}
