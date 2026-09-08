import { GameState, Position, Unit, PlayerSquad } from './types';
import { findNearestPassableWorld, isFootprintPassable } from './terrain';
import { setDestination } from './units';

/**
 * SQUAD / FORMATION LAYER (player orders).
 *
 * This module sits ABOVE the existing per-unit pathfinding (units.setDestination
 * -> pathfinding.findPath). It never moves units itself; it only:
 *   1. clusters the selected units into squads,
 *   2. spreads several squads over separate destination areas,
 *   3. generates role-aware formation slots and assigns units to them,
 *   4. maintains squad travel speed / cohesion state read by units.moveUnit.
 *
 * Movement priority (see units.moveUnit): terrain > destination > friendly
 * collision > squad cohesion > perfect formation slot.
 */

// ---------- tuning ----------
const CLUSTER_RADIUS = 150;      // proximity clustering for "one squad"
const SQUAD_GAP = 46;            // lateral gap between neighbouring squad blocks
const RESLOT_INTERVAL = 1.4;     // seconds between slot reassignment passes
const TRAVEL_SPEED_BOOST = 1.12; // squad travels slightly faster than its slowest member
export const ARRIVE_TOLERANCE = 18;

/** Personal spacing radius used by local avoidance. */
export function spacingRadius(u: Unit): number {
  return u.type === 'tank' ? 26 : u.type === 'apc' ? 21 : u.type === 'helicopter' ? 26 : 14;
}

function slotSpacing(u: Unit): number {
  return u.type === 'tank' ? 50 : u.type === 'apc' ? 42 : u.type === 'helicopter' ? 56 : 28;
}

function isVehicle(u: Unit) { return u.type === 'tank' || u.type === 'apc'; }

function centroid(units: Unit[]): Position {
  const n = units.length || 1;
  return {
    x: units.reduce((s, u) => s + u.pos.x, 0) / n,
    y: units.reduce((s, u) => s + u.pos.y, 0) / n,
  };
}

// ---------- clustering ----------
/** Proximity BFS: units already standing together form one squad. */
export function clusterSelected(units: Unit[], radius = CLUSTER_RADIUS): Unit[][] {
  const used = new Set<string>();
  const out: Unit[][] = [];
  for (const seed of units) {
    if (used.has(seed.id)) continue;
    const members = [seed];
    used.add(seed.id);
    for (let i = 0; i < members.length; i++) {
      for (const u of units) {
        if (used.has(u.id)) continue;
        if (Math.hypot(members[i].pos.x - u.pos.x, members[i].pos.y - u.pos.y) <= radius) {
          members.push(u); used.add(u.id);
        }
      }
    }
    out.push(members);
  }
  return out;
}

// ---------- formation slot generation ----------
interface LocalSlot { fwd: number; right: number; row: number; }

/**
 * Role-aware local offsets in squad space (+fwd = toward destination):
 * tanks lead, APCs sit in the middle, infantry echelon behind and to the sides.
 * A single-type selection degrades gracefully into a normal loose block.
 */
function localSlots(
  members: Unit[], compression: number, lateralOf: (u: Unit) => number,
): Map<string, LocalSlot> {
  const slots = new Map<string, LocalSlot>();
  const tanks = members.filter(u => u.type === 'tank');
  const apcs = members.filter(u => u.type === 'apc');
  const inf = members.filter(u => u.type === 'infantry');
  const heli = members.filter(u => u.type === 'helicopter');

  const place = (group: Unit[], baseFwd: number, perRow: number, rowDepth: number) => {
    if (group.length === 0) return baseFwd;
    // Left-to-right by current lateral position => nobody has to cross over.
    const sorted = [...group].sort((a, b) => lateralOf(a) - lateralOf(b));
    const spacing = Math.max(...sorted.map(slotSpacing)) * compression;
    let idx = 0, row = 0, fwd = baseFwd;
    while (idx < sorted.length) {
      const rowUnits = sorted.slice(idx, idx + perRow);
      rowUnits.forEach((u, i) => {
        const lateral = (i - (rowUnits.length - 1) / 2) * spacing;
        slots.set(u.id, { fwd, right: lateral, row });
      });
      idx += perRow;
      row++;
      fwd -= rowDepth * compression;
    }
    return fwd - rowDepth * compression;
  };

  if (tanks.length + apcs.length > 0) {
    let fwd = place(tanks, 62, Math.min(4, Math.max(2, tanks.length)), 52);
    fwd = place(apcs, Math.min(fwd, 6), Math.min(4, Math.max(2, apcs.length)), 46);
    place(inf, Math.min(fwd, -52), 6, 32);
  } else {
    place(inf, 0, Math.min(6, Math.max(3, Math.ceil(Math.sqrt(inf.length * 2)))), 32);
  }

  heli.forEach((u, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    slots.set(u.id, { fwd: 40, right: side * (110 + Math.floor(i / 2) * 60), row: 0 });
  });
  return slots;
}

