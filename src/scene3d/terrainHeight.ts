import { TerrainCell, TerrainType } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { geography } from '../game/maps/geography';
import { deckWidth } from '../game/terrain';

// The designed Leipalingis map carries real hills in its height map (they block
// sight in the simulation), so show those, a little exaggerated for readability,
// and keep the decorative bumps small so the eye and the rules agree.
const HILL_SCALE = geography.designed ? 1.7 : 1.05;
const BUMP_SCALE = geography.designed ? .35 : 1;

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

/** Deck surface above the road it carries (keeps feet and markers on top). */
export const BRIDGE_DECK_LIFT = 0.04;

type HeightMode = 'bed' | 'deck' | 'road';
type BridgeInfo = NonNullable<TerrainCell['bridge']>;
const deckEnds = new WeakMap<BridgeInfo, [number, number]>();

/** Road height at a span's two land ends; the deck slopes straight between them. */
export function bridgeDeckEnds(terrain: TerrainCell[][], bridge: BridgeInfo): [number, number] {
  let ends = deckEnds.get(bridge);
  if (!ends) {
    ends = [heightAt(terrain, bridge.a[0], bridge.a[1], 'road'), heightAt(terrain, bridge.b[0], bridge.b[1], 'road')];
    deckEnds.set(bridge, ends);
  }
  return ends;
}

/** Deck surface height of a span at a point (projected onto the span line). */
export function bridgeDeckAt(terrain: TerrainCell[][], bridge: BridgeInfo, gx: number, gz: number): number {
  const [ha, hb] = bridgeDeckEnds(terrain, bridge);
  const [ax, ay] = bridge.a, vx = bridge.b[0] - ax, vy = bridge.b[1] - ay;
  const t = Math.max(0, Math.min(1, ((gx - ax) * vx + (gz - ay) * vy) / (vx * vx + vy * vy || 1)));
  return ha + (hb - ha) * t + BRIDGE_DECK_LIFT;
}

/** The road surface over a deck's slab (Bridges: slab top, then the running surface). */
export const DECK_SURFACE = 0.01;

/**
 * The bridge whose deck covers a point (grid coordinates): within the deck's
 * width, between its ends. A deck cell is mostly river: only this strip of it
 * carries units, at the deck's own height, not a blend with the water beside it.
 */
export function deckAt(terrain: TerrainCell[][] | undefined, gx: number, gz: number): BridgeInfo | null {
  if (!terrain) return null;
  const cx = Math.floor(gx), cz = Math.floor(gz);
  let seen: BridgeInfo | null = null;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const b = terrain[cz + dz]?.[cx + dx]?.bridge;
    if (!b || b === seen) continue;
    seen = b;
    const [ax, ay] = b.a, vx = b.b[0] - ax, vy = b.b[1] - ay, L = Math.hypot(vx, vy) || 1;
    const px = gx - ax, py = gz - ay;
    const along = (px * vx + py * vy) / L, across = (-px * vy + py * vx) / L;
    if (along >= 0 && along <= L && Math.abs(across) <= deckWidth(b) / 2) return b;
  }
  return null;
}

/** Height of a deck's road surface at a point (grid coordinates). */
export function deckSurfaceAt(terrain: TerrainCell[][], bridge: BridgeInfo, gx: number, gz: number): number {
  return bridgeDeckAt(terrain, bridge, gx, gz) + DECK_SURFACE;
}

/**
 * Surface height (world Y, in cell units) at continuous grid coordinates.
 * Must stay identical to the vertex displacement used by GroundSurface.
 * Under a bridge the ground is river bed (`deck` false); with `deck` true a
 * bridge cell is its sloped road deck, which is what units and markers stand on.
 */
export function groundHeightAt(terrain: TerrainCell[][] | undefined, gx: number, gz: number, deck = false): number {
  return heightAt(terrain, gx, gz, deck ? 'deck' : 'bed');
}

