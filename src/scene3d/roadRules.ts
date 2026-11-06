import { LEIPALINGIS_ROADS, ROAD_CROSSINGS, type MapRoad } from '../game/maps/leipalingis';
import { SETTLEMENTS, settlementAt, type Settlement } from '../game/maps/settlements';
import { roadEdgeAt, roadHalfWidth, roadKind } from './roadMaterial';

/**
 * Traffic control of the campaign's roads, by the Lithuanian road traffic
 * rules (Kelių eismo taisyklės, KET). Visual only: units are not bound by it.
 *
 * - Junctions where roads of different standing meet are priority junctions:
 *   the main road (the higher class running on through) carries 201
 *   "Pagrindinis kelias", every public side road 203 "Duoti kelią" with the
 *   give-way triangles (marking 1.12) across its lane, or 204 "STOP" with a
 *   stop line (1.11) where a side road joins a main state road in open
 *   country. Field and forest tracks get no signs: whoever leaves a dirt road
 *   gives way by the rules anyway. Junctions of equal minor roads go
 *   unsigned (the right-hand rule).
 * - Main roads are warned of side-road junctions and roundabouts ahead,
 *   and their centre line turns continuous (1.1) before every junction and
 *   pedestrian crossing.
 * - Seirijai's market square is a roundabout (round sign plus 203 at every
 *   entry), Leipalingis's central crossroads is controlled by traffic lights
 *   (a light and a stop line on every approach, crossings marked for signals,
 *   1.13.3).
 * - Town centres have zebra crossings (1.13) with 533 "Pėsčiųjų perėja" on
 *   both sides.
 * - Every public road entering a town or village passes its white name sign
 *   (550, settlement rules and 50 km/h begin) and, leaving, its end sign;
 *   hamlets have the blue name-only sign (612). Main roads drop to 70 km/h
 *   before the larger settlements.
 * Signs stand on the right of the road for the traffic they face (Lithuania
 * drives on the right), on the verge, clear of the carriageway.
 */

type Pt = [number, number];

export type SignType =
  | 'main-road' | 'give-way' | 'stop' | 'roundabout' | 'crossing'
  | 'warn-junction' | 'warn-roundabout' | 'warn-signals' | 'warn-crossing'
  | 'speed-70' | 'town-start' | 'town-end' | 'place-name';
/** A sign post: where it stands (cells), which way its face looks (radians, atan2 of the direction towards the drivers it is for), its plates from the top. */
export interface SignPost { x: number; y: number; facing: number; plates: { type: SignType; text?: string }[] }
export type MarkingType = 'zebra' | 'signal-crossing' | 'stop-line' | 'give-way';
/** A painted marking: centre (cells), the road's direction there, its size along and across the road (cells). */
export interface Marking { type: MarkingType; x: number; y: number; angle: number; along: number; across: number }
/** A traffic light facing one approach; lights of a group show the same colour. */
export interface SignalHead { x: number; y: number; facing: number; group: 0 | 1; junction: number }
export interface Roundabout { x: number; y: number; ring: number; hw: number; island: number }
export interface Leg { road: MapRoad; rank: number; hw: number; dir: Pt; path: Pt[] }
export interface Junction { id: number; x: number; y: number; legs: Leg[]; main: Leg[]; control: 'priority' | 'equal' | 'roundabout' | 'signals'; settlement?: Settlement }
export interface TrafficPlan {
  junctions: Junction[]; posts: SignPost[]; markings: Marking[]; signals: SignalHead[]; roundabouts: Roundabout[];
  /** Where marked roads' centre lines run continuous (before junctions and crossings). */
  solidLines: { x: number; y: number; r: number }[];
}

/** A road's standing at a junction: the main road is the one ranked highest. */
export function roadRank(road: MapRoad): number {
  const c = road.class, link = c.endsWith('_link') ? .1 : 0;
  if (c.startsWith('primary')) return 5 - link;
  if (c.startsWith('secondary')) return 4 - link;
  if (c.startsWith('tertiary')) return road.paved ? 3 : 2.8;
  if (c === 'unclassified') return road.paved ? 2.5 : 2;
  if (c === 'residential') return road.paved ? 1.5 : 1.2;
  return .5; // farm and forest tracks
}
const isTrack = (road: MapRoad) => road.class === 'track';

