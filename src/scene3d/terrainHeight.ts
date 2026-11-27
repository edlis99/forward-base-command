import { TerrainCell, TerrainType } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { geography } from '../game/maps/geography';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
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

/** Water surface above its bed: just under the lower banks of each lake. */
export const WATER_DEPTH = 0.42;

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

/**
 * Shores. The edge of the water is a smooth curve, not the squares of the cell grid: the water's
 * share at a point is the cell raster (water cells, and the river under bridges, counting as 1)
 * blurred by a Gaussian a little under a cell wide, exactly, cell by cell. The ground falls from
 * its land level to the lake bed as that share rises through SHORE_FROM..SHORE_TO, so the
 * waterline (where the ground meets the water's surface) is a contour of a smooth field: rounded
 * corners, no stairs. It stays within a third of the cell grid's own share (a one-cell pond is
 * still water, a one-cell spit of land still land). Visual only: units keep walking on the same
 * cells.
 */
const SHORE_SIGMA = .7, SHORE_FROM = .12, SHORE_TO = .75;
const isWater = (c: TerrainCell | undefined) => !!c && c.type === 'water' && !c.bridge;
const isWet = (c: TerrainCell | undefined) => !!c && (c.type === 'water' || !!c.bridge);

/** Standard normal cumulative distribution (Abramowitz and Stegun 7.1.26 for the error function). */
function phi(x: number) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + .3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z);
  return .5 * (1 + Math.sign(x) * erf);
}

/** Per cell: 0 with no water within three cells, 2 with water in every cell of the 7 x 7 round it, else 1. */
const shoreFlags = new WeakMap<TerrainCell[][], Uint8Array>();
function shoreFlagsOf(terrain: TerrainCell[][]): Uint8Array {
  let flags = shoreFlags.get(terrain);
  if (flags) return flags;
  // A summed-area table of the water cells: any count in a window in constant time.
  const sat = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += isWet(terrain[y]?.[x]) ? 1 : 0;
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  flags = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - 3), x1 = Math.min(W, x + 4), y0 = Math.max(0, y - 3), y1 = Math.min(H, y + 4);
    const n = sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
    flags[y * W + x] = n === 0 ? 0 : n === (x1 - x0) * (y1 - y0) && x1 - x0 === 7 && y1 - y0 === 7 ? 2 : 1;
  }
  shoreFlags.set(terrain, flags);
  return flags;
}

/**
 * The water's smooth share (0 to 1) at a point: the cell raster blurred by a Gaussian of
 * `sigma` cells (the window reaches 3 sigma, at most 3 cells).
 */
export function shoreWetness(terrain: TerrainCell[][], gx: number, gz: number, sigma = SHORE_SIGMA): number {
  const cx = Math.max(0, Math.min(W - 1, Math.floor(gx))), cz = Math.max(0, Math.min(H - 1, Math.floor(gz)));
  const flag = shoreFlagsOf(terrain)[cz * W + cx];
  if (flag !== 1) return flag === 2 ? 1 : 0;
  const reach = Math.min(3, 3 * sigma), x0 = Math.floor(gx - reach), x1 = Math.floor(gx + reach), z0 = Math.floor(gz - reach), z1 = Math.floor(gz + reach);
  const wx: number[] = [], wz: number[] = [];
  for (let k = x0; k <= x1; k++) wx.push(phi((k + 1 - gx) / sigma) - phi((k - gx) / sigma));
  for (let k = z0; k <= z1; k++) wz.push(phi((k + 1 - gz) / sigma) - phi((k - gz) / sigma));
  let wet = 0, total = 0;
  for (let k = z0; k <= z1; k++) for (let i = x0; i <= x1; i++) {
    const w = wx[i - x0] * wz[k - z0];
    total += w;
    if (isWet(terrain[Math.max(0, Math.min(H - 1, k))]?.[Math.max(0, Math.min(W - 1, i))])) wet += w;
  }
  return total > 0 ? wet / total : 0;
}

