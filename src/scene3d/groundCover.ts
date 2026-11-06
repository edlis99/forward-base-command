import * as THREE from 'three';
import type { TerrainCell } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { groundHeightAt } from './terrainHeight';
import { drivewaysIn, roadHalfWidth } from './roadMaterial';

/**
 * Shared data for what grows on the ground and what has been driven over it:
 * the ground height as the landscape mesh draws it, where grass grows and how
 * tall (a static map-wide texture), and where vehicles and soldiers have
 * flattened it (a texture updated as they move, recovering over minutes).
 */

/**
 * Ground height as the landscape mesh draws it: its vertices every half cell
 * (heights cached per map) and the very triangles between them (each quad
 * split along the diagonal buildGroundGeometry uses, alternating). Blending
 * the four corners instead put things up to 0.04 cell under the drawn ground
 * on steep banks, where they vanished (a ring's side, grass, track marks).
 * Much cheaper than the full height function.
 */
const SUB = 2, GW = MAP_COLS * SUB + 1, GH = MAP_ROWS * SUB + 1;
const vertexHeights = new WeakMap<TerrainCell[][], Float32Array>();
export function meshHeight(terrain: TerrainCell[][], gx: number, gz: number) {
  let grid = vertexHeights.get(terrain);
  if (!grid) { grid = new Float32Array(GW * GH).fill(NaN); vertexHeights.set(terrain, grid); }
  const u = Math.max(0, Math.min(GW - 1.001, gx * SUB)), v = Math.max(0, Math.min(GH - 1.001, gz * SUB));
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j;
  const at = (ii: number, jj: number) => {
    const k = jj * GW + ii;
    let h = grid![k];
    if (Number.isNaN(h)) { h = groundHeightAt(terrain, ii / SUB, jj / SUB); grid![k] = h; }
    return h;
  };
  const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
  // Even quads are split from (i + 1, j) to (i, j + 1), odd ones from (i, j) to (i + 1, j + 1).
  if ((i + j) % 2 === 0) return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  return fx >= fz ? a + (b - a) * fx + (d - b) * fz : a + (d - c) * fx + (c - a) * fz;
}

/**
 * Draw order of the ground and the grass on it. The grass is drawn right
 * after the ground and writes no depth, so nothing is ever hidden in it:
 * units, selection rings, range circles and markers all paint over it. Its
 * layers still overlap as they should, drawn from the bottom up.
 */
export const GROUND_ORDER = -3, GRASS_LAYERS_ORDER = -2, TUFTS_ORDER = -1;

/** Height of the sward in cells (one cell is about 12 m): pasture about 0.5 m, tall meadow grass about 1 m. */
export const PASTURE_HEIGHT = .045, MEADOW_HEIGHT = .088;
const PASTURE = { cover: 1, tall: .12 };
/**
 * A campaign road's own cells (its carriageway and shoulders, stamped in
 * whole cells for movement). The road is drawn to its own width within them;
 * the rest of each cell is grass like the pasture around it.
 */
export const roadCell = (c: TerrainCell | undefined) => !!c && !!c.roadName && !c.bridge && (c.type === 'road' || c.type === 'gravel');
/** Bare ground either side of a drawn road, beyond its carriageway's edge (cells): its shoulder and a little more. */
export const ROAD_CLEARING = .13;

/** Texels per cell of the grass and trample maps (a texel is about 3 m). */
export const COVER_RES = 4;
const TW = MAP_COLS * COVER_RES, TH = MAP_ROWS * COVER_RES;

/**
 * How much of a cell is grass (0..1) and how tall it grows (0 pasture .. 1
 * tall meadow grass). Woods have their own undergrowth; yards, streets,
 * buildings, water and bridges have none. A field's stone wall, boulder, hay
 * or logs stand in the grass: it grows round them (a bare cell under each
 * left light squares all over the fields). Whether units may enter does not
 * matter: the scenery border round the map is out of bounds, and its fields
 * were bare, a lighter strip along the edge of the view.
 */
