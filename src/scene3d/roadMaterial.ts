import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { LEIPALINGIS_ROADS, MapRoad } from '../game/maps/leipalingis';
import { groundTex, SURFACES, TILE_CELLS } from './groundTextures';
import { ambienceUniforms } from './ambienceUniforms';
import { builtRoundabouts, trafficPlan } from './roadRules';

// Each section's road data reaches this far past its edges, so filtering
// never reveals a seam at section borders.
export const ROAD_GUTTER = 2;

interface Driveway { from: [number, number]; to: [number, number]; paved: boolean }

/** Road centre-line segments bucketed on a coarse grid, for nearest-street lookups. */
const BUCKET = 4;
const segmentBuckets = (() => {
  const buckets = new Map<string, { a: number[]; b: number[]; road: typeof LEIPALINGIS_ROADS[number] }[]>();
  for (const road of LEIPALINGIS_ROADS) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    for (let y = Math.floor(Math.min(a[1], b[1]) / BUCKET); y <= Math.floor(Math.max(a[1], b[1]) / BUCKET); y++)
      for (let x = Math.floor(Math.min(a[0], b[0]) / BUCKET); x <= Math.floor(Math.max(a[0], b[0]) / BUCKET); x++) {
        const key = `${x},${y}`, list = buckets.get(key) ?? [];
        list.push({ a, b, road }); buckets.set(key, list);
      }
  }
  return buckets;
})();

/**
 * How far inside the nearest road's carriageway a point is (cells; negative
 * outside it), or -Infinity with no road within `range`.
 */
export function roadEdgeAt(px: number, pz: number, range = 1.5) {
  const street = nearestStreet(px, pz, range);
  let edge = street ? street.width / 2 - street.d : -Infinity;
  // Roundabouts' rings (once the traffic plan has laid them out).
  for (const r of builtRoundabouts()) {
    const d = Math.abs(Math.hypot(px - r.x, pz - r.y) - r.ring);
    if (d <= range) edge = Math.max(edge, r.hw - d);
  }
  return edge;
}

/** Nearest point on any road's centre line within `range` cells. */
function nearestStreet(px: number, pz: number, range: number) {
  let best: { x: number; z: number; d: number; width: number } | null = null;
  for (let y = Math.floor((pz - range) / BUCKET); y <= Math.floor((pz + range) / BUCKET); y++)
    for (let x = Math.floor((px - range) / BUCKET); x <= Math.floor((px + range) / BUCKET); x++) {
      for (const { a, b, road } of segmentBuckets.get(`${x},${y}`) ?? []) {
        const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / l2));
        const qx = a[0] + vx * t, qz = a[1] + vz * t, d = Math.hypot(qx - px, qz - pz);
        if (d <= range && (!best || d < best.d)) best = { x: qx, z: qz, d, width: roadHalfWidth(road) * 2 };
      }
    }
  return best;
}

const drivewayCache = new WeakMap<TerrainCell[][], Driveway[]>();
/**
 * Driveways: each village and town house that faces a street gets a short
 * drive from its front door straight to that street, ending at the road's
 * edge. A house that does not face a street (it stands at an angle to it, or
 * the nearest street is beside or behind it) gets none: those drives used to
 * run sideways into the fields. Visual only; cells keep their gameplay type.
 * The front is local +z of the building, i.e. (-sin a, cos a) for its propAngle.
 */
function allDriveways(terrain: TerrainCell[][]) {
  let drives = drivewayCache.get(terrain);
  if (drives) return drives;
  drives = [];
  for (let y = 0; y < terrain.length; y++) for (let x = 0; x < terrain[0].length; x++) {
    const c = terrain[y][x];
    if (c.type !== 'urban' || !c.settlementId || c.buildingKind === 'barn' || c.buildingKind === 'church') continue;
    const a = c.propAngle ?? 0, fx = -Math.sin(a), fz = Math.cos(a);
    const sx = x + .5 + (c.buildingOffset?.[0] ?? 0) + fx * .2, sz = y + .5 + (c.buildingOffset?.[1] ?? 0) + fz * .2;
    const street = nearestStreet(sx, sz, 2.4);
    if (!street) continue;
    const reach = street.d - street.width / 2;
    if (reach < .12) continue;
    const ux = (street.x - sx) / street.d, uz = (street.z - sz) / street.d;
    // The street must be in front of the door, not beside or behind the house.
    if (ux * fx + uz * fz < .72) continue;
    const ex = sx + ux * (reach + .04), ez = sz + uz * (reach + .04);
    // Never through or onto another building, nor across water.
    let clear = true;
    const steps = Math.max(1, Math.ceil((reach + .04) / .15));
    for (let k = 1; k <= steps && clear; k++) {
      const t = Math.min(reach + .04, k * .15), n = terrain[Math.floor(sz + uz * t)]?.[Math.floor(sx + ux * t)];
      // Its own cell only on the way out: a road edge inside the house's own cell needs no drive.
      if (!n || n.type === 'water' || (n.type === 'urban' && (n !== c || k === steps))) clear = false;
    }
    if (clear) drives.push({ from: [sx, sz], to: [ex, ez], paved: c.buildingKind === 'brick' || c.buildingKind === 'block' });
  }
  drivewayCache.set(terrain, drives);
  return drives;
}

