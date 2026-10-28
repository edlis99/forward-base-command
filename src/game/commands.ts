import { CommandMarkerType, FormationType, GameState, Position, Stance, Team, Unit } from './types';
import { canDigHere, getTerrainAt, isFootprintPassable } from './terrain';
import { clearUnitOrders, distance, setDestination } from './units';
import { isVisibleTo } from './awareness';
import { issueSquadMove } from './playerSquads';
import { coverLabel, occupyCover } from './cover';

/**
 * The only way a side can influence a match. Commands are plain serializable
 * data that name units by id, so they can be sent over a socket, validated by
 * an authoritative server, logged and replayed. The UI turns mouse gestures
 * and selection into these; nothing here knows about "selected" units.
 */
export type Command =
  | { type: 'move'; unitIds: string[]; x: number; y: number; queue?: boolean; attackMove?: boolean; facing?: number; widthScale?: number; formation?: FormationType | null }
  | { type: 'attack'; unitIds: string[]; targetId: string }
  | { type: 'board'; unitIds: string[]; apcId: string }
  | { type: 'stance'; unitIds: string[]; stance: Stance }
  | { type: 'hold'; unitIds: string[] }
  | { type: 'dig'; unitIds: string[] }
  | { type: 'disembark'; unitIds: string[] };

export type CommandResult = { ok: true } | { ok: false; reason: string };

export const MAX_COMMAND_UNITS = 200;
const STANCES: Stance[] = ['aggressive', 'defend', 'hold_fire', 'tight'] as Stance[];

export function pushMarker(state: GameState, type: CommandMarkerType, pos: Position, team: Team = 'player') {
  const max = type === 'hold' ? 0.9 : 0.6;
  state.commandMarkers.push({ pos: { x: pos.x, y: pos.y }, type, team, timer: max, max });
}

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Units of `team` named by `ids`: alive, owned, deduplicated. Foreign ids are silently dropped. */
function owned(state: GameState, team: Team, ids: unknown, opts: { onBoard?: boolean } = {}): Unit[] {
  if (!Array.isArray(ids)) return [];
  const want = new Set(ids.filter((id): id is string => typeof id === 'string').slice(0, MAX_COMMAND_UNITS));
  return state.units.filter(u => want.has(u.id) && u.alive && u.team === team && (opts.onBoard || !u.insideOf));
}