export function grassOf(c: TerrainCell | undefined): { cover: number; tall: number } {
  if (!c || c.bridge || c.yard === 'courtyard') return { cover: 0, tall: 0 };
  if (c.type === 'sandbag' && (c.prop || c.blocksMovement)) return { cover: 1, tall: .12 };
  if (c.prop) return { cover: 0, tall: 0 };
  if (c.type === 'tall_grass') return { cover: 1, tall: 1 };
  if (c.type === 'open') return { cover: c.yard ? .7 : 1, tall: c.yard ? 0 : .12 };
  if (c.type === 'hedgerow') return { cover: .55, tall: .4 };
  return { cover: 0, tall: 0 };
}

/** Ground that takes a track: grass, meadow, mud and churned earth; not roads, yards, woods or bridges. */
export function softGround(c: TerrainCell | undefined) {
  if (!c || c.bridge || (c.roadName && (c.type === 'road' || c.type === 'gravel'))) return false;
  return grassOf(c).cover > 0 || c.type === 'mud' || c.type === 'crater' || c.type === 'rubble';
}

const masks = new WeakMap<TerrainCell[][], THREE.DataTexture>();
/**
 * The grass map: red = grass cover, green = tallness, four texels a cell,
 * blended between cell centres so its edges are soft. Roads, their shoulders
 * and driveways are cut out where they are actually drawn, not by whole cells.
 */