/** Driveways whose house front lies in the given cell rectangle. */
export function drivewaysIn(terrain: TerrainCell[][], x0: number, y0: number, x1: number, y1: number) {
  return allDriveways(terrain).filter(d => d.from[0] >= x0 && d.from[0] < x1 && d.from[1] >= y0 && d.from[1] < y1);
}

/**
 * What a road is made of, as the road data stores it: 4 asphalt with lines
 * painted (main roads), 3 asphalt without (village streets, paved drives),
 * 2 gravel (country roads, gravel drives), 1 farm track (two ruts, grass
 * between them).
 */
export const roadKind = (road: MapRoad) => road.class === 'track' ? 1 : !road.paved ? 2 : road.width >= .6 ? 4 : 3;
/** Half the width of a road's carriageway (cells): farm tracks read as a lane, never a crack. */
export const roadHalfWidth = (road: MapRoad) => (road.class === 'track' ? Math.max(road.width, .32) : road.width) / 2;

/** Road data texels per cell (about 1.5 m): the fields stored are linear across a road's edges, so they stay sharp. */
const ROAD_RES = 8;
/** Edge distances stored, either side of a carriageway's edge (cells). */
export const ROAD_E_MAX = .6;
/** Centre line: a dash every cell (12 m), 30 % of it painted. */
const DASH_PERIOD = 1;
/** How round junction corners are (cells): the smooth union's reach. */
const JUNCTION_FILLET = .5;

interface RoadLine { pts: number[][]; s: number[]; hw: number; kind: number; id: number; minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * The road network as centre lines, with the distance along each (for its
 * dashes). A road the map splits into pieces is chained back together where
 * the pieces run on into each other, so its dashes keep their rhythm.
 */
let networkCache: RoadLine[] | null = null;
function roadNetwork(): RoadLine[] {
  if (networkCache) return networkCache;
  const lines = LEIPALINGIS_ROADS.map((road, id) => {
    const u = [0];
    for (let i = 1; i < road.points.length; i++) u.push(u[i - 1] + Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1]));
    return { road, id, u, len: u[u.length - 1], offset: NaN, sign: 1 };
  });
  const key = (p: number[]) => `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)}`;
  const ends = new Map<string, { line: typeof lines[number]; atStart: boolean }[]>();
  for (const line of lines) for (const atStart of [true, false]) {
    const p = atStart ? line.road.points[0] : line.road.points[line.road.points.length - 1], k = key(p);
    ends.set(k, [...(ends.get(k) ?? []), { line, atStart }]);
  }
  const unit = (x: number, z: number) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
  for (const first of lines) {
    if (!Number.isNaN(first.offset)) continue;
    first.offset = 0;
    const queue = [first];
    while (queue.length) {
      const line = queue.pop()!, pts = line.road.points;
      for (const atStart of [true, false]) {
        // The distance at this end, and which way it grows on past the end.
        const p = atStart ? pts[0] : pts[pts.length - 1], q = atStart ? pts[1] : pts[pts.length - 2];
        const s = atStart ? line.offset : line.offset + line.sign * line.len, onward = atStart ? -line.sign : line.sign;
        const [inX, inZ] = unit(p[0] - q[0], p[1] - q[1]);
        for (const { line: next, atStart: nextStart } of ends.get(key(p)) ?? []) {
          if (next === line || !Number.isNaN(next.offset) || next.road.class !== line.road.class) continue;
          const np = next.road.points, r = nextStart ? np[1] : np[np.length - 2];
          const [outX, outZ] = unit(r[0] - p[0], r[1] - p[1]);
          if (inX * outX + inZ * outZ < .8) continue; // a junction, not the same road running on
          if (nextStart) { next.offset = s; next.sign = onward; } else { next.offset = s + onward * next.len; next.sign = -onward; }
          queue.push(next);
        }
      }
    }
  }
  networkCache = lines.map(({ road, id, u, offset, sign }) => ({
    pts: road.points, s: u.map(v => offset + sign * v), hw: roadHalfWidth(road), kind: roadKind(road), id,
    minX: Math.min(...road.points.map(p => p[0])), maxX: Math.max(...road.points.map(p => p[0])),
    minZ: Math.min(...road.points.map(p => p[1])), maxZ: Math.max(...road.points.map(p => p[1])),
  }));
  // Roundabouts' rings: asphalt with edge lines and no centre line (a dash rhythm of zero).
  trafficPlan().roundabouts.forEach((r, k) => {
    const pts = Array.from({ length: 49 }, (_, i) => [r.x + Math.cos(i / 48 * Math.PI * 2) * r.ring, r.y + Math.sin(i / 48 * Math.PI * 2) * r.ring]);
    networkCache!.push({ pts, s: pts.map(() => 0), hw: r.hw, kind: 4, id: 100000 + k,
      minX: r.x - r.ring, maxX: r.x + r.ring, minZ: r.y - r.ring, maxZ: r.y + r.ring });
  });
  return networkCache;
}

