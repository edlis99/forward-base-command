import { Command, CommandResult, applyCommand } from './commands';
import { createInitialState, createInputState, update } from './engine';
import { isVisibleTo } from './awareness';
import { GameState, MissionDef, Team, Unit } from './types';
import { Controller } from './types';

/** Fixed simulation step. The server steps at this rate regardless of render speed. */
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

export interface LoggedCommand { tick: number; team: Team; cmd: Command }

/**
 * An authoritative match: one state, advanced only by `stepMatch`, changed
 * only by validated commands. Nothing in here touches the DOM, the clock or
 * unseeded randomness, so the same seed and command log always replay to the
 * same result. A game server wraps one of these per room.
 */
export interface Match {
  state: GameState;
  tick: number;
  /** Commands received since the last step, applied in arrival order. */
  pending: Array<{ team: Team; cmd: Command }>;
  /** Everything that was applied, for replays and dispute checks. */
  log: LoggedCommand[];
  /** Outcome of the most recent command from each side (for acknowledgements). */
  lastResult: Partial<Record<Team, CommandResult>>;
}

export interface MatchOptions {
  seed: number;
  controllers?: Record<Team, Controller>;
  /** Runs once on the fresh state (map overrides, test fixtures). Must be deterministic. */
  setup?: (state: GameState) => void;
}

export function createMatch(mission: MissionDef, options: MatchOptions): Match {
  const state = createInitialState(mission, undefined, {
    seed: options.seed,
    controllers: options.controllers ?? { player: 'human', enemy: 'human' },
  });
  state.timeScale = 1; state.paused = false;
  options.setup?.(state);
  return { state, tick: 0, pending: [], log: [], lastResult: {} };
}

/** Queue a command; it takes effect at the start of the next tick. */
export function submitCommand(match: Match, team: Team, cmd: Command) {
  match.pending.push({ team, cmd });
}

export function stepMatch(match: Match) {
  const { state } = match;
  if (state.gameOver) return;
  for (const { team, cmd } of match.pending) {
    const result = applyCommand(state, team, cmd);
    match.lastResult[team] = result;
    if (result.ok) match.log.push({ tick: match.tick, team, cmd });
  }
  match.pending = [];
  update(state, createInputState(), TICK_DT);
  match.tick++;
}

/** Rebuild a match from its seed and accepted command log. */
export function replayMatch(mission: MissionDef, options: MatchOptions, log: LoggedCommand[], ticks: number): Match {
  const match = createMatch(mission, options);
  let i = 0;
  while (match.tick < ticks && !match.state.gameOver) {
    while (i < log.length && log[i].tick === match.tick) { submitCommand(match, log[i].team, log[i].cmd); i++; }
    stepMatch(match);
  }
  return match;
}

// ---------- what a client is allowed to know ----------

export interface UnitView {
  id: string; type: Unit['type']; team: Team;
  x: number; y: number; facing: number;
  health: number; maxHealth: number;
  /** Own units only: */
  order?: Unit['order']; stance?: Unit['stance']; suppression?: number; ammo?: number; prone?: boolean;
  passengers?: number; insideOf?: string | null;
}
export interface Snapshot {
  tick: number; time: number; you: Team;
  units: UnitView[];
  capturePoints: Array<{ id: string; label: string; x: number; y: number; radius: number; owner: string; progress: number }>;
  score?: Record<Team, number>;
  gameOver: boolean; winner: Team | null;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Fog of war enforced at the source: a client receives its own units in full
 * and enemy units only while they are spotted, with no hidden fields.
 */
export function snapshotFor(match: Match, team: Team): Snapshot {
  const { state } = match;
  const units: UnitView[] = [];
  for (const u of state.units) {
    if (!u.alive) continue;
    if (u.team === team) {
      units.push({ id: u.id, type: u.type, team: u.team, x: round(u.pos.x), y: round(u.pos.y), facing: Math.round(u.facing * 100) / 100,
        health: Math.round(u.health), maxHealth: u.maxHealth, order: u.order, stance: u.stance,
        suppression: Math.round(u.suppression * 100) / 100, ammo: u.ammo, prone: u.prone,
        passengers: u.passengers.length, insideOf: u.insideOf });
    } else if (!u.insideOf && isVisibleTo(u, team)) {
      units.push({ id: u.id, type: u.type, team: u.team, x: round(u.pos.x), y: round(u.pos.y), facing: Math.round(u.facing * 100) / 100,
        health: Math.round(u.health), maxHealth: u.maxHealth });
    }
  }
  return {
    tick: match.tick, time: round(state.time), you: team, units,
    capturePoints: state.capturePoints.map(c => ({ id: c.id, label: c.label, x: c.pos.x, y: c.pos.y, radius: c.radius, owner: c.owner, progress: Math.round(c.progress * 100) / 100 })),
    score: state.duel ? { player: Math.floor(state.duel.score.player), enemy: Math.floor(state.duel.score.enemy) } : undefined,
    gameOver: state.gameOver, winner: state.winner ?? null,
  };
}

/** Order-independent fingerprint of the simulation, for desync checks and replay tests. */
export function stateDigest(state: GameState): string {
  let h = 2166136261;
  const eat = (v: string | number) => {
    const str = typeof v === 'number' ? v.toFixed(3) : v;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  };
  eat(state.time); eat(state.rngState ?? 0);
  for (const u of [...state.units].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    eat(u.id); eat(u.pos.x); eat(u.pos.y); eat(u.health); eat(u.alive ? 1 : 0); eat(u.ammo); eat(u.suppression); eat(u.order);
  }
  for (const c of state.capturePoints) { eat(c.id); eat(c.progress); }
  if (state.duel) { eat(state.duel.score.player); eat(state.duel.score.enemy); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