/** How open the ground is around a point (0..1). Drives formation compression. */
function opennessAt(state: GameState, pos: Position): number {
  const cs = state.cellSize;
  const gx = Math.floor(pos.x / cs), gy = Math.floor(pos.y / cs);
  let ok = 0, total = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    total++;
    if (isFootprintPassable(state.terrain, gx + dx, gy + dy, true, false)) ok++;
  }
  return total ? ok / total : 1;
}

function claimPassable(state: GameState, pos: Position, veh: boolean, claimed: Set<string>): Position {
  const cs = state.cellSize;
  let p = findNearestPassableWorld(state.terrain, pos.x, pos.y, veh, false, 10);
  let bx = Math.floor(p.x / cs), by = Math.floor(p.y / cs);
  if (claimed.has(`${bx},${by}`)) {
    outer: for (let r = 1; r <= 9; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const gx = bx + dx, gy = by + dy;
        if (claimed.has(`${gx},${gy}`) || !isFootprintPassable(state.terrain, gx, gy, veh, false)) continue;
        p = { x: gx * cs + cs / 2, y: gy * cs + cs / 2 };
        bx = gx; by = gy;
        break outer;
      }
    }
  }
  claimed.add(`${bx},${by}`);
  return p;
}

// ---------- order issuing ----------
export interface SquadMoveOptions {
  /** Queue as an extra waypoint instead of replacing the current route. */
  queue?: boolean;
  /** Advance with weapons free. */
  attackMove?: boolean;
  /** Explicit arrival facing (radians). Defaults to army-centre -> destination. */
  facing?: number;
  /** Drag-controlled frontage multiplier (1 = default spacing). */
  widthScale?: number;
}

export interface PlannedSlot { id: string; pos: Position; type: Unit['type']; squad: number; }
export interface PlannedBlock {
  members: Unit[];
  dest: Position;
  facing: number;
  compression: number;
  slots: Record<string, Position>;
  localOffsets: Record<string, Position>;
  order: number;
}

/**
 * Pure planner: works out squad destinations and formation slots for a move
 * command WITHOUT touching unit state. Used both by the placement preview and
 * by issueSquadMove so the preview shows exactly what the order will do.
 */
export function planSquadMove(
  state: GameState, selected: Unit[], dest: Position, opts: SquadMoveOptions = {},
): PlannedBlock[] {
  const ground = selected.filter(u => u.alive && !u.insideOf);
  if (ground.length === 0) return [];

  const armyCenter = centroid(ground);
  const baseFacing = opts.facing ?? Math.atan2(dest.y - armyCenter.y, dest.x - armyCenter.x);
  const fwd = { x: Math.cos(baseFacing), y: Math.sin(baseFacing) };
  const right = { x: -fwd.y, y: fwd.x };
  const widthScale = Math.max(0.6, Math.min(2.2, opts.widthScale ?? 1));

  const groups = clusterSelected(ground);

  // ARMY LEVEL: separate destination area per squad, ordered left-to-right by
  // where the squads currently stand so squads never swap sides.
  const blocks = groups.map((members, i) => {
    const c = centroid(members);
    const lateral = (c.x - armyCenter.x) * right.x + (c.y - armyCenter.y) * right.y;
    const spacing = Math.max(...members.map(slotSpacing));
    const cols = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(members.length * 1.5))));
    return { i, members, lateral, width: cols * spacing * widthScale };
  });
  blocks.sort((a, b) => a.lateral - b.lateral || a.i - b.i);

  const totalWidth = blocks.reduce((s, b) => s + b.width, 0) + SQUAD_GAP * (blocks.length - 1);
  let cursor = -totalWidth / 2;
  const claimed = new Set<string>();
  const out: PlannedBlock[] = [];

  blocks.forEach((block, order) => {
    const center = cursor + block.width / 2;
    cursor += block.width + SQUAD_GAP;
    // Alternate depth so a wide army front reads as echeloned squads.
    const depth = order % 2 === 0 ? 0 : -34;
    const squadDest: Position = {
      x: dest.x + right.x * center + fwd.x * depth,
      y: dest.y + right.y * center + fwd.y * depth,
    };

    const compression = (0.6 + 0.4 * opennessAt(state, squadDest)) * widthScale;
    const squadCenter = centroid(block.members);
    const facing = opts.facing ?? Math.atan2(squadDest.y - squadCenter.y, squadDest.x - squadCenter.x);
    const sf = { x: Math.cos(facing), y: Math.sin(facing) };
    const sr = { x: -sf.y, y: sf.x };
    const lateralOf = (u: Unit) =>
      (u.pos.x - squadCenter.x) * sr.x + (u.pos.y - squadCenter.y) * sr.y;

    const local = localSlots(block.members, compression, lateralOf);
    const slots: Record<string, Position> = {};
    const localOffsets: Record<string, Position> = {};

    for (const u of block.members) {
      const l = local.get(u.id) ?? { fwd: 0, right: 0, row: 0 };
      const raw: Position = {
        x: squadDest.x + sf.x * l.fwd + sr.x * l.right,
        y: squadDest.y + sf.y * l.fwd + sr.y * l.right,
      };
      slots[u.id] = claimPassable(state, raw, isVehicle(u), claimed);
      localOffsets[u.id] = { x: l.fwd, y: l.right };
    }

    // Reassignment pass: swap slots wherever that removes a crossing.
    resolveCrossings(block.members, slots);

    out.push({ members: block.members, dest: squadDest, facing, compression, slots, localOffsets, order });
  });

  return out;
}