export function applyCommand(state: GameState, team: Team, cmd: Command): CommandResult {
  if (state.gameOver) return fail('match is over');
  if (!cmd || typeof cmd !== 'object') return fail('malformed command');

  switch (cmd.type) {
    case 'move': {
      if (!finite(cmd.x) || !finite(cmd.y)) return fail('bad destination');
      if (cmd.x < 0 || cmd.y < 0 || cmd.x > state.mapWidth || cmd.y > state.mapHeight) return fail('destination off the map');
      if (cmd.facing !== undefined && !finite(cmd.facing)) return fail('bad facing');
      if (cmd.widthScale !== undefined && !(finite(cmd.widthScale) && cmd.widthScale > 0 && cmd.widthScale < 10)) return fail('bad width');
      const units = owned(state, team, cmd.unitIds);
      if (!units.length) return fail('no controllable units');
      const dest: Position = { x: cmd.x, y: cmd.y };
      const opts = { facing: cmd.facing, widthScale: cmd.widthScale, formation: cmd.formation };

      // Right-click on a tactical object occupies its firing positions.
      if (!cmd.queue && !cmd.attackMove) {
        const assigned = occupyCover(state, units, dest);
        if (assigned.size > 0) {
          const remaining = units.filter(u => !assigned.has(u.id));
          if (remaining.length) issueSquadMove(state, remaining, dest, opts);
          const cell = getTerrainAt(state.terrain, dest.x, dest.y)!;
          state.eventLog.unshift({ message: `${assigned.size} infantry taking cover: ${coverLabel(cell)}`, time: state.time, type: 'info' });
          pushMarker(state, 'hold', dest, team);
          return { ok: true };
        }
      }
      const onCapture = state.capturePoints.some(cp => Math.hypot(cp.pos.x - dest.x, cp.pos.y - dest.y) < cp.radius);
      issueSquadMove(state, units, dest, { ...opts, queue: !!cmd.queue, attackMove: !!cmd.attackMove });
      pushMarker(state, onCapture ? 'capture' : cmd.attackMove ? 'attack_move' : 'move', dest, team);
      return { ok: true };
    }

    case 'attack': {
      const units = owned(state, team, cmd.unitIds);
      if (!units.length) return fail('no controllable units');
      const target = state.units.find(u => u.id === cmd.targetId);
      if (!target || !target.alive || target.insideOf || target.team === team) return fail('invalid target');
      if (!isVisibleTo(target, team)) return fail('target not visible');
      for (const u of units) {
        clearUnitOrders(u);
        u.attackTarget = target.id;
        setDestination(u, state, { x: target.pos.x, y: target.pos.y });
        u.waypoints = [];
        u.order = 'attack';
      }
      pushMarker(state, 'attack', target.pos, team);
      return { ok: true };
    }

    case 'board': {
      const apc = state.units.find(u => u.id === cmd.apcId);
      if (!apc || !apc.alive || apc.team !== team || apc.type !== 'apc') return fail('invalid transport');
      const units = owned(state, team, cmd.unitIds).filter(u => u.type === 'infantry' && u.id !== apc.id);
      if (!units.length) return fail('no infantry to board');
      for (const u of units) {
        if (apc.passengers.length >= 4) break;
        clearUnitOrders(u);
        setDestination(u, state, { x: apc.pos.x, y: apc.pos.y });
        u.attackTarget = null;
        u.order = 'move';
        u.boardTarget = apc.id;
      }
      pushMarker(state, 'board', apc.pos, team);
      return { ok: true };
    }

    case 'stance': {
      if (!STANCES.includes(cmd.stance)) return fail('unknown stance');
      const units = owned(state, team, cmd.unitIds, { onBoard: true });
      if (!units.length) return fail('no controllable units');
      units.forEach(u => { u.stance = cmd.stance; });
      return { ok: true };
    }

    case 'hold': {
      const units = owned(state, team, cmd.unitIds);
      if (!units.length) return fail('no controllable units');
      units.forEach(u => { clearUnitOrders(u); u.order = 'hold_position'; u.homePos = { ...u.pos }; });
      const cx = units.reduce((s, u) => s + u.pos.x, 0) / units.length;
      const cy = units.reduce((s, u) => s + u.pos.y, 0) / units.length;
      pushMarker(state, 'hold', { x: cx, y: cy }, team);
      return { ok: true };
    }

    case 'dig': {
      const units = owned(state, team, cmd.unitIds).filter(u => u.type === 'infantry');
      if (!units.length) return fail('no infantry');
      for (const u of units) {
        const cell = getTerrainAt(state.terrain, u.pos.x, u.pos.y);
        if (!canDigHere(cell)) {
          state.eventLog.unshift({ message: `${u.type} cannot dig here`, time: state.time, type: 'info' });
          continue;
        }
        clearUnitOrders(u);
        u.order = 'entrench';
        u.digTimer = 0;
        u.targetPos = null; u.path = []; u.waypoints = []; u.finalDest = null;
        u.attackTarget = null;
      }
      return { ok: true };
    }

    case 'disembark': {
      const cs = state.cellSize;
      const apcs = owned(state, team, cmd.unitIds).filter(u => u.type === 'apc');
      if (!apcs.length) return fail('no transports');
      for (const apc of apcs) {
        for (const unit of state.units.filter(u => u.boardTarget === apc.id)) clearUnitOrders(unit);
        let unloaded = 0;
        for (const id of [...apc.passengers]) {
          const passenger = state.units.find(u => u.id === id && u.alive && u.insideOf === apc.id);
          if (!passenger) { apc.passengers = apc.passengers.filter(pid => pid !== id); continue; }
          let destination: Position | null = null;
          const gx = Math.floor(apc.pos.x / cs), gy = Math.floor(apc.pos.y / cs);
          search: for (let r = 1; r <= 5; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              if (!isFootprintPassable(state.terrain, gx + dx, gy + dy, false, false)) continue;
              const pos = { x: (gx + dx + 0.5) * cs, y: (gy + dy + 0.5) * cs };
              if (state.units.some(u => u.alive && !u.insideOf && u.type !== 'helicopter' && distance(u.pos, pos) < cs)) continue;
              destination = pos;
              break search;
            }
          }
          if (!destination) continue; // Keep passengers aboard if no safe exit exists.
          clearUnitOrders(passenger);
          passenger.insideOf = null;
          passenger.pos = destination;
          passenger.homePos = { ...destination };
          passenger.facing = apc.facing;
          passenger.order = 'hold_position';
          apc.passengers = apc.passengers.filter(pid => pid !== id);
          unloaded++;
        }
        state.eventLog.unshift({ message: unloaded ? `APC unloaded ${unloaded} infantry` : 'APC: no safe dismount space or no passengers', time: state.time, type: 'info' });
      }
      return { ok: true };
    }

    default:
      return fail('unknown command');
  }
}