/**
 * The roads of one map section as data for the ground shader, eight texels a
 * cell (RGBA, each 0..1):
 * - R: distance to the nearest carriageway's edge, ±ROAD_E_MAX cells about
 *   0.5 (inside is above it). The union of all roads, so junctions join up.
 * - G: where across its road a point lies, ±2 half widths about 0.5 (±1 are
 *   the carriageway's edges), signed so it stays linear over the centre line.
 * - B: the road's kind (see roadKind) / 4.
 * - A: the centre line's dashes, a triangle wave along the road (painted
 *   below 0.3); 1 where another road crosses, so no line runs through.
 * All of these blend linearly between texels, so the shader draws edges,
 * lines and dashes sharp at any zoom. Asphalt wins where it meets gravel or
 * a track: the asphalt runs through and they end at its edge.
 */
export function createRoadData(section: MapSection, terrain?: TerrainCell[][]): THREE.DataTexture {
  const ox = section.x - ROAD_GUTTER, oz = section.y - ROAD_GUTTER;
  const W = (section.width + ROAD_GUTTER * 2) * ROAD_RES, H = (section.height + ROAD_GUTTER * 2) * ROAD_RES, n = W * H;
  const x1 = ox + W / ROAD_RES, z1 = oz + H / ROAD_RES;
  const lines = roadNetwork().filter(l => l.maxX + l.hw + ROAD_E_MAX >= ox && l.minX - l.hw - ROAD_E_MAX <= x1 && l.maxZ + l.hw + ROAD_E_MAX >= oz && l.minZ - l.hw - ROAD_E_MAX <= z1);
  if (terrain) drivewaysIn(terrain, ox, oz, x1, z1).forEach((d, k) => lines.push({
    pts: [d.from, d.to], s: [0, 0], hw: d.paved ? .1 : .09, kind: d.paved ? 3 : 2, id: -1 - k,
    minX: Math.min(d.from[0], d.to[0]), maxX: Math.max(d.from[0], d.to[0]), minZ: Math.min(d.from[1], d.to[1]), maxZ: Math.max(d.from[1], d.to[1]),
  }));
  const edge = new Float32Array(n).fill(-ROAD_E_MAX), score = new Float32Array(n).fill(-Infinity);
  const across = new Float32Array(n), dash = new Float32Array(n).fill(1), kind = new Uint8Array(n);
  const owner = new Int32Array(n).fill(0x7fffffff), dirX = new Float32Array(n), dirZ = new Float32Array(n);
  // The road whose edge each texel lies nearest inside (or closest outside), the way towards it,
  // and how much the corners between roads are filled out (see below).
  const edgeLine = new Int32Array(n).fill(0x7fffffff), edgeGX = new Float32Array(n), edgeGZ = new Float32Array(n);
  const fillet = new Float32Array(n);
  // Where roads overlap (junctions) or go round (roundabouts): lane wear has no sense there.
  const junction = new Float32Array(n);
  /** Every texel within reach of a line's segment: (texel, edge distance, distance, side, segment). */
  const visit = (line: RoadLine, fn: (i: number, e: number, d: number, side: number, k: number, t: number, ux: number, uz: number, gx: number, gz: number) => void) => {
    const reach = line.hw + ROAD_E_MAX;
    for (let k = 1; k < line.pts.length; k++) {
      const [ax, az] = line.pts[k - 1], [bx, bz] = line.pts[k], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
      if (l2 < 1e-10) continue;
      const len = Math.sqrt(l2), ux = vx / len, uz = vz / len;
      const tx0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - ox) * ROAD_RES)), tx1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + reach - ox) * ROAD_RES));
      const tz0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - oz) * ROAD_RES)), tz1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + reach - oz) * ROAD_RES));
      for (let tz = tz0; tz <= tz1; tz++) {
        const wz = oz + (tz + .5) / ROAD_RES - az;
        for (let tx = tx0; tx <= tx1; tx++) {
          const wx = ox + (tx + .5) / ROAD_RES - ax;
          const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / l2));
          const d = Math.hypot(wx - vx * t, wz - vz * t), e = line.hw - d;
          // (gx, gz): the way to the centre line, which the edge distance grows along.
          if (e > -ROAD_E_MAX) fn(tz * W + tx, e, d, ux * wz - uz * wx, k, t, ux, uz, d > 1e-6 ? (vx * t - wx) / d : 0, d > 1e-6 ? (vz * t - wz) / d : 0);
        }
      }
    }
  };
  for (const line of lines) visit(line, (i, e, d, side, k, t, ux, uz, gx, gz) => {
    if (e > edge[i]) { edge[i] = e; edgeLine[i] = line.id; edgeGX[i] = gx; edgeGZ[i] = gz; }
    // Which road a point belongs to: the nearest centre line, but asphalt first.
    const sc = e + (line.kind >= 3 && e > 0 ? 4 : 0);
    if (sc <= score[i]) return;
    score[i] = sc; owner[i] = line.id; kind[i] = line.kind; dirX[i] = ux; dirZ[i] = uz;
    across[i] = (side >= 0 ? 1 : -1) * d / line.hw;
    const s = (line.s[k - 1] + (line.s[k] - line.s[k - 1]) * t) / DASH_PERIOD;
    dash[i] = Math.abs(2 * (s - Math.floor(s)) - 1);
  });
  // No centre line where another road joins or crosses (its own pieces running on do not count).
  for (const line of lines) visit(line, (i, e, _d, _side, _k, _t, ux, uz, gx, gz) => {
    // (Nor any ruts in gravel and tracks: across the overlap the place across the road jumps from one
    // road to the other, which drew them as streaks; near the edge there are none. Marked roads keep
    // theirs, so their centre lines end straight; the overlap mask fades their wear out instead.)
    if (e > -.04 && owner[i] !== line.id && Math.abs(dirX[i] * ux + dirZ[i] * uz) < .85) {
      dash[i] = 1; junction[i] = 1;
      if (kind[i] < 4) across[i] = across[i] < 0 ? -.92 : .92;
    }
    // Junction corners rounded (a smooth union of the roads meeting there, about 6 m in radius):
    // sharp corners and narrow gravel gores between roads meeting at a shallow angle looked unmade.
    // Only in the corners between roads, where the ways to their centre lines part: on the outside
    // of a bend they run together, and filling out there drew a lump. It fades in with the angle
    // between them (switched on at a set angle, it drew slivers of edge line where it began).
    if (edgeLine[i] === line.id) return;
    const h = Math.max(JUNCTION_FILLET - Math.abs(edge[i] - e), 0) / JUNCTION_FILLET;
    const apart = 1 - (edgeGX[i] * gx + edgeGZ[i] * gz), w = Math.min(1, Math.max(0, (apart - .25) / .5));
    fillet[i] = Math.max(fillet[i], w * w * (3 - 2 * w) * h * h * JUNCTION_FILLET * .25);
  });
  for (let i = 0; i < n; i++) edge[i] += fillet[i];
  // The centre line runs continuous (1.1) before junctions, roundabouts and crossings.
  for (const zone of trafficPlan().solidLines) {
    if (zone.x + zone.r < ox || zone.x - zone.r > x1 || zone.y + zone.r < oz || zone.y - zone.r > z1) continue;
    const tx0 = Math.max(0, Math.floor((zone.x - zone.r - ox) * ROAD_RES)), tx1 = Math.min(W - 1, Math.ceil((zone.x + zone.r - ox) * ROAD_RES));
    const tz0 = Math.max(0, Math.floor((zone.y - zone.r - oz) * ROAD_RES)), tz1 = Math.min(H - 1, Math.ceil((zone.y + zone.r - oz) * ROAD_RES));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = tz * W + tx;
      if (kind[i] === 4 && dash[i] < .999 && Math.hypot(ox + (tx + .5) / ROAD_RES - zone.x, oz + (tz + .5) / ROAD_RES - zone.y) < zone.r) dash[i] = 0;
    }
  }
  // It stops at stop and give-way lines, and is not painted over crossings.
  for (const gap of trafficPlan().lineGaps) {
    const reach = Math.hypot(gap.along, gap.across), c = Math.cos(gap.angle), sn = Math.sin(gap.angle);
    if (gap.x + reach < ox || gap.x - reach > x1 || gap.y + reach < oz || gap.y - reach > z1) continue;
    const tx0 = Math.max(0, Math.floor((gap.x - reach - ox) * ROAD_RES)), tx1 = Math.min(W - 1, Math.ceil((gap.x + reach - ox) * ROAD_RES));
    const tz0 = Math.max(0, Math.floor((gap.y - reach - oz) * ROAD_RES)), tz1 = Math.min(H - 1, Math.ceil((gap.y + reach - oz) * ROAD_RES));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const dx = ox + (tx + .5) / ROAD_RES - gap.x, dz = oz + (tz + .5) / ROAD_RES - gap.y;
      if (Math.abs(dx * c + dz * sn) < gap.along && Math.abs(dz * c - dx * sn) < gap.across) dash[tz * W + tx] = 1;
    }
  }
  // And none out at a road's edge or beyond it: in a rounded corner, outside both roads, the point
  // passes from one road to the other and its place across the road flips sides through 0 between
  // texels, which drew a sliver of centre line there.
  for (let i = 0; i < n; i++) if (Math.abs(across[i]) > .9) dash[i] = 1;
  // The overlap, blurred over a few metres so wear fades out smoothly into it (a sharp
  // mask drew the texels' blocks; each road's own lane wear drew streaks across it).
  for (let i = 0; i < n; i++) if (owner[i] >= 100000) junction[i] = 1;
  const blurred = blur(junction, W, H, 4);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = Math.round(255 * Math.min(1, blurred[i] * 1.6));
  const data = new Uint8Array(n * 4), byte = (v: number) => Math.round(255 * Math.min(1, Math.max(0, v)));
  for (let i = 0; i < n; i++) {
    data[i * 4] = byte(.5 + edge[i] / (2 * ROAD_E_MAX));
    data[i * 4 + 1] = byte(.5 + across[i] / 4);
    data[i * 4 + 2] = byte(kind[i] / 4);
    data[i * 4 + 3] = byte(dash[i]);
  }
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4;
  texture.needsUpdate = true;
  const overlap = new THREE.DataTexture(mask, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  overlap.minFilter = THREE.LinearMipmapLinearFilter; overlap.magFilter = THREE.LinearFilter;
  overlap.generateMipmaps = true; overlap.needsUpdate = true;
  texture.userData.overlap = overlap;
  return texture;
}

