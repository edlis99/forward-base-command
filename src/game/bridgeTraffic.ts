import { GameState, Position, TerrainCell, Unit } from './types';
import { CELL_SIZE } from './constants';
import { BridgeSpan, crossesRailing, deckLane, deckUnder, isWorldFootprintPassable, spanAxis, spanCoords } from './terrain';
import { spacingRadius } from './playerSquads';

/**
 * Rule M15: vehicles keep to a bridge's lanes. A narrow bridge is one lane,
 * a road bridge with room for a tank each way inside its railings two (keep
 * right). On a deck, or lining up for it, a vehicle drives its lane and keeps
 * its interval behind the vehicle ahead, instead of steering round it, being
 * pushed against the railings or backing away from it. Before a one-lane deck
 * it pulls over while traffic comes the other way: vehicles already over it,
 * or nearer to it, go first.
 */
export interface Crossing {
  span: BridgeSpan;
  /** +1 driving from the span's `a` end towards `b`, -1 the other way, 0 parked on the deck. */
  dir: 1 | -1 | 0;
  /** Progress over the crossing in cells, from the entrance (negative while still before it). */
  s: number;
  onDeck: boolean;
  /** Just driven off the deck, still in line with it: the lane is not yet clear for oncoming traffic. */
  leaving?: boolean;
}

/** How far along its route a vehicle looks for a bridge to line up for (cells). */
const LOOKAHEAD = 6;
/** From here on (cells before the deck; the route's gate is 0.7) a vehicle is committed to its crossing. */
export const COMMITTED = -.9;
/** Lane rules apply from this far before the deck (cells): the column lines up in single file. */
export const LANE_ZONE = 2.5;
/** Cells past a deck's end where a vehicle driving off it still holds the lane (clear of the waiting bays). */
const EXIT_ZONE = 2.2;
/** Before a one-lane deck, vehicles pull over this far to the side (cells) and about a hull length apart. */
const BAY_SIDE = .62, BAY_GAP = 1.05;

const isVehicle = (u: Unit) => u.type === 'tank' || u.type === 'apc';

/** Two lanes where a vehicle fits each way inside the railings (a deck of about 10 m or more), else one. */
export const lanesOf = (span: BridgeSpan) => (deckLane(span) >= .33 ? 2 : 1);
/** Where a vehicle's lane runs, across the deck's centre line (cells): to the right of its travel on two lanes. */
export const laneAcross = (span: BridgeSpan, dir: number) => (lanesOf(span) === 2 ? .2 * Math.sign(dir) : 0);

/** Every crossing on the map with its middle and half length, to skip units far from all of them. */
const spanLists = new WeakMap<TerrainCell[][], { span: BridgeSpan; x: number; y: number; r: number }[]>();
function spansOf(terrain: TerrainCell[][]) {
  let list = spanLists.get(terrain);
  if (!list) {
    const unique = new Set<BridgeSpan>();
    for (const row of terrain) for (const c of row) if (c.bridge) unique.add(c.bridge);
    list = [...unique].map(span => {
      const { ax, ay, ux, uy, L } = spanAxis(span);
      return { span, x: ax + ux * L / 2, y: ay + uy * L / 2, r: L / 2 };
    });
    spanLists.set(terrain, list);
  }
  return list;
}

/** A vehicle's bridge crossing: the deck it is on or just driving off, or the next one on its route within reach. */
export function crossingOf(unit: Unit, state: GameState): Crossing | null {
  const { terrain } = state;
  const gx = unit.pos.x / CELL_SIZE, gy = unit.pos.y / CELL_SIZE;
  const near = spansOf(terrain).filter(s => Math.hypot(gx - s.x, gy - s.y) < s.r + LOOKAHEAD + 1);
  if (!near.length) return null;
  const goal = unit.targetPos;
  const here = deckUnder(terrain, unit.pos.x, unit.pos.y, 0, 2);
  if (here) {
    const c = spanCoords(here, unit.pos.x, unit.pos.y);
    const dir: 1 | -1 | 0 = goal ? (spanCoords(here, goal.x, goal.y).along >= c.along ? 1 : -1) : 0;
    return { span: here, dir, s: dir < 0 ? c.L - c.along : c.along, onDeck: true };
  }
  if (!goal) return null;
  // Driving off a deck, still in line with it.
  for (const { span } of near) {
    const c = spanCoords(span, unit.pos.x, unit.pos.y);
    if (Math.abs(c.across) > deckLane(span) + .25) continue;
    const away = c.along > c.L ? 1 : c.along < 0 ? -1 : 0;
    if (!away || (away > 0 ? c.along - c.L : -c.along) > EXIT_ZONE) continue;
    const dir = spanCoords(span, goal.x, goal.y).along >= c.along ? 1 : -1;
    if (dir === away) return { span, dir, s: dir < 0 ? c.L - c.along : c.along, onDeck: false, leaving: true };
  }
  // The leg of the route that runs over a deck: from the gate on the road
  // before one end to the exit past the other (see alignBridgeCrossings).
  let from: Position = unit.pos, acc = 0;
  for (const p of [goal, ...unit.path]) {
    const span = deckUnder(terrain, (from.x + p.x) / 2, (from.y + p.y) / 2, 0, 2);
    if (span) {
      const a = spanCoords(span, from.x, from.y), b = spanCoords(span, p.x, p.y);
      const dir = b.along >= a.along ? 1 : -1;
      const toEnd = Math.max(0, dir > 0 ? -a.along : a.along - a.L);
      return { span, dir, s: -(acc / CELL_SIZE + toEnd), onDeck: false };
    }
    acc += Math.hypot(p.x - from.x, p.y - from.y);
    if (acc > LOOKAHEAD * CELL_SIZE) break;
    from = p;
  }
  return null;
}

