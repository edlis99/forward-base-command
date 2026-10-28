import { GameState, Position, Unit, PlayerSquad, FormationType } from './types';
import { findNearestPassableWorld, isFootprintPassable, isWorldFootprintPassable } from './terrain';
import { availableSpeed, routeRemaining } from './movement';
import { settlementAt } from './maps/settlements';
import { clearUnitOrders, setDestination } from './units';

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
export const ARRIVE_TOLERANCE = 18;

/** Personal spacing radius used by local avoidance. */
export function spacingRadius(u: Unit): number {
  return u.type === 'tank' ? 12 : u.type === 'apc' ? 11 : u.type === 'helicopter' ? 20 : 6;
}

function slotSpacing(u: Unit): number {
  return u.type === 'tank' ? 34 : u.type === 'apc' ? 32 : u.type === 'helicopter' ? 56 : 20;
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
 * tanks lead in the open; infantry screen them in built-up/restricted ground.
 * APCs stay behind the screen. Aircraft have their own movement command.
 * A single-type selection degrades gracefully into a normal loose block.
 */
function localSlots(
  members: Unit[], compression: number, lateralOf: (u: Unit) => number, preferred?: FormationType, infantryFirst = false,
): Map<string, LocalSlot> {
  const slots = new Map<string, LocalSlot>();
  const tanks = members.filter(u => u.type === 'tank');
  const apcs = members.filter(u => u.type === 'apc');
  const inf = members.filter(u => u.type === 'infantry');
  const heli = members.filter(u => u.type === 'helicopter');

  if (preferred) {
    const ground = members.filter(u => u.type !== 'helicopter');
    const role = (u: Unit) => u.type === 'tank' ? 0 : u.type === 'apc' ? 1 : 2;
    ground.sort((a, b) => (preferred === 'line' ? 0 : role(a) - role(b)) || lateralOf(a) - lateralOf(b));
    const spacing = Math.max(20, ...ground.map(slotSpacing)) * compression;
    ground.forEach((u, i) => {
      const row = Math.ceil(i / 2);
      const side = i % 2 === 1 ? -1 : 1;
      slots.set(u.id, preferred === 'line'
        ? { fwd: 0, right: (i - (ground.length - 1) / 2) * spacing, row: 0 }
        : preferred === 'column'
          ? { fwd: -i * spacing * 1.4, right: 0, row: i }
          : { fwd: -row * spacing * 0.8, right: row * side * spacing, row });
    });
    heli.forEach((u, i) => slots.set(u.id, { fwd: 40, right: (i % 2 ? -1 : 1) * (110 + Math.floor(i / 2) * 60), row: 0 }));
    return slots;
  }

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
    if (infantryFirst && inf.length) {
      place(inf, 30, 4, 22);
      place(tanks, -30, 3, 38);
      place(apcs, -70, 3, 36);
    } else {
      place(tanks, 30, 3, 38);
      place(inf, -10, 4, 22);
      place(apcs, -66, 3, 36);
    }
  } else {
    place(inf, 0, Math.min(4, Math.max(2, Math.ceil(Math.sqrt(inf.length)))), 22);
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

function claimPassable(state: GameState, pos: Position, veh: boolean, claimed: (Position & { radius: number })[]): Position {
  const cs = state.cellSize, radius = veh ? 12 : 6;
  let p = findNearestPassableWorld(state.terrain, pos.x, pos.y, veh, false, 10);
  const free = (q: Position) => isWorldFootprintPassable(state.terrain, q.x, q.y, veh)
    && claimed.every(c => Math.hypot(c.x - q.x, c.y - q.y) >= c.radius + radius);
  if (!free(p)) {
    const base = { ...p };
    search: for (let r = 1; r <= 32; r++) for (let i = 0; i < 16; i++) {
      const q = { x: base.x + Math.cos(i * Math.PI / 8) * r * cs / 4, y: base.y + Math.sin(i * Math.PI / 8) * r * cs / 4 };
      if (free(q)) { p = q; break search; }
    }
  }
  claimed.push({ ...p, radius }); return p;
}

// ---------- order issuing ----------
export interface SquadMoveOptions {
  /** Queue as an extra waypoint instead of replacing the current route. */
  queue?: boolean;
  /** Advance with weapons free. */
  attackMove?: boolean;
  /** Formation for this order; undefined = the global preference, null = default spread. */
  formation?: import('./types').FormationType | null;
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

  const formation = opts.formation === undefined ? state.preferredFormation : (opts.formation ?? undefined);
  const armyCenter = centroid(ground);
  const baseFacing = opts.facing ?? Math.atan2(dest.y - armyCenter.y, dest.x - armyCenter.x);
  const fwd = { x: Math.cos(baseFacing), y: Math.sin(baseFacing) };
  const right = { x: -fwd.y, y: fwd.x };
  const widthScale = Math.max(0.6, Math.min(2.2, opts.widthScale ?? 1));

  const groups = [...clusterSelected(ground.filter(u => u.type !== 'helicopter')), ...clusterSelected(ground.filter(u => u.type === 'helicopter'))];

  // ARMY LEVEL: separate destination area per squad, ordered left-to-right by
  // where the squads currently stand so squads never swap sides.
  const blocks = groups.map((members, i) => {
    const c = centroid(members);
    const lateral = (c.x - armyCenter.x) * right.x + (c.y - armyCenter.y) * right.y;
    const spacing = Math.max(...members.map(slotSpacing));
    const cols = formation === 'column' ? 1
      : formation ? members.length
        : Math.max(2, Math.min(6, Math.ceil(Math.sqrt(members.length * 1.5))));
    return { i, members, lateral, width: cols * spacing * widthScale };
  });
  blocks.sort((a, b) => a.lateral - b.lateral || a.i - b.i);

  const totalWidth = blocks.reduce((s, b) => s + b.width, 0) + SQUAD_GAP * (blocks.length - 1);
  let cursor = -totalWidth / 2;
  const claimed: (Position & { radius: number })[] = [];
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

    const local = localSlots(block.members, compression, lateralOf, formation, !!settlementAt(squadDest.x / state.cellSize, squadDest.y / state.cellSize) || opennessAt(state, squadDest) < .65);
    const slots: Record<string, Position> = {};
    const localOffsets: Record<string, Position> = {};

    for (const u of block.members) {
      const l = local.get(u.id) ?? { fwd: 0, right: 0, row: 0 };
      const raw: Position = {
        x: squadDest.x + sf.x * l.fwd + sr.x * l.right,
        y: squadDest.y + sf.y * l.fwd + sr.y * l.right,
      };
      slots[u.id] = u.type === 'helicopter' ? raw : claimPassable(state, raw, isVehicle(u), claimed);
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
  if (opts.queue) {
    const idle: Unit[] = [];
    for (const block of plan) for (const u of block.members) {
      if (u.targetPos || u.path.length || u.squadId != null) u.waypoints.push({ ...block.slots[u.id], facing: block.facing, attackMove: opts.attackMove });
      else idle.push(u);
    }
    return idle.length ? issueSquadMove(state, idle, dest, { ...opts, queue: false }) : [];
  }
  const squads: PlayerSquad[] = [];
  const commandId = state.nextMoveGroupId++;

  for (const block of plan) {
    const id = state.nextMoveGroupId++;
    const groundSpeeds = block.members.filter(u => u.type !== 'helicopter').map(u => u.speed);
    const travelSpeed = (groundSpeeds.length ? Math.min(...groundSpeeds) : Math.min(...block.members.map(u => u.speed)));
    const spread = Math.max(...block.members.map(slotSpacing));
    const squadCenter = centroid(block.members);

    const squad: PlayerSquad = {
      id, commandId: block.members.every(u => u.type === 'helicopter') ? id : commandId,
      coordinated: state.coordinatedMovement, progressFloor: 0, commandLength: 1,
      memberIds: block.members.map(u => u.id),
      dest: block.dest,
      anchor: { ...squadCenter },
      facing: Math.atan2(block.dest.y - squadCenter.y, block.dest.x - squadCenter.x),
      targetFacing: block.facing,
      travelSpeed,
      cohesionRadius: Math.max(32, Math.min(72, spread * Math.sqrt(block.members.length) * .65)),
      slots: block.slots,
      localOffsets: block.localOffsets,
      compression: block.compression,
      state: 'moving',
      lastReslot: state.time,
      maxRemaining: 0,
    };
    squads.push(squad);

    for (const u of block.members) {
      clearUnitOrders(u);
      u.squadId = id;
      u.groupSpeedCap = state.coordinatedMovement ? travelSpeed : null;
      u.moveGroupId = id;
      setDestination(u, state, block.slots[u.id]);
      u.arrivalFacing = block.facing;
      u.order = u.targetPos ? opts.attackMove ? 'attack_move' : 'move' : 'idle';
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
 * detection and attainable speed. Slots remain stable after losses; completed
 * queued legs start together. Repathing stays in the per-unit movement layer.
 */
export function updatePlayerSquads(state: GameState, dt: number) {
  if (!state.playerSquads.length) return;
  const byId = new Map(state.units.map(u => [u.id, u]));
  const commands = new Map<number, { squads: PlayerSquad[]; members: Unit[] }>();
  for (const sq of state.playerSquads) {
    const members = sq.memberIds.map(id => byId.get(id)).filter((u): u is Unit => !!u && u.alive && !u.insideOf && u.squadId === sq.id);
    sq.memberIds = members.map(u => u.id);
    if (!members.length) continue;
    sq.anchor = centroid(members);
    let delta = sq.targetFacing - sq.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    sq.facing += Math.sign(delta) * Math.min(Math.abs(delta), 1.6 * dt);
    for (const u of members) {
      const slot = sq.slots[u.id];
      u.settled = !!slot && Math.hypot(u.pos.x - slot.x, u.pos.y - slot.y) < ARRIVE_TOLERANCE;
    }
    sq.maxRemaining = Math.max(...members.map(routeRemaining));
    sq.state = members.every(u => u.settled && !u.targetPos) ? 'arrived' : 'moving';
    const command = commands.get(sq.commandId) ?? { squads: [], members: [] };
    command.squads.push(sq); command.members.push(...members); commands.set(sq.commandId, command);
  }
  for (const { squads, members } of commands.values()) {
    // Queued legs begin only when the coordinated ground group has finished
    // the current leg. Casualties and separately retasked units are excluded.
    if (members.every(u => !u.targetPos && !u.path.length) && members.some(u => u.waypoints.length)) {
      for (const u of members) {
        const next = u.waypoints.shift();
        if (!next) continue;
        const sq = squads.find(s => s.id === u.squadId)!;
        sq.slots[u.id] = next; sq.state = 'moving'; u.settled = false;
        setDestination(u, state, next); u.arrivalFacing = next.facing ?? sq.targetFacing;
        sq.targetFacing = u.arrivalFacing; sq.dest = { x: next.x, y: next.y };
        u.order = u.targetPos ? next.attackMove ? 'attack_move' : 'move' : 'idle';
      }
    }
    const moving = members.filter(u => u.targetPos);
    const pace = moving.length ? Math.min(...moving.map(u => availableSpeed(u, state))) : 0;
    const progress = (u: Unit) => !u.targetPos ? 1 : Math.max(0, Math.min(1, 1 - routeRemaining(u) / Math.max(1, u.routeLength ?? 1)));
    const floor = Math.min(...members.map(progress));
    const length = Math.max(1, ...members.map(u => u.routeLength ?? 0));
    for (const sq of squads) { sq.progressFloor = floor; sq.commandLength = length; sq.travelSpeed = pace; }
    for (const u of members) {
      const sq = squads.find(s => s.id === u.squadId);
      u.groupSpeedCap = sq?.coordinated && u.targetPos ? pace : null;
    }
  }
  state.playerSquads = state.playerSquads.filter(sq => sq.memberIds.length > 0);
}

/** Stop a runaway leader; laggards catch up at their own attainable speed. */
export function cohesionSpeedFactor(unit: Unit, squad: PlayerSquad): number {
  if (!squad.coordinated || squad.state === 'arrived') return 1;
  const progress = Math.max(0, Math.min(1, 1 - routeRemaining(unit) / Math.max(1, unit.routeLength ?? 1)));
  const routeLead = (progress - squad.progressFloor) * squad.commandLength;
  const to = unit.targetPos ?? squad.dest;
  const dx = to.x - unit.pos.x, dy = to.y - unit.pos.y, length = Math.hypot(dx, dy) || 1;
  // Different road/woodland routes can have very different lengths. Never
  // stop a physically trailing unit just because its route is shorter.
  const physicalLead = ((unit.pos.x - squad.anchor.x) * dx + (unit.pos.y - squad.anchor.y) * dy) / length;
  const lead = Math.min(routeLead, Math.max(0, physicalLead) * 2);
  if (lead > squad.cohesionRadius) return 0;
  if (lead > squad.cohesionRadius * .65) return .35;
  if (lead > squad.cohesionRadius * .3) return .7;
  return 1;
}