/** Box blur, `passes` times each way (near enough a Gaussian), radius `r` texels. */
function blur(src: Float32Array, W: number, H: number, r: number, passes = 2) {
  const a = src.slice(), b = new Float32Array(src.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[y * W + x] = sum / (2 * r + 1);
        sum += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum / (2 * r + 1);
        sum += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  return a;
}

/**
 * Splat-blended Poly Haven landscape. Six diffuse maps are mixed per vertex
 * via splatA/splatB weights; normal/roughness come from a shared set, tiled
 * in world space so every map section lines up seamlessly.
 */
export function landscapeMaterial(_grain: THREE.Texture, roads: THREE.Texture | undefined, section: MapSection,
  grass?: { mask: THREE.Texture; uv: THREE.Vector2 }) {
  const normal = groundTex('grass', 'normal');
  const rough = groundTex('dirt', 'roughness');
  normal.repeat.set(1 / TILE_CELLS, 1 / TILE_CELLS);
  rough.repeat.set(1 / TILE_CELLS, 1 / TILE_CELLS);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, normalMap: normal, normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: rough, roughness: 1, metalness: 0,
  });
  material.name = 'Poly Haven terrain';
  // (Its roughness map has scattered near-mirror texels: on grass they caught the sun as specks.)
  const diffuse = SURFACES.map(s => groundTex(s, 'diffuse'));
  material.onBeforeCompile = shader => {
    SURFACES.forEach((_, i) => { shader.uniforms[`gDiff${i}`] = { value: diffuse[i] }; });
    shader.uniforms.gTile = { value: 1 / TILE_CELLS };
    if (grass) { shader.uniforms.gCover = { value: grass.mask }; shader.uniforms.gCoverUv = { value: grass.uv }; }
    shader.uniforms.asphaltTex = { value: diffuse[5] };
    shader.uniforms.uTime = ambienceUniforms.uTime;
    shader.vertexShader = 'attribute vec3 splatA;\nattribute vec3 splatB;\nuniform float gTile;\nvarying vec3 vSplatA;\nvarying vec3 vSplatB;\nvarying vec2 gUv;\n' + shader.vertexShader;
    // Grass, soil and fields are matte: never glossier than this (roads set their own below).
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.88);');
    let begin = '#include <begin_vertex>\nvSplatA = splatA; vSplatB = splatB; gUv = position.xz * gTile;';
    if (roads) {
      shader.uniforms.roadData = { value: roads };
      shader.uniforms.roadOverlap = { value: roads.userData.overlap };
      shader.uniforms.asphaltNormal = { value: groundTex('asphalt', 'normal') };
      shader.uniforms.gravelNormal = { value: groundTex('gravel', 'normal') };
      shader.uniforms.roadBounds = { value: new THREE.Vector4(section.x - ROAD_GUTTER, section.y - ROAD_GUTTER,
        section.width + ROAD_GUTTER * 2, section.height + ROAD_GUTTER * 2) };
      shader.vertexShader = 'uniform vec4 roadBounds;\nvarying vec2 campaignUv;\n' + shader.vertexShader;
      begin += '\ncampaignUv = vec2((position.x - roadBounds.x) / roadBounds.z, (position.z - roadBounds.y) / roadBounds.w);';
    }
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', begin);
    shader.fragmentShader = SURFACES.map((_, i) => `uniform sampler2D gDiff${i};`).join('\n')
      + '\nvarying vec3 vSplatA;\nvarying vec3 vSplatB;\nvarying vec2 gUv;\nuniform float uTime;\nuniform float gTile;\n'
      + 'float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n'
      + 'float rGauss(float x) { return exp(-x * x); }\n'
      + 'float cNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);\n'
      + '  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y); }\n'
      + (roads ? 'uniform sampler2D roadData;\nuniform sampler2D roadOverlap;\nuniform sampler2D asphaltNormal;\nuniform sampler2D gravelNormal;\nvarying vec2 campaignUv;\n' : '')
      + (grass ? 'uniform sampler2D gCover;\nuniform vec2 gCoverUv;\n' : '')
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      // Second, rotated sample breaks up visible tile repetition.
      vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * gUv * 0.37 + 0.31;
      #define GS(t) (texture2D(t, gUv).rgb * 0.65 + texture2D(t, uvB).rgb * 0.35)
      // The installed grass texture is dry, yellow-brown grass; tint it to
      // Lithuanian summer green (crops golden-green, forest floor a touch greener).
      vec3 tex = GS(gDiff0) * vec3(0.74, 1.02, 0.60) * vSplatA.x + GS(gDiff1) * vec3(0.92, 1.0, 0.72) * vSplatA.y + GS(gDiff2) * vec3(0.86, 0.98, 0.78) * vSplatA.z
               + GS(gDiff3) * vSplatB.x + GS(gDiff4) * vSplatB.y + GS(gDiff5) * vSplatB.z;
      float wsum = dot(vSplatA, vec3(1.0)) + dot(vSplatB, vec3(1.0));
      tex = wsum > 0.001 ? tex / wsum : GS(gDiff0);
      // Close up one tile (3.5 cells) is magnified past its texels: blend in a
      // finer sample of the same ground (a tile every 0.8 cell), so grass and
      // gravel keep their grain when the camera is zoomed right in.
      float closeUp = 1.0 - smoothstep(3.0, 9.0, length(vViewPosition));
      if (closeUp > 0.0) {
        vec2 uvD = mat2(0.6, 0.8, -0.8, 0.6) * gUv * 4.3 + vec2(0.17, 0.53);
        vec3 fine = texture2D(gDiff0, uvD).rgb * vec3(0.74, 1.02, 0.60) * vSplatA.x + texture2D(gDiff1, uvD).rgb * vec3(0.92, 1.0, 0.72) * vSplatA.y
                  + texture2D(gDiff2, uvD).rgb * vec3(0.86, 0.98, 0.78) * vSplatA.z + texture2D(gDiff3, uvD).rgb * vSplatB.x
                  + texture2D(gDiff4, uvD).rgb * vSplatB.y + texture2D(gDiff5, uvD).rgb * vSplatB.z;
        fine = wsum > 0.001 ? fine / wsum : texture2D(gDiff0, uvD).rgb;
        tex = mix(tex, fine, closeUp * 0.45);
      }
      // Vertex colours keep the old patchiness as a gentle brightness/tint shift.
      float lum = dot(vColor.rgb, vec3(0.333));
      vec3 tint = mix(vec3(1.0), vColor.rgb / max(lum, 0.02), 0.25);
      diffuseColor.rgb = tex * tint * clamp(0.75 + lum * 1.3, 0.85, 1.3);
      // Meadows: grassland is not one carpet. Broad patches of lush, sun-dried
      // and damp darker grass, clumps at the scale of a few metres, and the
      // wind running over it in slow bright waves (all weighted by how much of
      // the ground here is grass, so roads, fields and woods keep their look).
      float meadow = clamp(vSplatA.x + vSplatA.y * 0.35, 0.0, 1.0) * (1.0 - clamp(vSplatB.z * 2.0, 0.0, 1.0));
      if (meadow > 0.01) {
        vec2 mw = gUv / gTile;
        float broad = cNoise(mw * 0.085 + 7.3) * 0.6 + cNoise(mw * 0.21 + 2.1) * 0.4;
        float damp = cNoise(mw * 0.13 + vec2(4.7, 9.1));
        vec3 lush = vec3(0.86, 1.12, 0.74), dried = vec3(1.16, 1.06, 0.74), moist = vec3(0.74, 0.92, 0.70);
        vec3 shade = mix(lush, dried, smoothstep(0.42, 0.78, broad));
        shade = mix(shade, moist, smoothstep(0.62, 0.86, damp) * 0.7);
        float clumps = cNoise(mw * 1.9 + 3.7) * 0.6 + cNoise(mw * 4.3 + 1.1) * 0.4;
        shade *= 0.9 + clumps * 0.2;
        // Wind: long low waves crossing the meadow, a touch of sheen on the bent blades.
        vec2 windDir = vec2(0.83, 0.56);
        float wave = sin(dot(mw, windDir) * 0.9 - uTime * 1.6 + cNoise(mw * 0.15) * 4.0);
        float gust = smoothstep(0.35, 1.0, wave) * smoothstep(0.25, 0.75, cNoise(mw * 0.05 + vec2(uTime * 0.05, 0.0)));
        shade *= 1.0 + gust * 0.075;
        diffuseColor.rgb *= mix(vec3(1.0), shade, meadow);
      }
      ${grass ? `
      // Grass grows here (the layered grass when zoomed in): the bare ground
      // takes the sward's depth, so where the layers fade out (the edge of
      // their patch, zooming out) no lighter patch shows.
      diffuseColor.rgb *= mix(1.0, 0.88, texture2D(gCover, gUv / gTile * gCoverUv).r);` : ''}
      ${roads ? ROAD_SURFACE_GLSL : ''}
      // Drifting cloud shadows: big soft patches sliding slowly across the land.
      vec2 cw = gUv / gTile;
      float cloud = cNoise(cw * 0.012 + vec2(uTime * 0.006, uTime * 0.0025)) * 0.65 + cNoise(cw * 0.031 + vec2(uTime * 0.01, 0.0)) * 0.35;
      diffuseColor.rgb *= 1.0 - smoothstep(0.52, 0.74, cloud) * 0.26;
    `);
    if (roads) {
      // Roads have their own surface: asphalt smooth and fine-grained, gravel
      // and ruts rough, puddles and fresh paint glossier.
      shader.fragmentShader = shader.fragmentShader
        .replace('roughnessFactor = max(roughnessFactor, 0.88);', 'roughnessFactor = mix(max(roughnessFactor, 0.88), roadRough, roadW);')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (roadW > 0.002) {
          vec3 nA = texture2D(asphaltNormal, rw * 1.9).xyz * 2.0 - 1.0;
          vec3 nG = texture2D(gravelNormal, rw * 1.6).xyz * 2.0 - 1.0;
          vec3 mapR = mix(nG * vec3(0.9, 0.9, 1.0), nA * vec3(0.7, 0.7, 1.0), roadPaved);
          normal = normalize(mix(normal, normalize(tbn * mapR), roadW));
        }`);
    }
  };
  material.customProgramCacheKey = () => `polyhaven-landscape-v11-${roads ? 'r' : 'n'}${grass ? 'g' : ''}`;
  return material;
}