/**
 * How far the ground has fallen to the lake bed (0 land, 1 bed) at a given water share: half a
 * straight ramp, half a smooth step, so it keeps a slope where it starts (a low shore, level
 * with the water, would otherwise hover at the surface and break into polygon islets).
 */
const shoreProfile = (share: number) => {
  const s = Math.max(0, Math.min(1, (share - SHORE_FROM) / (SHORE_TO - SHORE_FROM)));
  return .5 * s + .5 * s * s * (3 - 2 * s);
};

/**
 * Banks beside roads. A road beside water runs on a bank: out to BANK_LEVEL cells beyond its
 * carriageway the ground stays at the road's own level, then falls to the water over BANK_FALL
 * cells. (Without it the ground fell towards the lake bed from the road's own cells: the water
 * came up over the lane's edge, the lane tilted towards it and its edge line wandered.) The river
 * under and beside a bridge is left open. Per ground-mesh vertex (two a cell): how far the
 * water there is banked up (0 to 1).
 */
const BANK_LEVEL = .5, BANK_FALL = 1.1, BANK_SUB = 2;
/**
 * The river stays open beside a deck: this far beyond its half width, the banks returning over the
 * next BANK_OPEN_FADE; and along it only as far as the deck's ends, the banks returning over
 * BANK_END_FADE beyond them (the road on the bank there keeps its level ground).
 */
const BANK_OPEN = 1.15, BANK_OPEN_FADE = .8, BANK_END_FADE = .4;
const BANK_W = W * BANK_SUB + 1, BANK_H = H * BANK_SUB + 1;
const roadBanks = new WeakMap<TerrainCell[][], Float32Array | null>();

function roadBankGrid(terrain: TerrainCell[][]): Float32Array | null {
  const cached = roadBanks.get(terrain);
  if (cached !== undefined) return cached;
  let share: Float32Array | null = null;
  // Only on the map these roads are painted on.
  const painted = terrain.length === H && LEIPALINGIS_ROADS.slice(0, 12).some(r => {
    const [x, y] = r.points[Math.floor(r.points.length / 2)];
    return !!terrain[Math.floor(y)]?.[Math.floor(x)]?.roadName;
  });
  if (painted) {
    const flags = shoreFlagsOf(terrain), n = BANK_W * BANK_H;
    share = new Float32Array(n);
    const open = new Float32Array(n).fill(1);
    /** Every grid vertex within `reach` of a point. */
    const around = (px: number, py: number, reach: number, fn: (k: number, d: number) => void) => {
      const i0 = Math.max(0, Math.ceil((px - reach) * BANK_SUB)), i1 = Math.min(BANK_W - 1, Math.floor((px + reach) * BANK_SUB));
      const j0 = Math.max(0, Math.ceil((py - reach) * BANK_SUB)), j1 = Math.min(BANK_H - 1, Math.floor((py + reach) * BANK_SUB));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i / BANK_SUB - px, j / BANK_SUB - py);
        if (d <= reach) fn(j * BANK_W + i, d);
      }
    };
    const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
    for (const road of LEIPALINGIS_ROADS) {
      const hw = (road.class === 'track' ? Math.max(road.width, .32) : road.width) / 2;
      for (let seg = 1; seg < road.points.length; seg++) {
        const [ax, ay] = road.points[seg - 1], [bx, by] = road.points[seg], steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / .2));
        for (let st = 0; st <= steps; st++) {
          const px = ax + (bx - ax) * st / steps, py = ay + (by - ay) * st / steps, cx = Math.floor(px), cy = Math.floor(py);
          const cell = terrain[cy]?.[cx];
          if (!cell || !flags[cy * W + cx]) continue;
          // (A road's stretch on a deck makes no bank: the river runs under it.)
          if (cell.bridge) continue;
          around(px, py, hw + BANK_LEVEL + BANK_FALL, (k, d) => { share[k] = Math.max(share[k], 1 - smooth((d - hw - BANK_LEVEL) / BANK_FALL)); });
        }
      }
    }
    // The river stays open under and beside each bridge's deck.
    const decks = new Set<NonNullable<TerrainCell['bridge']>>();
    for (const row of terrain) for (const c of row) if (c.bridge) decks.add(c.bridge);
    for (const b of decks) {
      const [ax, ay] = b.a, [bx, by] = b.b, L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, half = deckWidth(b) / 2;
      const reach = half + BANK_OPEN + BANK_OPEN_FADE + BANK_END_FADE + .5, mx = (ax + bx) / 2, my = (ay + by) / 2;
      around(mx, my, L / 2 + reach, (k) => {
        const px = (k % BANK_W) / BANK_SUB - ax, py = Math.floor(k / BANK_W) / BANK_SUB - ay;
        const along = px * ux + py * uy, across = Math.abs(-px * uy + py * ux);
        const lateral = smooth((across - half - BANK_OPEN) / BANK_OPEN_FADE);
        const ends = smooth((along < 0 ? -along : along > L ? along - L : 0) / BANK_END_FADE);
        open[k] = Math.min(open[k], Math.max(lateral, ends));
      });
    }
    for (let k = 0; k < n; k++) share[k] *= open[k];
  }
  roadBanks.set(terrain, share);
  return share;
}