// Distances, in cells (one cell is about 12 m).
/** Signs stand this far off the carriageway's edge, on the verge. */
const VERGE = .17;
/** A crossing is this long (4 m) and starts this far beyond the crossed road's edge. */
const CROSSING_LENGTH = .34, CROSSING_GAP = .28;
/** Warning signs this far ahead of the junction: 50-100 m in settlements, 150-300 m in open country (shortened to the map). */
const WARN_IN_TOWN = 5, WARN_OUTSIDE = 9;
/** Speed limit before the larger settlements, this far ahead of the name sign. */
const SPEED_AHEAD = 7;

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (v: Pt) => Math.hypot(v[0], v[1]);
const unit = (v: Pt): Pt => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
/** The right-hand side for a driver heading along `d` (x east, y south). */
const rightOf = (d: Pt): Pt => [-d[1], d[0]];

/** The point at arc length `s` along a path, and the path's direction there. */
function along(path: Pt[], s: number): { p: Pt; dir: Pt } {
  let left = s;
  for (let i = 1; i < path.length; i++) {
    const seg = sub(path[i], path[i - 1]), l = len(seg);
    if (l < 1e-9) continue;
    if (left <= l || i === path.length - 1) {
      const t = Math.min(1, left / l), d = unit(seg);
      return { p: [path[i - 1][0] + seg[0] * t, path[i - 1][1] + seg[1] * t], dir: d };
    }
    left -= l;
  }
  return { p: path[0], dir: [1, 0] };
}
const pathLength = (path: Pt[]) => path.slice(1).reduce((n, p, i) => n + len(sub(p, path[i])), 0);

/** Distance from a point to a polyline. */
function distToPath(p: Pt, path: Pt[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], v = sub(path[i], a), l2 = dot(v, v) || 1;
    const t = Math.max(0, Math.min(1, dot(sub(p, a), v) / l2));
    best = Math.min(best, len(sub(p, [a[0] + v[0] * t, a[1] + v[1] * t])));
  }
  return best;
}

/** Whether a point is on, or right at the edge of, any road's carriageway. */
const onAnyRoad = (p: Pt) => roadEdgeAt(p[0], p[1], 1.5) > -.06;

/** Junctions: points where two or more roads share a vertex and at least three legs meet. */
function findJunctions(roads: MapRoad[]): Junction[] {
  const at = new Map<string, { p: Pt; road: MapRoad; i: number }[]>();
  for (const road of roads) road.points.forEach((q, i) => {
    const k = `${Math.round(q[0] * 10)},${Math.round(q[1] * 10)}`;
    at.set(k, [...(at.get(k) ?? []), { p: [q[0], q[1]], road, i }]);
  });
  // Road ends, to follow a road on into its next piece (the map splits roads at every junction).
  const ends = new Map<string, { road: MapRoad; atStart: boolean }[]>();
  const key = (q: number[]) => `${Math.round(q[0] * 10)},${Math.round(q[1] * 10)}`;
  for (const road of roads) for (const atStart of [true, false]) {
    const k = key(atStart ? road.points[0] : road.points[road.points.length - 1]);
    ends.set(k, [...(ends.get(k) ?? []), { road, atStart }]);
  }
  /** A leg's path on from its piece's end along the same road, up to about 12 cells. */
  const extend = (path: Pt[], road: MapRoad) => {
    let current = road;
    for (let guard = 0; guard < 8 && pathLength(path) < 12; guard++) {
      const last = path[path.length - 1], dir = unit(sub(last, path[path.length - 2]));
      const next = (ends.get(key(last)) ?? []).find(e => e.road !== current && e.road.class === current.class
        && dot(unit(sub(e.atStart ? e.road.points[1] as Pt : e.road.points[e.road.points.length - 2] as Pt, last)), dir) > .3);
      if (!next) break;
      const pts = next.atStart ? next.road.points : [...next.road.points].reverse();
      for (const q of pts.slice(1)) path.push([q[0], q[1]]);
      current = next.road;
    }
    return path;
  };
  const junctions: Junction[] = [];
  for (const list of at.values()) {
    if (new Set(list.map(e => e.road)).size < 2) continue;
    const p = list[0].p, legs: Leg[] = [];
    for (const { road, i } of list) for (const step of [-1, 1]) {
      let path: Pt[] = [p];
      for (let j = i + step; j >= 0 && j < road.points.length; j += step) path.push([road.points[j][0], road.points[j][1]]);
      if (path.length < 2) continue;
      path = extend(path, road);
      const dir = unit(sub(along(path, Math.min(.8, pathLength(path))).p, p));
      // The same road listed twice (overlapping pieces): one leg.
      if (legs.some(l => l.road.class === road.class && dot(l.dir, dir) > .985)) continue;
      legs.push({ road, rank: roadRank(road), hw: roadHalfWidth(road), dir, path });
    }
    if (legs.length < 3) continue;
    // The main road: the two highest-ranked legs (a paved road outranks a dirt one, a state
    // road a local one); between legs of the same standing, the pair running on through.
    let main: Leg[] = [], best = -Infinity;
    for (let a = 0; a < legs.length; a++) for (let b = a + 1; b < legs.length; b++) {
      const through = dot(legs[a].dir, legs[b].dir) < -.35;
      const score = (legs[a].rank + legs[b].rank) * 100 + (through ? 5 : 0) - dot(legs[a].dir, legs[b].dir);
      if (score > best) { best = score; main = [legs[a], legs[b]]; }
    }
    const minor = legs.filter(l => !main.includes(l));
    const equal = legs.every(l => Math.abs(l.rank - legs[0].rank) < .05) && legs[0].rank < 2.5;
    const control = equal || main.length < 2 || minor.every(l => isTrack(l.road)) && Math.min(...main.map(l => l.rank)) < 2.5 ? 'equal' : 'priority';
    junctions.push({ id: junctions.length, x: p[0], y: p[1], legs, main, control, settlement: settlementAt(p[0], p[1]) });
  }
  return junctions;
}