/** `road` treats bridge cells as plain road (used only to find deck end heights). */
function heightAt(terrain: TerrainCell[][] | undefined, gx: number, gz: number, mode: HeightMode): number {
  if (!terrain || terrain.length === 0) return 0;
  if (mode === 'deck') {
    const deck = deckAt(terrain, gx, gz);
    if (deck) return deckSurfaceAt(terrain, deck, gx, gz);
  }
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
  let level = 0, relief = 0, elev = 0, deckSum = 0;
  for (const [c, w] of wts) {
    if (w <= 0 || !c) continue;
    if (c.bridge && mode === 'deck') { deckSum += w * bridgeDeckAt(terrain, c.bridge, gx, gz); continue; }
    const bed = !!c.bridge && mode === 'bed';
    level += (bed ? GROUND_LEVEL.water : c.roadName ? 0 : GROUND_LEVEL[c.type] ?? 0) * w;
    relief += (bed ? RELIEF.water : c.roadName ? 1 : RELIEF[c.type] ?? 1) * w;
    elev += ((c.elevation ?? 1) - 1) * w;
  }
  const hills = (fbm(gx * 0.03, gz * 0.03) - 0.5) * 2.4 * BUMP_SCALE;
  const mid = (fbm(gx * 0.11, gz * 0.11) - 0.5) * 0.36;
  const fine = (fbm(gx * 0.45, gz * 0.45) - 0.5) * 0.06;
  // Weighted parts are linear in the weights, so land and deck parts simply add.
  return level + elev * HILL_SCALE + (hills + mid + fine) * relief + deckSum;
}

/**
 * Lake/river bed height using only the water cells around a point, so a
 * shoreline sample does not climb the bank. Water surfaces sit a fixed depth
 * above this: flat per lake (one elevation per lake), following the river.
 * Returns undefined where no water cell touches the point.
 */
export function waterBedHeightAt(terrain: TerrainCell[][], gx: number, gz: number): number | undefined {
  const u = gx - 0.5, v = gz - 0.5;
  const ix = Math.floor(u), iz = Math.floor(v);
  const fx = u - ix, fz = v - iz;
  let elev = 0, total = 0;
  for (const [cx, cy, w] of [[ix, iz, (1 - fx) * (1 - fz)], [ix + 1, iz, fx * (1 - fz)], [ix, iz + 1, (1 - fx) * fz], [ix + 1, iz + 1, fx * fz]]) {
    const c = terrain[cy]?.[cx];
    if (!c || (c.type !== 'water' && !c.bridge)) continue;
    const wt = Math.max(w, 1e-3);
    elev += ((c.elevation ?? 1) - 1) * wt;
    total += wt;
  }
  if (!total) return undefined;
  const hills = (fbm(gx * 0.03, gz * 0.03) - 0.5) * 2.4 * BUMP_SCALE;
  const mid = (fbm(gx * 0.11, gz * 0.11) - 0.5) * 0.36;
  return GROUND_LEVEL.water + (elev / total) * HILL_SCALE + (hills + mid) * RELIEF.water;
}

/**
 * Active terrain cache. Layers that only receive a `gameStateRef` (VFX,
 * markers, ghosts) can sample the surface without threading the terrain
 * array through every component. Set once per frame by the scene root.
 */
let activeTerrain: TerrainCell[][] | undefined;

export function setActiveTerrain(t: TerrainCell[][] | undefined) {
  activeTerrain = t;
}

/** Surface Y at continuous grid coords, using the cached active terrain. */
export function surfaceY(gx: number, gz: number): number {
  return groundHeightAt(activeTerrain, gx, gz, true);
}

/**
 * Height sampler for a hull at a point: on a deck it is the deck's own plane
 * (so a vehicle near the railing does not roll towards the river), elsewhere
 * the ground. Also says whether the point is on a deck.
 */
export function hullSurface(gx: number, gz: number): { onDeck: boolean; at: (x: number, z: number) => number } {
  const deck = activeTerrain ? deckAt(activeTerrain, gx, gz) : null;
  return deck && activeTerrain
    ? { onDeck: true, at: (x, z) => deckSurfaceAt(activeTerrain!, deck, x, z) }
    : { onDeck: false, at: surfaceY };
}

/** Surface Y from engine world coordinates (pixels), given CELL_SIZE. */
export function surfaceYWorld(wx: number, wy: number, cellSize: number): number {
  return groundHeightAt(activeTerrain, wx / cellSize, wy / cellSize, true);
}

