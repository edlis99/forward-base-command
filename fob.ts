import { GameState, Position, Team, Unit, UnitType } from './types';
import { CELL_SIZE } from './constants';
import { createUnit, distance, peekUnitId, resetUnitIds } from './units';
import { findNearestPassableWorld, getTerrainAt } from './terrain';
import type { RaasState } from './raas';

/**
 * Squad-style forward spawning for RAAS.
 *  - An APC (logistics) deploys a RADIO where it stands. Radios must keep
 *    their distance from objectives and from each other.
 *  - Within the radio's radius a side can lay out a SPAWN POINT (HAB). It is
 *    built by friendly infantry standing at the site, and only while no enemy
 *    is close.
 *  - A spawn point is OVERRUN (unusable) while enemies are near it.
 *  - Enemies standing on an undefended radio dig it down; that destroys the
 *    spawn point too and costs tickets.
 *  - Losses go into a reinforcement queue and come back after a delay at the
 *    most forward usable spawn: infantry at a spawn point or the main,
 *    vehicles at the main. Every loss costs tickets; respawning is free.
 * All values are first test values.
 */
export const FOB_RULES = {
  radioRadius: 12 * CELL_SIZE,
  minRadioSpacing: 30 * CELL_SIZE,
  minObjectiveDistance: 10 * CELL_SIZE,
  maxRadios: 2,
  habBuildSeconds: 20,
  habBuilders: 2,
  buildRange: 3 * CELL_SIZE,
  overrunRadius: 8 * CELL_SIZE,
  digRange: 3 * CELL_SIZE,
  digSeconds: 15,
  radioLossTickets: 20,
  respawnSeconds: { infantry: 20, apc: 60, tank: 90, helicopter: 90 } as Record<UnitType, number>,
};

export interface Fob {
  id: string; team: Team; alive: boolean;
  radio: Position;
  hab: { pos: Position; progress: number; built: boolean } | null;
  /** Seconds of enemy digging so far. */
  dig: number;
  overrun: boolean;
}
export interface Reinforcement { team: Team; type: UnitType; readyAt: number }

const enemyOf = (t: Team): Team => (t === 'player' ? 'enemy' : 'player');
const near = (state: GameState, team: Team, pos: Position, r: number, infantryOnly = false) =>
  state.units.filter(u => u.alive && !u.insideOf && u.team === team && (!infantryOnly || u.type === 'infantry') && distance(u.pos, pos) <= r);

/** Why a radio cannot go here (null = it can). */
export function radioBlocker(state: GameState, r: RaasState, team: Team, pos: Position): string | null {
  const own = r.fobs.filter(f => f.alive && f.team === team);
  if (own.length >= FOB_RULES.maxRadios) return `at most ${FOB_RULES.maxRadios} radios per side`;
  if (own.some(f => distance(f.radio, pos) < FOB_RULES.minRadioSpacing)) return 'too close to another friendly radio';
  if (r.objectives.some(o => distance(o.pos, pos) < FOB_RULES.minObjectiveDistance)) return 'too close to an objective';
  const cell = getTerrainAt(state.terrain, pos.x, pos.y);
  if (!cell || cell.blocksMovement || cell.type === 'water') return 'cannot deploy on this ground';
  if (near(state, enemyOf(team), pos, FOB_RULES.overrunRadius).length) return 'enemies too close';
  return null;
}

export function deployRadio(state: GameState, r: RaasState, team: Team, apc: Unit): string | null {
  if (apc.type !== 'apc' || apc.team !== team || !apc.alive) return 'only an APC can deploy a radio';
  if (Math.hypot(apc.vel.x, apc.vel.y) > 4 || apc.targetPos) return 'the APC must be stopped';
  const why = radioBlocker(state, r, team, apc.pos);
  if (why) return why;
  r.fobSeq = (r.fobSeq ?? 0) + 1;
  r.fobs.push({ id: `fob_${team}_${r.fobSeq}`, team, alive: true, radio: { ...apc.pos }, hab: null, dig: 0, overrun: false });
  state.eventLog.unshift({ message: `${team} radio deployed`, time: state.time, type: 'info' });
  return null;
}

/** Lay out a spawn point near one of the side's radios. Built by infantry over time. */
export function layOutSpawn(state: GameState, r: RaasState, team: Team, pos: Position): string | null {
  const fob = r.fobs.filter(f => f.alive && f.team === team).sort((a, b) => distance(a.radio, pos) - distance(b.radio, pos))[0];
  if (!fob) return 'build a radio first (APC, key R)';
  if (distance(fob.radio, pos) > FOB_RULES.radioRadius) return 'spawn point must be within the radio radius';
  if (fob.hab) return 'this radio already has a spawn point';
  const cell = getTerrainAt(state.terrain, pos.x, pos.y);
  if (!cell || cell.blocksMovement || cell.type === 'water') return 'cannot build on this ground';
  fob.hab = { pos: { ...pos }, progress: 0, built: false };
  state.eventLog.unshift({ message: `${team} spawn point laid out; keep ${FOB_RULES.habBuilders} infantry on it to build`, time: state.time, type: 'info' });
  return null;
}

