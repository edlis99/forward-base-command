import { LEIPALINGIS_ROADS, type MapRoad } from '../game/maps/leipalingis';
import { SETTLEMENTS } from '../game/maps/settlements';
import type { TerrainCell } from '../game/types';
import { roadEdgeAt, roadHalfWidth, roadKind } from './roadMaterial';
import { trafficPlan } from './roadRules';
import { hash2, shoreWetness } from './terrainHeight';

/**
 * What stands along the roads of a Lithuanian countryside, apart from the signs: wooden
 * utility poles with their wires along every paved road (and the village streets), street
 * lamps in the towns, and wayside crosses at rural crossroads. Visual only: the plan reads
 * the roads and the terrain, and units are not bound by it.
 */

type Pt = [number, number];
export interface Pole { x: number; y: number; /** The way its crossarm runs, across the road (unit vector). */ ax: number; ay: number; /** The kind of road it stands beside (see roadKind). */ kind: number }
/** A wire span between two poles (indices into `poles`). */
export interface Span { a: number; b: number }
export interface Lamp { x: number; y: number; /** The way its arm reaches, over the road (unit vector). */ dx: number; dy: number }
export interface Cross { x: number; y: number; /** Which way it faces (radians). */ angle: number }
export interface RoadsidePlan { poles: Pole[]; spans: Span[]; lamps: Lamp[]; crosses: Cross[] }

// Distances in cells (one cell is about 12 m).
/** Poles 48 m apart, 5 m off the carriageway's edge (beyond the signs, which stand at 2 m). */
export const POLE_SPACING = 4, POLE_OFFSET = .42;
/** Street lamps 26 m apart, 3.4 m off the edge, on the other side from the poles. */
export const LAMP_SPACING = 2.2, LAMP_OFFSET = .28;
/** The crosses stand this far from a crossroads' centre beyond its roads' edges, and no two nearer than 30 cells (360 m). */
const CROSS_OFFSET = .85, CROSS_SPACING = 30;

interface Chain { pts: Pt[]; hw: number[]; kind: number }

/**
 * The roads joined end to end where just two meet (the map splits a road at every junction), so a
 * line of poles runs on across them and its wires stay unbroken.
 */
function chainsOf(roads: MapRoad[]): Chain[] {
  const key = (p: number[]) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const ends = new Map<string, { i: number; atStart: boolean }[]>();
  roads.forEach((r, i) => {
    if (r.points.length < 2) return;
    for (const atStart of [true, false]) {
      const k = key(atStart ? r.points[0] : r.points[r.points.length - 1]);
      ends.set(k, [...(ends.get(k) ?? []), { i, atStart }]);
    }
  });
  /** The way a road runs from one of its ends into it. */
  const inward = (r: MapRoad, atStart: boolean): Pt => {
    const a = atStart ? r.points[0] : r.points[r.points.length - 1], b = atStart ? r.points[1] : r.points[r.points.length - 2];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const used = new Set<number>(), out: Chain[] = [];
  for (let i = 0; i < roads.length; i++) {
    if (used.has(i) || roads[i].points.length < 2) continue;
    used.add(i);
    const kind = roadKind(roads[i]);
    let pts: Pt[] = roads[i].points.map(p => [p[0], p[1]]), hw = pts.map(() => roadHalfWidth(roads[i]));
    for (const front of [false, true]) {
      for (let guard = 0; guard < 600; guard++) {
        const tip = front ? pts[0] : pts[pts.length - 1], next = front ? pts[1] : pts[pts.length - 2];
        const here = ends.get(key(tip)) ?? [];
        // A plain continuation: exactly one other road's end here (two ends in all), of the same kind, running on.
        if (here.length !== 2) break;
        const other = here.find(e => !used.has(e.i) && roadKind(roads[e.i]) === kind);
        if (!other) break;
        const away: Pt = [tip[0] - next[0], tip[1] - next[1]], l = Math.hypot(away[0], away[1]) || 1, dir = inward(roads[other.i], other.atStart);
        if ((away[0] * dir[0] + away[1] * dir[1]) / l < .8) break;
        used.add(other.i);
        const road = roads[other.i], ordered: Pt[] = (other.atStart ? road.points : [...road.points].reverse()).map(p => [p[0], p[1]]), width = roadHalfWidth(road);
        if (front) { pts = [...ordered.slice(1).reverse(), ...pts]; hw = [...ordered.slice(1).map(() => width), ...hw]; }
        else { pts = [...pts, ...ordered.slice(1)]; hw = [...hw, ...ordered.slice(1).map(() => width)]; }
      }
    }
    out.push({ pts, hw, kind });
  }
  return out;
}

/** A chain's points by distance along it. */
function sampler(chain: Chain) {
  const lengths = [0];
  for (let i = 1; i < chain.pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(chain.pts[i][0] - chain.pts[i - 1][0], chain.pts[i][1] - chain.pts[i - 1][1]));
  const total = lengths[lengths.length - 1];
  const at = (s: number) => {
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < s) i++;
    const a = chain.pts[i - 1], b = chain.pts[i], l = lengths[i] - lengths[i - 1] || 1, t = Math.max(0, Math.min(1, (s - lengths[i - 1]) / l));
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as Pt, dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as Pt, hw: chain.hw[i - 1] + (chain.hw[i] - chain.hw[i - 1]) * t };
  };
  return { total, at };
}