/** How far the water at a point is banked up by a road beside it (0 to 1). */
function roadBankAt(terrain: TerrainCell[][], gx: number, gz: number) {
  const grid = roadBankGrid(terrain);
  if (!grid) return 0;
  const u = Math.max(0, Math.min(BANK_W - 1.001, gx * BANK_SUB)), v = Math.max(0, Math.min(BANK_H - 1.001, gz * BANK_SUB));
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j, k = j * BANK_W + i;
  return (grid[k] * (1 - fx) + grid[k + 1] * fx) * (1 - fz) + (grid[k + BANK_W] * (1 - fx) + grid[k + BANK_W + 1] * fx) * fz;
}

/**
 * The water's smooth share at a point, held within a band round the plain grid's share (the four
 * nearest cells, bilinear), and pinned to it at each cell's centre: a water cell's centre is
 * always under the water, a land cell's never, so a one-cell pond stays a pond and a one-cell
 * spit stays land. Towards the cell edges, where waterlines run, the smooth share takes over.
 */
export function smoothShoreShare(terrain: TerrainCell[][], gx: number, gz: number) {
  const smooth = shoreWetness(terrain, gx, gz);
  if (smooth <= 0 || smooth >= 1) return smooth;
  let grid = 0;
  for (const [c, w] of cellsAround(terrain, gx, gz)) if (isWet(c)) grid += w;
  const centre = Math.hypot(gx - Math.floor(gx) - .5, gz - Math.floor(gz) - .5), k = Math.max(0, Math.min(1, centre / .3));
  const free = Math.max(.7 * grid, Math.min(.3 + .7 * grid, smooth));
  return grid + (free - grid) * k * k * (3 - 2 * k);
}

/** How much of the ground at a point has fallen to the lake bed: the shore's profile, less the road bank. */
export function wetGroundShare(terrain: TerrainCell[][], gx: number, gz: number, share = smoothShoreShare(terrain, gx, gz)) {
  return share <= 0 ? 0 : shoreProfile(share) * (1 - roadBankAt(terrain, gx, gz));
}

/** The four cells round a point with their bilinear weights. */
function cellsAround(terrain: TerrainCell[][], gx: number, gz: number): Array<[TerrainCell, number]> {
  const cellAt = (cx: number, cy: number): TerrainCell => {
    const row = terrain[Math.max(0, Math.min(H - 1, cy))] ?? terrain[0];
    return row[Math.max(0, Math.min(W - 1, cx))] ?? row[0];
  };
  const u = gx - 0.5, v = gz - 0.5;
  const ix = Math.floor(u), iz = Math.floor(v);
  const fx = u - ix, fz = v - iz;
  return [
    [cellAt(ix, iz), (1 - fx) * (1 - fz)],
    [cellAt(ix + 1, iz), fx * (1 - fz)],
    [cellAt(ix, iz + 1), (1 - fx) * fz],
    [cellAt(ix + 1, iz + 1), fx * fz],
  ];
}