export function grassMask(terrain: TerrainCell[][], regional = true): THREE.DataTexture {
  let tex = masks.get(terrain);
  if (tex) return tex;
  const data = new Uint8Array(TW * TH * 2);
  // The campaign map's roads drawn over the grass: stroked once on a canvas
  // at map resolution (other maps have roads as whole cells, already bare).
  let roads: Uint8ClampedArray | null = null;
  const canvas = regional && typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
  if (canvas && ctx) {
    canvas.width = TW; canvas.height = TH;
    ctx.scale(COVER_RES, COVER_RES);
    ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff';
    for (const road of LEIPALINGIS_ROADS) {
      ctx.beginPath(); road.points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.lineWidth = (roadHalfWidth(road) + ROAD_CLEARING) * 2; ctx.stroke();
    }
    for (const d of drivewaysIn(terrain, 0, 0, MAP_COLS, MAP_ROWS)) {
      ctx.beginPath(); ctx.moveTo(...d.from); ctx.lineTo(...d.to); ctx.lineWidth = .3; ctx.stroke();
    }
    roads = ctx.getImageData(0, 0, TW, TH).data;
  }
  // With the roads cut out as drawn, their cells grow grass like the pasture
  // around them (whole bare cells left steps of bare ground along every road).
  const cell = (x: number, y: number) => {
    const c = terrain[Math.max(0, Math.min(MAP_ROWS - 1, y))]?.[Math.max(0, Math.min(MAP_COLS - 1, x))];
    return roads && roadCell(c) ? PASTURE : grassOf(c);
  };
  for (let ty = 0; ty < TH; ty++) {
    const gy = (ty + .5) / COVER_RES - .5, y0 = Math.floor(gy), fy = gy - y0;
    for (let tx = 0; tx < TW; tx++) {
      const gx = (tx + .5) / COVER_RES - .5, x0 = Math.floor(gx), fx = gx - x0;
      const a = cell(x0, y0), b = cell(x0 + 1, y0), c = cell(x0, y0 + 1), d = cell(x0 + 1, y0 + 1);
      const mix = (k: 'cover' | 'tall') => (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy;
      const road = roads ? roads[(ty * TW + tx) * 4 + 3] / 255 : 0;
      const o = (ty * TW + tx) * 2;
      data[o] = Math.round(mix('cover') * (1 - road) * 255);
      data[o + 1] = Math.round(mix('tall') * 255);
    }
  }
  tex = new THREE.DataTexture(data, TW, TH, THREE.RGFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  masks.set(terrain, tex);
  return tex;
}

/**
 * Where grass has been flattened: by vehicle tracks and wheels outright, by
 * soldiers a little with every pass (a path appears where many walk). It
 * springs back over a few minutes of game time.
 */
export class TrampleMap {
  readonly data = new Uint8Array(TW * TH);
  readonly texture: THREE.DataTexture;
  /** Changed by recovery only (sent every 2 s), or by fresh tracks (sent within 0.3 s). */
  private dirty = false;
  private fresh = false;
  private uploadedAt = -Infinity;
  private decayRow = 0;
  private decayClock = 0;
  constructor() {
    this.texture = new THREE.DataTexture(this.data, TW, TH, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }
  /** Flatten along a stroke from (x0, z0) to (x1, z1), in cells: `half` its half width, `amount` 0..1 (added up to fully flat). */
  stroke(x0: number, z0: number, x1: number, z1: number, half: number, amount: number, add = false) {
    const r = half * COVER_RES, ax = x0 * COVER_RES, az = z0 * COVER_RES, bx = x1 * COVER_RES, bz = z1 * COVER_RES;
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const tx0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), tx1 = Math.min(TW - 1, Math.ceil(Math.max(ax, bx) + r));
    const tz0 = Math.max(0, Math.floor(Math.min(az, bz) - r)), tz1 = Math.min(TH - 1, Math.ceil(Math.max(az, bz) + r));
    const v = Math.round(amount * 255);
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const px = tx + .5 - ax, pz = tz + .5 - az, t = Math.max(0, Math.min(1, (px * vx + pz * vz) / l2));
      const d = Math.hypot(px - vx * t, pz - vz * t);
      if (d >= r + 1) continue;
      // Full within the stroke's width (a texel is 3 m, a hull 3.5 m: partial
      // cover left tank tracks half flattened), softening over one texel beyond.
      const k = Math.min(1, r + 1 - d), i = tz * TW + tx, s = Math.round(v * k);
      const next = add ? Math.min(255, this.data[i] + s) : Math.max(this.data[i], s);
      if (next !== this.data[i]) { this.data[i] = next; this.fresh = true; }
    }
  }
  /** Flattening at a point (cells), 0..1. */
  at(gx: number, gz: number) {
    const tx = Math.floor(gx * COVER_RES), tz = Math.floor(gz * COVER_RES);
    return tx < 0 || tz < 0 || tx >= TW || tz >= TH ? 0 : this.data[tz * TW + tx] / 255;
  }
  /**
   * Advance by `dt` game seconds: the grass recovers (a pass over a slice of
   * rows each frame, so there is never a long stall) and the texture is sent
   * to the graphics card at most a few times a second.
   */
  update(dt: number) {
    this.decayClock += dt;
    // A full sweep every 8 s of game time, each taking off 3 % (half recovered in about 3 minutes).
    const rows = Math.min(TH, Math.floor(this.decayClock / 8 * TH));
    if (rows > 0) {
      this.decayClock -= rows / TH * 8;
      for (let n = 0; n < rows; n++) {
        const row = this.decayRow;
        this.decayRow = (this.decayRow + 1) % TH;
        for (let i = row * TW, end = i + TW; i < end; i++) {
          const v = this.data[i];
          if (v) { this.data[i] = v > 8 ? v - Math.max(1, v * .03 | 0) : 0; this.dirty = true; }
        }
      }
    }
    // Real time, not game time: tracks laid just before a pause must still reach the screen.
    const clock = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const since = clock - this.uploadedAt;
    if ((this.fresh && since > .3) || (this.dirty && since > 2)) {
      this.texture.needsUpdate = true;
      this.dirty = this.fresh = false;
      this.uploadedAt = clock;
    }
  }
}
const trampleMaps = new WeakMap<TerrainCell[][], TrampleMap>();
export function trampleMap(terrain: TerrainCell[][]): TrampleMap {
  let map = trampleMaps.get(terrain);
  if (!map) { map = new TrampleMap(); trampleMaps.set(terrain, map); }
  return map;
}
/** UV scale from map cells to the grass and trample textures. */
export const COVER_UV = new THREE.Vector2(1 / MAP_COLS, 1 / MAP_ROWS);