/** How far into a settlement a point lies (0 at its centre, 1 at the edge of its ellipse), or Infinity outside every one. */
function settlementDepth(x: number, y: number) {
  let best = Infinity;
  for (const s of SETTLEMENTS) best = Math.min(best, Math.hypot((x - s.x) / s.rx, (y - s.y) / s.ry));
  return best;
}

/** A spatial hash of points, to ask what stands near a spot. */
class Spots {
  private cells = new Map<number, Pt[]>();
  add(x: number, y: number) { const k = Math.floor(y) * 4096 + Math.floor(x); this.cells.set(k, [...(this.cells.get(k) ?? []), [x, y]]); }
  near(x: number, y: number, r: number) {
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++)
      for (const p of this.cells.get(cy * 4096 + cx) ?? []) if (Math.hypot(p[0] - x, p[1] - y) < r) return true;
    return false;
  }
}

/** A spot where something may stand: off every carriageway and bridge, on dry open ground, not in a building. */
export function roadsideClear(terrain: TerrainCell[][], x: number, y: number) {
  const cell = terrain[Math.floor(y)]?.[Math.floor(x)];
  if (!cell || (cell.type !== 'open' && cell.type !== 'tall_grass' && cell.type !== 'gravel') || cell.prop || cell.buildingKind || cell.yard === 'courtyard') return false;
  if (roadEdgeAt(x, y, 1.2) > -.2) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (terrain[Math.floor(y) + dy]?.[Math.floor(x) + dx]?.bridge) return false;
  return shoreWetness(terrain, x, y, .7) < .12;
}