/** Flatten a plan into preview markers. */
export function planToSlots(plan: PlannedBlock[]): PlannedSlot[] {
  const out: PlannedSlot[] = [];
  plan.forEach(b => {
    for (const u of b.members) {
      const p = b.slots[u.id];
      if (p) out.push({ id: u.id, pos: p, type: u.type, squad: b.order });
    }
  });
  return out;
}

/**
 * PLAYER MOVE COMMAND -> squads -> squad destinations -> formation slots ->
 * slot assignment -> individual pathfinding.
 */
export function issueSquadMove(
  state: GameState, selected: Unit[], dest: Position, opts: SquadMoveOptions = {},
): PlayerSquad[] {
  const plan = planSquadMove(state, selected, dest, opts);
  const squads: PlayerSquad[] = [];

  for (const block of plan) {
    const id = state.nextMoveGroupId++;
    const groundSpeeds = block.members.filter(u => u.type !== 'helicopter').map(u => u.speed);
    const travelSpeed = (groundSpeeds.length ? Math.min(...groundSpeeds) : Math.min(...block.members.map(u => u.speed))) * TRAVEL_SPEED_BOOST;
    const spread = Math.max(...block.members.map(slotSpacing));
    const squadCenter = centroid(block.members);

    const squad: PlayerSquad = {
      id,
      memberIds: block.members.map(u => u.id),
      dest: block.dest,
      anchor: { ...squadCenter },
      facing: Math.atan2(block.dest.y - squadCenter.y, block.dest.x - squadCenter.x),
      targetFacing: block.facing,
      travelSpeed,
      cohesionRadius: Math.max(90, spread * Math.ceil(Math.sqrt(block.members.length)) * 0.9),
      slots: block.slots,
      localOffsets: block.localOffsets,
      compression: block.compression,
      state: 'moving',
      lastReslot: state.time,
      maxRemaining: 0,
    };
    squads.push(squad);

    for (const u of block.members) {
      u.squadId = id;
      u.groupSpeedCap = travelSpeed;
      u.moveGroupId = id;
      u.settled = false;
      u.attackTarget = null;
      if (opts.queue) {
        u.waypoints.push(block.slots[u.id]);
        if (!u.targetPos && u.path.length === 0) {
          const next = u.waypoints.shift();
          if (next) setDestination(u, state, next);
        }
      } else {
        u.waypoints = [];
        setDestination(u, state, block.slots[u.id]);
      }
      u.order = opts.attackMove ? 'attack_move' : 'move';
    }
  }

  // Drop squads whose members were all re-tasked into the new squads.
  const live = new Map(state.units.map(u => [u.id, u]));
  state.playerSquads = state.playerSquads.filter(sq =>
    sq.memberIds.some(id => {
      const u = live.get(id);
      return !!u && u.alive && u.squadId === sq.id;
    }),
  );
  state.playerSquads.push(...squads);
  return squads;
}

/**
 * Slot reassignment: swap slot pairs whenever swapping shortens total travel.
 * Removes most of the "units walking through each other" chaos.
 */