export function updateFobs(state: GameState, r: RaasState, dt: number) {
  for (const f of r.fobs) {
    if (!f.alive) continue;
    const foe = enemyOf(f.team);
    // Construction.
    if (f.hab && !f.hab.built) {
      const builders = near(state, f.team, f.hab.pos, FOB_RULES.buildRange, true).length;
      const threatened = near(state, foe, f.hab.pos, FOB_RULES.overrunRadius).length > 0;
      if (builders >= FOB_RULES.habBuilders && !threatened) {
        f.hab.progress = Math.min(1, f.hab.progress + dt / FOB_RULES.habBuildSeconds);
        if (f.hab.progress >= 1) { f.hab.built = true; state.eventLog.unshift({ message: `${f.team} spawn point ready`, time: state.time, type: 'info' }); }
      }
    }
    f.overrun = !!f.hab && near(state, foe, f.hab.pos, FOB_RULES.overrunRadius).length > 0;
    // Digging down an undefended radio.
    const diggers = near(state, foe, f.radio, FOB_RULES.digRange).length;
    const defenders = near(state, f.team, f.radio, FOB_RULES.digRange).length;
    if (diggers > 0 && defenders === 0) f.dig += dt; else f.dig = Math.max(0, f.dig - dt * 0.5);
    if (f.dig >= FOB_RULES.digSeconds) {
      f.alive = false;
      r.tickets[f.team] -= FOB_RULES.radioLossTickets;
      state.eventLog.unshift({ message: `${f.team} radio destroyed (-${FOB_RULES.radioLossTickets} tickets)`, time: state.time, type: 'objective' });
    }
  }
}

/** Where a side can bring troops in right now. Mains always; built spawn points unless overrun. */
export function spawnPoints(r: RaasState, team: Team): { kind: 'main' | 'hab'; pos: Position; id: string }[] {
  const out: { kind: 'main' | 'hab'; pos: Position; id: string }[] = [{ kind: 'main', pos: r.mains[team], id: `main_${team}` }];
  for (const f of r.fobs) if (f.alive && f.team === team && f.hab?.built && !f.overrun) out.push({ kind: 'hab', pos: f.hab.pos, id: f.id });
  return out;
}

/** Fog of war for FOBs: own always; enemy ones only while a friendly unit can see them. */
export function visibleFobs(state: GameState, r: RaasState, team: Team): Fob[] {
  return r.fobs.filter(f => f.alive && (f.team === team ||
    state.units.some(u => u.alive && !u.insideOf && u.team === team && distance(u.pos, f.radio) <= u.sightRange)));
}

export function queueReinforcement(state: GameState, r: RaasState, u: Unit) {
  r.reserve.push({ team: u.team, type: u.type, readyAt: state.time + FOB_RULES.respawnSeconds[u.type] });
}

/** Bring back ready reinforcements at the most forward usable spawn point. */
export function updateReinforcements(state: GameState, r: RaasState, forwardOf: (team: Team) => Position | undefined) {
  if (!r.reserve.length) return;
  const keep: Reinforcement[] = [];
  for (const q of r.reserve) {
    if (q.readyAt > state.time || r.tickets[q.team] <= 0) { keep.push(q); continue; }
    const points = spawnPoints(r, q.team).filter(p => q.type === 'infantry' || p.kind === 'main');
    const goal = forwardOf(q.team);
    const at = goal ? points.sort((a, b) => distance(a.pos, goal) - distance(b.pos, goal))[0] : points[0];
    const k = state.units.filter(u => u.alive && distance(u.pos, at.pos) < 3 * CELL_SIZE).length;
    const veh = q.type === 'tank' || q.type === 'apc';
    const spot = findNearestPassableWorld(state.terrain, at.pos.x + ((k % 3) - 1) * 24, at.pos.y + (Math.floor(k / 3) % 3 - 1) * 24, veh, q.type === 'helicopter', 8);
    resetUnitIds(state.nextUnitId ?? peekUnitId());
    const unit = createUnit(q.type, q.team, spot.x, spot.y);
    state.nextUnitId = peekUnitId();
    unit.homePos = { ...unit.pos };
    unit.facing = Math.atan2(r.mains[q.team === 'player' ? 'enemy' : 'player'].y - at.pos.y, r.mains[q.team === 'player' ? 'enemy' : 'player'].x - at.pos.x);
    state.units.push(unit);
    if (q.team === 'player') state.eventLog.unshift({ message: `Reinforcement: ${q.type} at ${at.kind === 'main' ? 'main' : 'spawn point'}`, time: state.time, type: 'spawn' });
  }
  r.reserve = keep;
}