/**
 * Road surfaces from the road data (createRoadData), drawn over the ground:
 * - Asphalt: the photographed asphalt aged to grey, with large patches of
 *   older and newer surface, lighter polished wheel paths, a darker line of
 *   oil between them and sealed cracks along and across it, a dusty crumbling
 *   edge and a grey gravel shoulder. Main roads have white edge lines and a
 *   dashed centre line, worn where the wheels run.
 * - Gravel: grey-beige grit with two compacted wheel tracks, loose grit
 *   between them and along the sides, the odd damp pothole.
 * - Farm track: a worn, pale band with two dusty ruts, grass between them.
 * Edges fray with noise; detail finer than a pixel fades out zoomed out.
 * Sets roadW (how much road covers the point), roadRough and roadPaved for
 * the roughness and normal stages, and rw (world position in cells).
 */
const ROAD_SURFACE_GLSL = `
      vec4 rd = texture2D(roadData, campaignUv);
      float rE = (rd.r - 0.5) * ${(2 * ROAD_E_MAX).toFixed(2)};
      float rAcross = (rd.g - 0.5) * 4.0;
      vec2 rw = gUv / gTile;
      // Derivatives outside any branch: cells per pixel, and the edge distance's rate.
      float rPx = length(fwidth(rw));
      float rAA = max(fwidth(rE), 1e-4);
      float roadW = 0.0, roadRough = 1.0, roadPaved = 0.0;
      if (rE > -0.3) {
        float a = abs(rAcross);
        float kind = rd.b * 4.0;
        float paved = smoothstep(2.4, 2.9, kind), marked = smoothstep(3.4, 3.9, kind);
        float track = 1.0 - smoothstep(1.4, 1.9, kind), gravel = clamp(1.0 - paved - track, 0.0, 1.0);
        float fine = 1.0 - smoothstep(0.012, 0.035, rPx);
        float n1 = cNoise(rw * 4.1 + 1.3), n2 = cNoise(rw * 11.7 + 5.9), n3 = cNoise(rw * 29.0 + 2.2);
        float fray = n1 * 0.55 + n2 * 0.3 + n3 * 0.15 - 0.5;
        // Asphalt crumbles a little at its edge; gravel and tracks fray into the grass.
        float Ec = rE + fray * mix(0.08, 0.03, paved);
        float carriage = smoothstep(-rAA, rAA, Ec);
        float shoulderW = mix(0.035, 0.075, paved) * (1.0 - track);
        float shoulder = smoothstep(-rAA, rAA, rE + shoulderW + (n1 - 0.5) * 0.06 + (n2 - 0.5) * 0.02) * (1.0 - carriage);
        vec3 ground = diffuseColor.rgb;
        // The road's half width here, and how far from its centre line (cells).
        float hw = rE / max(0.15, 1.0 - a), fromCentre = rAcross * hw;

        // Asphalt: the photographed asphalt aged to grey, older and newer stretches.
        vec3 aT = texture2D(gDiff5, rw * 1.9).rgb * 0.6 + texture2D(gDiff5, mat2(0.8, -0.6, 0.6, 0.8) * rw * 0.53 + 0.4).rgb * 0.4;
        float aL = clamp(dot(aT, vec3(0.333)) / 0.06, 0.6, 1.5);
        float age = cNoise(rw * 0.31 + 7.0) * 0.7 + cNoise(rw * 0.9 + 3.0) * 0.3;
        vec3 asphalt = vec3(0.118, 0.12, 0.117) * mix(0.82, 1.12, age) * mix(1.0, aL, 0.55);
        // Wheels polish two paths in each lane; oil drips darken the middle of it. Fading out
        // where roads overlap or go round: there is no one lane there.
        float lanes = 1.0 - smoothstep(0.0, 0.2, texture2D(roadOverlap, campaignUv).r);
        float wheels = mix(rGauss((a - 0.45) / 0.15), rGauss((a - 0.29) / 0.09) + rGauss((a - 0.71) / 0.09), marked) * lanes;
        asphalt *= 1.0 + wheels * 0.11;
        float oil = mix(rGauss(a / 0.12), rGauss((a - 0.5) / 0.07), marked) * (0.5 + 0.5 * n1) * lanes;
        asphalt *= 1.0 - oil * 0.14;
        // Cracks, sealed dark: along the edges and the lane joint on aged
        // stretches, and across the road here and there (placed by the centre
        // line's rhythm along the road, so they run straight across it).
        float crackW = 0.006 + rPx * 0.35;
        float edgeOff = 0.06 - rE + (cNoise(rw * 2.3) - 0.5) * 0.05;
        float longC = (1.0 - smoothstep(crackW * 0.5, crackW, abs(edgeOff))) * smoothstep(0.55, 0.7, cNoise(rw * 0.35 + 5.0));
        float jointC = (1.0 - smoothstep(crackW * 0.5, crackW, abs(fromCentre + (cNoise(rw * 1.7 + 2.0) - 0.5) * 0.06)))
          * smoothstep(0.6, 0.75, cNoise(rw * 0.3 + 8.0)) * marked;
        float alongCrack = abs(rd.a - 0.68 + (cNoise(rw * 6.0) - 0.5) * 0.03) * 0.5;
        float transC = (1.0 - smoothstep(crackW * 0.5, crackW, alongCrack)) * smoothstep(0.8, 0.88, cNoise(rw * 0.9 + 4.0))
          * (1.0 - smoothstep(0.85, 0.95, a)) * (1.0 - step(0.99, rd.a));
        asphalt *= 1.0 - max(max(longC, jointC), transC) * fine * 0.24 * lanes;
        // The outer edge, dusty with grit from the shoulder.
        asphalt = mix(asphalt, vec3(0.21, 0.195, 0.165), (1.0 - smoothstep(0.0, 0.06, Ec)) * 0.4 * (0.4 + n2));
        // Lines: edge lines 20 cm wide, 40 cm in; centre dashes 3.5 m every 12 m; worn where the wheels run.
        float lineAA = rPx * 0.75 + 0.002;
        float edgeLine = smoothstep(0.03 - lineAA, 0.03 + lineAA, rE) * (1.0 - smoothstep(0.047 - lineAA, 0.047 + lineAA, rE));
        float centreLine = (1.0 - smoothstep(0.009 - lineAA, 0.009 + lineAA, abs(fromCentre))) * (1.0 - smoothstep(0.3 - rPx * 2.0 - 0.01, 0.3 + rPx * 2.0 + 0.01, rd.a));
        float paint = max(edgeLine, centreLine) * marked * carriage * (0.72 + 0.28 * n3) * (1.0 - wheels * 0.3);
        asphalt = mix(asphalt, vec3(0.6, 0.6, 0.56), paint);

        // Gravel: two compacted wheel tracks, loose grit between them and along the sides, damp potholes.
        float gL = clamp(dot(texture2D(gDiff4, rw * 1.6).rgb, vec3(0.333)) / 0.11, 0.55, 1.6);
        vec3 grit = vec3(0.34, 0.3, 0.22) * mix(1.0, gL, 0.7);
        float ruts = rGauss((a - 0.42) / 0.14);
        float hole = smoothstep(0.82, 0.85, cNoise(rw * 4.1 + 21.0)) * ruts * fine;
        vec3 gravelC = grit * (1.0 - ruts * 0.17) * (1.0 + (1.0 - smoothstep(0.0, 0.18, a)) * 0.08 + smoothstep(0.78, 1.0, a) * 0.06);
        gravelC = mix(gravelC, grit * vec3(0.66, 0.64, 0.62), hole);

        // Farm track: a worn, pale band with two dusty ruts, grass between them.
        float dL = clamp(dot(texture2D(gDiff3, rw * 1.7).rgb, vec3(0.333)) / 0.09, 0.55, 1.6);
        vec3 dirt = vec3(0.36, 0.3, 0.2) * mix(1.0, dL, 0.6);
        float trackDirt = clamp(rGauss((a - 0.5) / 0.2) * 1.25 + (1.0 - smoothstep(0.8, 1.05, a)) * 0.45 + (n2 - 0.5) * 0.5
          - (1.0 - smoothstep(0.0, 0.25, a)) * 0.25, 0.0, 1.0);
        vec3 trackC = mix(ground, dirt, trackDirt);

        // The shoulder: grey grit along asphalt, a worn margin along gravel, grass coming through.
        vec3 verge = mix(vec3(0.3, 0.285, 0.25) * mix(1.0, gL, 0.6), ground, smoothstep(0.35, 0.8, n1 * 0.6 + n3 * 0.4) * 0.65);
        diffuseColor.rgb = mix(diffuseColor.rgb, verge, shoulder * (1.0 - track));
        diffuseColor.rgb = mix(diffuseColor.rgb, asphalt * paved + gravelC * gravel + trackC * track, carriage);

        roadW = max(carriage * (1.0 - track * (1.0 - trackDirt)), shoulder * 0.5);
        roadPaved = paved;
        roadRough = mix(mix(0.95, 0.35, hole) * gravel + 0.93 * track + (0.88 - wheels * 0.1 - paint * 0.12) * paved, 0.95, shoulder * (1.0 - carriage));
      }`;