/** The town-centre junction of a large settlement: the busiest one nearest its centre. */
function centreJunction(junctions: Junction[], id: Settlement['id']) {
  const s = SETTLEMENTS.find(t => t.id === id);
  if (!s) return undefined;
  const near = junctions.filter(j => j.settlement?.id === id && Math.hypot((j.x - s.x) / s.rx, (j.y - s.y) / s.ry) < .4
    && Math.max(...j.legs.map(l => l.rank)) >= 2.5);
  return near.sort((a, b) => b.legs.length - a.legs.length || Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
}

const onBridge = (p: Pt) => ROAD_CROSSINGS.some(c => distToPath(p, c.path as Pt[]) < c.width / 2 + .45);

/** Build the plan for a road network (memoised for the campaign map). */
export function planTraffic(roads: MapRoad[] = LEIPALINGIS_ROADS): TrafficPlan {
  const junctions = findJunctions(roads);
  const posts: SignPost[] = [], markings: Marking[] = [], signals: SignalHead[] = [], roundabouts: Roundabout[] = [];
  const solidLines: TrafficPlan['solidLines'] = [];
  const signals0 = centreJunction(junctions, 'leipalingis'), ring0 = centreJunction(junctions, 'seirijai');
  if (signals0) signals0.control = 'signals';
  if (ring0) ring0.control = 'roundabout';

  /**
   * A post on the right of an approach leg, `s` cells out from the junction,
   * facing the drivers coming in. Never on a carriageway (where roads fan out
   * close together it moves a little further out) nor on a bridge deck.
   */
  const postOn = (leg: Leg, s: number, plates: SignPost['plates']) => {
    for (const extra of [0, .25, .5, .8]) {
      if (s + extra > pathLength(leg.path) - .05) return;
      const { p, dir } = along(leg.path, s + extra), inbound: Pt = [-dir[0], -dir[1]], r = rightOf(inbound), off = leg.hw + VERGE;
      const at: Pt = [p[0] + r[0] * off, p[1] + r[1] * off];
      if (onAnyRoad(at) || onBridge(at)) continue;
      posts.push({ x: at[0], y: at[1], facing: Math.atan2(dir[1], dir[0]), plates });
      return;
    }
  };
  /** A marking across one approach: the incoming half of a two-lane road, all of a narrow one. */
  const across = (leg: Leg, s: number, type: MarkingType, length: number) => {
    const { p, dir } = along(leg.path, s), inbound: Pt = [-dir[0], -dir[1]], r = rightOf(inbound);
    const twoLanes = roadKind(leg.road) === 4, w = twoLanes ? leg.hw : leg.hw * 2, o = twoLanes ? leg.hw / 2 : 0;
    markings.push({ type, x: p[0] + r[0] * o, y: p[1] + r[1] * o, angle: Math.atan2(dir[1], dir[0]), along: length, across: w - .02 });
  };
  /** A crossing over a leg, its signs on both sides facing both ways. */
  const crossingOn = (leg: Leg, s: number, signalled: boolean) => {
    const { p, dir } = along(leg.path, s);
    markings.push({ type: signalled ? 'signal-crossing' : 'zebra', x: p[0], y: p[1], angle: Math.atan2(dir[1], dir[0]), along: CROSSING_LENGTH, across: leg.hw * 2 - .02 });
    solidLines.push({ x: p[0], y: p[1], r: 1.6 });
    for (const sign of [1, -1]) {
      // For drivers coming in (towards the junction) and going out: each sees one on their right,
      // by the crossing (a little before it where another road runs close by).
      const face: Pt = sign > 0 ? dir : [-dir[0], -dir[1]], r = rightOf([-face[0], -face[1]]), off = leg.hw + VERGE;
      for (const shift of [0, .15, .3, .45]) {
        const at: Pt = [p[0] + r[0] * off + face[0] * shift, p[1] + r[1] * off + face[1] * shift];
        if (onAnyRoad(at) || onBridge(at)) continue;
        posts.push({ x: at[0], y: at[1], facing: Math.atan2(face[1], face[0]), plates: [{ type: 'crossing' }] });
        break;
      }
    }
  };
  /** How far from a junction's centre its other roads' edges reach along a leg. */
  const mouth = (j: Junction, leg: Leg) => Math.max(...j.legs.filter(l => l !== leg).map(l => l.hw)) + .1;

  for (const j of junctions) {
    const inTown = !!j.settlement && j.settlement.size !== 'hamlet';
    const publicLegs = j.legs.filter(l => !isTrack(l.road));
    if (j.control === 'roundabout') {
      const ring = 1.05, hw = .27, island = ring - hw - .03;
      roundabouts.push({ x: j.x, y: j.y, ring, hw, island });
      solidLines.push({ x: j.x, y: j.y, r: ring + 2 });
      for (const leg of publicLegs) {
        const entry = ring + hw + .05;
        across(leg, entry + .04, 'give-way', .06);
        postOn(leg, entry + .12, [{ type: 'roundabout' }, { type: 'give-way' }]);
        if (roadKind(leg.road) >= 3) crossingOn(leg, entry + CROSSING_GAP + CROSSING_LENGTH / 2 + .1, false);
        postOn(leg, WARN_IN_TOWN, [{ type: 'warn-roundabout' }]);
      }
      continue;
    }
    if (j.control === 'signals') {
      solidLines.push({ x: j.x, y: j.y, r: 2.4 });
      for (const leg of publicLegs) {
        const edge = mouth(j, leg), cross = edge + CROSSING_GAP + CROSSING_LENGTH / 2;
        if (roadKind(leg.road) >= 3) crossingOn(leg, cross, true);
        const stopAt = edge + CROSSING_GAP + CROSSING_LENGTH + .12;
        across(leg, stopAt, 'stop-line', .035);
        // The light on the right of the approach at its stop line; the two roads take turns.
        const { p, dir } = along(leg.path, stopAt + .05), r = rightOf([-dir[0], -dir[1]]), off = leg.hw + VERGE;
        const group: 0 | 1 = j.main.includes(leg) ? 0 : 1;
        signals.push({ x: p[0] + r[0] * off, y: p[1] + r[1] * off, facing: Math.atan2(dir[1], dir[0]), group, junction: j.id });
        if (j.main.includes(leg)) postOn(leg, WARN_IN_TOWN, [{ type: 'warn-signals' }]);
      }
      continue;
    }
    if (j.control !== 'priority') continue;
    const minors = j.legs.filter(l => !j.main.includes(l) && !isTrack(l.road));
    if (!minors.length) continue;
    const mainRank = Math.min(...j.main.map(l => l.rank));
    if (roadKind(j.main[0].road) === 4) solidLines.push({ x: j.x, y: j.y, r: 2.2 });
    for (const leg of j.main) {
      postOn(leg, mouth(j, leg) + .55, [{ type: 'main-road' }]);
      // Warned of the side road ahead where the main road is paved and the side road is too.
      if (roadKind(leg.road) >= 3 && minors.some(m => roadKind(m.road) >= 2)) postOn(leg, inTown ? WARN_IN_TOWN : WARN_OUTSIDE, [{ type: 'warn-junction' }]);
    }
    for (const leg of minors) {
      // STOP where a side road joins a main state road out in the country; elsewhere give way.
      const stop = !inTown && mainRank >= 4.9 && leg.rank >= 2;
      const edge = mouth(j, leg), paved = roadKind(leg.road) >= 3;
      if (paved) across(leg, edge + .06, stop ? 'stop-line' : 'give-way', stop ? .035 : .06);
      postOn(leg, edge + .16, [{ type: stop ? 'stop' : 'give-way' }]);
    }
  }

  // Zebra crossings in the centres of towns, on their busiest paved road, clear of junctions.
  for (const s of SETTLEMENTS) {
    if (s.size !== 'centre' && s.size !== 'town') continue;
    let best: { road: MapRoad; d: number; s: number } | null = null;
    const nearJunctions = junctions.filter(j => Math.abs(j.x - s.x) < s.rx && Math.abs(j.y - s.y) < s.ry);
    for (const road of roads) {
      if (roadKind(road) < 3 || !road.points.some(q => Math.abs(q[0] - s.x) < s.rx && Math.abs(q[1] - s.y) < s.ry)) continue;
      const path = road.points as Pt[], total = pathLength(path);
      for (let t = .5; t < total - .5; t += .25) {
        const { p } = along(path, t);
        const d = Math.hypot(p[0] - s.x, p[1] - s.y);
        if (Math.hypot((p[0] - s.x) / s.rx, (p[1] - s.y) / s.ry) > .5) continue;
        // Clear of junctions, and well clear of a roundabout's or traffic lights' own crossings.
        if (nearJunctions.some(j => Math.hypot(j.x - p[0], j.y - p[1]) < (j.control === 'signals' || j.control === 'roundabout' ? 3.2 : 1.4)) || onBridge(p)) continue;
        // A verge on both sides for its signs (not where another road runs alongside).
        const { dir } = along(path, t), r = rightOf(dir), off = roadHalfWidth(road) + VERGE;
        if (onAnyRoad([p[0] + r[0] * off, p[1] + r[1] * off]) || onAnyRoad([p[0] - r[0] * off, p[1] - r[1] * off])) continue;
        if (!best || d + (5 - roadRank(road)) * 2 < best.d) best = { road, d: d + (5 - roadRank(road)) * 2, s: t };
      }
    }
    if (!best) continue;
    const path = best.road.points as Pt[];
    crossingOn({ road: best.road, rank: roadRank(best.road), hw: roadHalfWidth(best.road), dir: [1, 0], path }, best.s, false);
  }

  // Settlement signs where public roads cross a settlement's edge; 70 km/h before the larger ones.
  for (const road of roads) {
    if (isTrack(road) || road.class.endsWith('_link')) continue;
    const path = road.points as Pt[];
    for (let i = 1; i < path.length; i++) for (const s of SETTLEMENTS) {
      const f = (q: Pt) => ((q[0] - s.x) / s.rx) ** 2 + ((q[1] - s.y) / s.ry) ** 2 - 1;
      const a = path[i - 1], b = path[i], fa = f(a), fb = f(b);
      if (fa * fb > 0 || fa === fb) continue;
      const t = fa / (fa - fb), p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (onBridge(p) || junctions.some(j => Math.hypot(j.x - p[0], j.y - p[1]) < .8)) continue;
      // Inbound: the direction from outside the settlement to inside.
      const inbound = unit(fa > 0 ? sub(b, a) : sub(a, b)), hw = roadHalfWidth(road);
      const sign = (face: Pt, plates: SignPost['plates']) => {
        // Where another road runs close by, a little further along the road (away from the town for its name, into it for its end).
        const r = rightOf([-face[0], -face[1]]);
        for (const shift of [0, .25, .5, .8]) {
          const at: Pt = [p[0] + r[0] * (hw + VERGE) + face[0] * shift, p[1] + r[1] * (hw + VERGE) + face[1] * shift];
          if (onAnyRoad(at) || onBridge(at)) continue;
          posts.push({ x: at[0], y: at[1], facing: Math.atan2(face[1], face[0]), plates });
          return;
        }
      };
      const outward: Pt = [-inbound[0], -inbound[1]];
      if (s.size === 'hamlet') { sign(outward, [{ type: 'place-name', text: s.name }]); continue; }
      sign(outward, [{ type: 'town-start', text: s.name }]);
      sign(inbound, [{ type: 'town-end', text: s.name }]);
      // Main roads slow to 70 km/h ahead of a town (the limit holds until the name sign).
      if (roadRank(road) >= 3 && (s.size === 'centre' || s.size === 'town')) {
        const back: Pt = [p[0] + outward[0] * SPEED_AHEAD, p[1] + outward[1] * SPEED_AHEAD];
        if (distToPath(back, path) < .3 && f(back) > 0) {
          const r = rightOf(inbound), at: Pt = [back[0] + r[0] * (hw + VERGE), back[1] + r[1] * (hw + VERGE)];
          if (!onAnyRoad(at) && !onBridge(at)) posts.push({ x: at[0], y: at[1], facing: Math.atan2(outward[1], outward[0]), plates: [{ type: 'speed-70' }] });
        }
      }
    }
  }
  return { junctions, posts, markings, signals, roundabouts, solidLines };
}

let campaignPlan: TrafficPlan | null = null;
/** The campaign map's traffic plan (built once). */
export function trafficPlan(): TrafficPlan {
  return campaignPlan ??= planTraffic(LEIPALINGIS_ROADS);
}
/** The roundabouts once the plan is built, none before (the plan itself asks where roads are while it is built). */
export const builtRoundabouts = () => campaignPlan?.roundabouts ?? [];