/** A cell's contribution to the ground: soil level, how strongly relief shows, and elevation. */
function cellGround(c: TerrainCell, riverBed: boolean) {
  return {
    level: riverBed ? GROUND_LEVEL.water : c.roadName ? 0 : GROUND_LEVEL[c.type] ?? 0,
    relief: riverBed ? RELIEF.water : c.roadName ? 1 : RELIEF[c.type] ?? 1,
    elev: (c.elevation ?? 1) - 1,
  };
}

/** Land (or water) ground values from the nearest such cells, for a point with none among its own four. */
function nearbyGround(terrain: TerrainCell[][], gx: number, gz: number, water: boolean, mode: HeightMode) {
  let w = 0, level = 0, relief = 0, elev = 0;
  const cx = Math.floor(gx), cz = Math.floor(gz);
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const c = terrain[cz + dz]?.[cx + dx];
    if (!c) continue;
    const riverBed = !!c.bridge && mode === 'bed', wet = riverBed || isWater(c);
    if (wet !== water || (c.bridge && mode === 'deck')) continue;
    const weight = 1 / (Math.hypot(cx + dx + .5 - gx, cz + dz + .5 - gz) ** 2 + .25), g = cellGround(c, riverBed);
    w += weight; level += g.level * weight; relief += g.relief * weight; elev += g.elev * weight;
  }
  return w > 0 ? { level: level / w, relief: relief / w, elev: elev / w } : water ? { level: GROUND_LEVEL.water, relief: RELIEF.water, elev: 0 } : { level: 0, relief: 1, elev: 0 };
}

/** `road` treats bridge cells as plain road (used only to find deck end heights). */
function heightAt(terrain: TerrainCell[][] | undefined, gx: number, gz: number, mode: HeightMode): number {
  if (!terrain || terrain.length === 0) return 0;
  if (mode === 'deck') {
    const deck = deckAt(terrain, gx, gz);
    if (deck) return deckSurfaceAt(terrain, deck, gx, gz);
  }
  // The land's part of the ground apart from the water's (a river bed, and the river under a bridge).
  const land = { w: 0, level: 0, relief: 0, elev: 0 }, water = { w: 0, level: 0, relief: 0, elev: 0 };
  let deckSum = 0;
  for (const [c, w] of cellsAround(terrain, gx, gz)) {
    if (w <= 0 || !c) continue;
    if (c.bridge && mode === 'deck') { deckSum += w * bridgeDeckAt(terrain, c.bridge, gx, gz); continue; }
    const riverBed = !!c.bridge && mode === 'bed', g = cellGround(c, riverBed), part = riverBed || isWater(c) ? water : land;
    part.w += w; part.level += g.level * w; part.relief += g.relief * w; part.elev += g.elev * w;
  }
  // Where the road surface is wanted, and away from any water, the cells' own blend.
  const shore = mode === 'road' ? 0 : smoothShoreShare(terrain, gx, gz), share = wetGroundShare(terrain, gx, gz, shore);
  const total = land.w + water.w;
  let level = land.level, relief = land.relief, elev = land.elev;
  if (water.w > 0 || share > 0) {
    // The ground mixes from its land values to the river bed's by the shore's smooth share.
    const L = land.w > 1e-6 ? { level: land.level / land.w, relief: land.relief / land.w, elev: land.elev / land.w } : nearbyGround(terrain, gx, gz, false, mode);
    const Wt = water.w > 1e-6 ? { level: water.level / water.w, relief: water.relief / water.w, elev: water.elev / water.w } : nearbyGround(terrain, gx, gz, true, mode);
    level = total * (L.level * (1 - share) + Wt.level * share);
    relief = total * (L.relief * (1 - share) + Wt.relief * share);
    elev = total * (L.elev * (1 - share) + Wt.elev * share);
  }
  // The ground is graded towards the water: the hills' noise fades out over the last cell or two, so
  // the waterline is a smooth curve and not a scatter of islets where a low shore meets the surface.
  if (shore > 0) { const g = Math.max(0, Math.min(1, (shore - .02) / .38)); relief *= 1 - .8 * g * g * (3 - 2 * g); }
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