const committed = (c: Crossing) => c.onDeck || !!c.leaving || c.s > COMMITTED;
/** Other vehicles of the side that move with this one (enemies drive through each other's lanes, as elsewhere). */
const traffic = (unit: Unit, state: GameState) =>
  state.units.filter(o => o !== unit && o.alive && !o.insideOf && o.team === unit.team && isVehicle(o));

/**
 * May a vehicle lining up for a one-lane deck drive on? Not while a vehicle
 * comes the other way over it (or stands on it), nor while an oncoming one is
 * nearer to its own end of the deck (the nearer goes first; ties by id).
 */
export function deckFree(unit: Unit, mine: Crossing, state: GameState): boolean {
  if (lanesOf(mine.span) === 2) return true;
  for (const o of traffic(unit, state)) {
    const c = crossingOf(o, state);
    if (!c || c.span !== mine.span || c.dir === mine.dir) continue;
    if (committed(c)) return false;
    if (c.s > -LANE_ZONE && (c.s > mine.s || (c.s === mine.s && o.id < unit.id))) return false;
  }
  return true;
}

/**
 * Share of its speed a vehicle may use on its crossing: it slows to keep its
 * interval behind the vehicle ahead in its lane (on the deck or lining up for
 * it), and stops just behind it. Vehicles pulled over to wait are not in it.
 */
export function laneSpeedFactor(unit: Unit, mine: Crossing, state: GameState): number {
  if (!mine.dir) return 1;
  const { L } = spanAxis(mine.span);
  const two = lanesOf(mine.span) === 2, lane = laneAcross(mine.span, mine.dir);
  let factor = 1;
  for (const o of traffic(unit, state)) {
    if (o.bay) continue;
    let s: number;
    if (deckUnder(state.terrain, o.pos.x, o.pos.y, 0, 2) === mine.span) {
      const at = spanCoords(mine.span, o.pos.x, o.pos.y);
      if (two && Math.abs(at.across - lane) > .25) continue;
      s = mine.dir > 0 ? at.along : L - at.along;
    } else {
      const c = crossingOf(o, state);
      if (!c || c.span !== mine.span || c.dir !== mine.dir) continue;
      s = c.s;
    }
    if (s <= mine.s) continue;
    const gap = (s - mine.s) * CELL_SIZE - (spacingRadius(unit) + spacingRadius(o));
    factor = Math.min(factor, Math.max(0, Math.min(1, gap / (CELL_SIZE * .75))));
  }
  return factor;
}

/** Where a vehicle in a bridge lane steers: a point ahead on its lane, short of its route point. */
export function laneSteer(unit: Unit, mine: Crossing): Position {
  const { ax, ay, ux, uy, L } = spanAxis(mine.span);
  const here = spanCoords(mine.span, unit.pos.x, unit.pos.y).along;
  const goal = unit.targetPos ? spanCoords(mine.span, unit.targetPos.x, unit.targetPos.y).along : here;
  const ahead = mine.dir > 0 ? Math.min(goal, here + 1.2, L + 1) : Math.max(goal, here - 1.2, -1);
  const lane = laneAcross(mine.span, mine.dir);
  return { x: (ax + ux * ahead - uy * lane) * CELL_SIZE, y: (ay + uy * ahead + ux * lane) * CELL_SIZE };
}

/**
 * Is `other` clear of the lane `unit` drives (in the other lane of a two-lane
 * bridge, or pulled over beside a one-lane one)? Hulls are about 0.22 cell
 * wide, so such vehicles pass each other side by side.
 */
export function outOfLane(other: Unit, mine: Crossing): boolean {
  const at = spanCoords(mine.span, other.pos.x, other.pos.y);
  return Math.abs(at.across - laneAcross(mine.span, mine.dir)) > .3;
}

/**
 * Where a vehicle waits for oncoming traffic off a one-lane deck: pulled over
 * beside the road before it, each waiting vehicle about a hull length behind
 * the one in front, all on the same side, so the vehicles coming off the deck
 * drive past. Kept once chosen (unit.bay); null where the roadside is blocked.
 */
export function waitingBay(unit: Unit, mine: Crossing, state: GameState): Position | null {
  if (unit.bay) return unit.bay;
  if (!mine.dir) return null;
  const { ax, ay, ux, uy, L } = spanAxis(mine.span);
  const fx = ux * mine.dir, fy = uy * mine.dir;
  const queued = traffic(unit, state).filter(o => o.bay && crossingOf(o, state)?.span === mine.span).length;
  // Never behind the vehicle (it does not back up), and not right at the deck.
  const s = Math.min(-1.25, Math.max(-1.4 - queued * BAY_GAP, mine.s + .55));
  if (s > mine.s + 1.2) return null;
  const along = mine.dir > 0 ? s : L - s;
  for (const side of [1, -1]) {
    const x = (ax + ux * along - fy * side * BAY_SIDE) * CELL_SIZE, y = (ay + uy * along + fx * side * BAY_SIDE) * CELL_SIZE;
    if (isWorldFootprintPassable(state.terrain, x, y, true) && !deckUnder(state.terrain, x, y, .2, 2)
      && !crossesRailing(state.terrain, unit.pos.x, unit.pos.y, x, y)) {
      unit.bay = { x, y };
      return unit.bay;
    }
  }
  return null;
}