export function planRoadside(terrain: TerrainCell[][], roads: MapRoad[] = LEIPALINGIS_ROADS): RoadsidePlan {
  const traffic = trafficPlan(), chains = chainsOf(roads);
  const poles: Pole[] = [], spans: Span[] = [], lamps: Lamp[] = [], crosses: Cross[] = [];
  const poleSpots = new Spots(), lampSpots = new Spots(), furniture = new Spots();
  for (const post of traffic.posts) furniture.add(post.x, post.y);
  for (const light of traffic.signals) furniture.add(light.x, light.y);

  // ---- Utility poles, on the left of each chain's direction, with wires between them ----
  for (const chain of chains) {
    // Paved roads all the way, gravel streets only inside a settlement; never farm tracks.
    if (chain.kind < 2) continue;
    const { total, at } = sampler(chain);
    let previous = -1, previousAt = -Infinity;
    for (let s = hash2(chain.pts[0][0] * 3.1, chain.pts[0][1] * 1.7) * POLE_SPACING; s < total; s += POLE_SPACING) {
      let placed = false;
      // A spot taken (a sign, a house, the water) moves the pole along a little, so the line keeps its rhythm.
      for (const shift of [0, .5, -.5, 1, -1]) {
        const along = s + shift;
        if (along < .3 || along > total - .3) continue;
        const { p, dir, hw } = at(along), nx = -dir[1], ny = dir[0], x = p[0] + nx * (hw + POLE_OFFSET), y = p[1] + ny * (hw + POLE_OFFSET);
        if (chain.kind === 2 && settlementDepth(x, y) > 1.1) continue;
        if (!roadsideClear(terrain, x, y) || poleSpots.near(x, y, 1) || furniture.near(x, y, .7)) continue;
        const index = poles.push({ x, y, ax: nx, ay: ny, kind: chain.kind }) - 1;
        poleSpots.add(x, y);
        if (previous >= 0 && along - previousAt <= POLE_SPACING * 1.6) spans.push({ a: previous, b: index });
        previous = index; previousAt = along; placed = true;
        break;
      }
      if (!placed) previous = -1; // a gap: the wire breaks
    }
  }

  // ---- Street lamps in the towns, on the right of each chain (opposite to the poles) ----
  for (const chain of chains) {
    if (chain.kind < 3) continue;
    const { total, at } = sampler(chain);
    for (let s = LAMP_SPACING / 2 + hash2(chain.pts[0][1] * 2.3, chain.pts[0][0] * 1.3) * LAMP_SPACING; s < total; s += LAMP_SPACING) {
      const { p, dir, hw } = at(s), nx = -dir[1], ny = dir[0], x = p[0] - nx * (hw + LAMP_OFFSET), y = p[1] - ny * (hw + LAMP_OFFSET);
      const town = SETTLEMENTS.find(t => (t.size === 'centre' || t.size === 'town') && Math.hypot((x - t.x) / t.rx, (y - t.y) / t.ry) < .75);
      if (!town || !roadsideClear(terrain, x, y) || lampSpots.near(x, y, 1.5) || poleSpots.near(x, y, .8) || furniture.near(x, y, .7)) continue;
      lamps.push({ x, y, dx: nx, dy: ny });
      lampSpots.add(x, y);
    }
  }

  // ---- Wayside crosses at some rural crossroads, on the corner between two roads ----
  for (const j of traffic.junctions) {
    if (j.legs.length < 3 || j.control === 'roundabout' || j.control === 'signals') continue;
    const depth = settlementDepth(j.x, j.y);
    if (depth < 1.3 || hash2(j.x * 7.1 + 3, j.y * 3.3 + 5) > .3) continue;
    const legs = j.legs.filter(l => roadKind(l.road) >= 2);
    if (legs.length < 3) continue;
    // The widest gap between neighbouring legs: the corner with most room.
    const angles = legs.map(l => Math.atan2(l.dir[1], l.dir[0])).sort((a, b) => a - b);
    let best = { gap: -1, mid: 0 };
    angles.forEach((a, i) => {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2, gap = next - a;
      if (gap > best.gap) best = { gap, mid: a + gap / 2 };
    });
    const reach = Math.max(...legs.map(l => l.hw)) + CROSS_OFFSET, x = j.x + Math.cos(best.mid) * reach, y = j.y + Math.sin(best.mid) * reach;
    if (!roadsideClear(terrain, x, y) || furniture.near(x, y, .9) || poleSpots.near(x, y, .7) || crosses.some(c => Math.hypot(c.x - x, c.y - y) < CROSS_SPACING)) continue;
    // In the open, where tree crowns do not hide it.
    let wooded = false;
    for (let dy = -2; dy <= 2 && !wooded; dy++) for (let dx = -2; dx <= 2; dx++) {
      const t = terrain[Math.floor(y) + dy]?.[Math.floor(x) + dx]?.type;
      if (t === 'forest' || t === 'hedgerow') { wooded = true; break; }
    }
    if (wooded) continue;
    // It faces the crossroads.
    crosses.push({ x, y, angle: Math.atan2(j.y - y, j.x - x) });
    furniture.add(x, y);
  }
  return { poles, spans, lamps, crosses };
}

const cache = new WeakMap<TerrainCell[][], RoadsidePlan>();
/** The campaign map's roadside plan, built once per terrain. */
export function roadsidePlan(terrain: TerrainCell[][]): RoadsidePlan {
  let plan = cache.get(terrain);
  if (!plan) { plan = planRoadside(terrain); cache.set(terrain, plan); }
  return plan;
}