function resolveCrossings(members: Unit[], slots: Record<string, Position>) {
  const d2 = (u: Unit, p: Position) => (u.pos.x - p.x) ** 2 + (u.pos.y - p.y) ** 2;
  for (let pass = 0; pass < 3; pass++) {
    let swapped = false;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        if (a.type !== b.type) continue;   // keep role positions intact
        const sa = slots[a.id], sb = slots[b.id];
        if (!sa || !sb) continue;
        if (d2(a, sb) + d2(b, sa) + 1 < d2(a, sa) + d2(b, sb)) {
          slots[a.id] = sb; slots[b.id] = sa;
          swapped = true;
        }
      }
    }
    if (!swapped) break;
  }
}

// ---------- per-frame squad maintenance ----------
export function getSquad(state: GameState, unit: Unit): PlayerSquad | null {
  if (unit.squadId == null) return null;
  return state.playerSquads.find(s => s.id === unit.squadId) ?? null;
}

/**
 * Cheap per-tick upkeep: squad centre, smoothed formation direction, arrival
 * detection and throttled slot reassignment after losses. No pathfinding and no
 * O(n^2) work per frame.
 */
export function updatePlayerSquads(state: GameState, dt: number) {
  if (state.playerSquads.length === 0) return;
  const byId = new Map(state.units.map(u => [u.id, u]));

  for (const sq of state.playerSquads) {
    const members = sq.memberIds
      .map(id => byId.get(id))
      .filter((u): u is Unit => !!u && u.alive && !u.insideOf && u.squadId === sq.id);
    if (members.length === 0) { sq.memberIds = []; continue; }

    const lost = members.length !== sq.memberIds.length;
    sq.memberIds = members.map(u => u.id);
    sq.anchor = centroid(members);

    // Formation direction follows travel, rotated gradually (never snapped).
    const dx = sq.dest.x - sq.anchor.x, dy = sq.dest.y - sq.anchor.y;
    if (Math.hypot(dx, dy) > 24) sq.targetFacing = Math.atan2(dy, dx);
    let delta = sq.targetFacing - sq.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxTurn = 1.6 * dt;
    sq.facing += Math.abs(delta) > maxTurn ? Math.sign(delta) * maxTurn : delta;

    // Arrival + squad progress (used for cohesion speed sync).
    let settledCount = 0;
    let worst = 0;
    for (const u of members) {
      const slot = sq.slots[u.id];
      if (!slot) continue;
      const d = Math.hypot(u.pos.x - slot.x, u.pos.y - slot.y);
      worst = Math.max(worst, d);
      if (d < ARRIVE_TOLERANCE) { u.settled = true; settledCount++; }
      else if (d > ARRIVE_TOLERANCE * 2.4) u.settled = false;
      else if (u.settled) settledCount++;
    }
    sq.maxRemaining = worst;
    sq.state = settledCount >= Math.ceil(members.length * 0.8) ? 'arrived' : 'moving';

    // Reassign slots after casualties / stuck units, throttled.
    const stuck = members.some(u => u.stuckTimer > 0.6);
    if ((lost || stuck) && sq.state === 'moving' && state.time - sq.lastReslot > RESLOT_INTERVAL) {
      sq.lastReslot = state.time;
      const before = members.map(u => sq.slots[u.id]);
      resolveCrossings(members, sq.slots);
      members.forEach((u, i) => {
        const slot = sq.slots[u.id];
        if (slot && slot !== before[i]) setDestination(u, state, slot);
      });
    }

    if (sq.state === 'arrived') {
      for (const u of members) if (!u.targetPos && u.path.length === 0) u.groupSpeedCap = null;
    }
  }

  state.playerSquads = state.playerSquads.filter(sq => sq.memberIds.length > 0);
}

/**
 * Soft cohesion speed factor: units far ahead of the squad ease off, laggards
 * get a modest boost, so tanks, APCs and infantry travel as one body.
 */
export function cohesionSpeedFactor(unit: Unit, squad: PlayerSquad): number {
  const slot = squad.slots[unit.id];
  if (!slot || squad.state === 'arrived') return 1;
  const own = Math.hypot(unit.pos.x - slot.x, unit.pos.y - slot.y);
  const lead = squad.maxRemaining - own;   // >0 means this unit is ahead
  const r = squad.cohesionRadius;
  if (lead > r) return 0.82;
  if (lead > r * 0.55) return 0.9;
  if (lead < -r * 0.35) return 1.18;
  if (lead < -r * 0.15) return 1.08;
  return 1;
}
