import { GameState, Position, Team } from './types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from './constants';

/**
 * Coarse threat field per team. Cells are 4x terrain cells.
 * Threat is intensity of recent enemy presence/fire observed by `team`.
 * Decays exponentially; pumped by spotted enemies, fired projectiles, and damage events.
 */
export const THREAT_SCALE = 4;
export const THREAT_COLS = Math.ceil(MAP_COLS / THREAT_SCALE);
export const THREAT_ROWS = Math.ceil(MAP_ROWS / THREAT_SCALE);
const CELL_W = CELL_SIZE * THREAT_SCALE;

export interface ThreatMap {
  /** Float32Array length THREAT_COLS*THREAT_ROWS, indexed y*cols+x. */
  player: Float32Array; // threat AS SEEN BY player team
  enemy: Float32Array;  // threat AS SEEN BY enemy team
  /** Last-known enemy positions per team (memory beyond LOS, decays slower). */
  lastSeenPlayer: Float32Array;
  lastSeenEnemy: Float32Array;
}

export function createThreatMap(): ThreatMap {
  const n = THREAT_COLS * THREAT_ROWS;
  return {
    player: new Float32Array(n),
    enemy: new Float32Array(n),
    lastSeenPlayer: new Float32Array(n),
    lastSeenEnemy: new Float32Array(n),
  };
}

function idxFromWorld(x: number, y: number): number {
  const gx = Math.max(0, Math.min(THREAT_COLS - 1, Math.floor(x / CELL_W)));
  const gy = Math.max(0, Math.min(THREAT_ROWS - 1, Math.floor(y / CELL_W)));
  return gy * THREAT_COLS + gx;
}

function pump(field: Float32Array, x: number, y: number, amount: number, radius = 1) {
  const gx = Math.floor(x / CELL_W);
  const gy = Math.floor(y / CELL_W);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = gx + dx, ty = gy + dy;
      if (tx < 0 || tx >= THREAT_COLS || ty < 0 || ty >= THREAT_ROWS) continue;
      const falloff = 1 / (1 + Math.abs(dx) + Math.abs(dy));
      field[ty * THREAT_COLS + tx] = Math.min(1, field[ty * THREAT_COLS + tx] + amount * falloff);
    }
  }
}

/** Update threat for both teams. Call once per tick. */
export function updateThreatMap(state: GameState, dt: number) {
  if (!state.threat) state.threat = createThreatMap();
  const t = state.threat;
  // decay
  const decay = Math.exp(-dt * 0.35); // ~half-life 2s for active threat
  const slowDecay = Math.exp(-dt * 0.07); // ~half-life 10s for last-seen memory
  for (let i = 0; i < t.player.length; i++) {
    t.player[i] *= decay;
    t.enemy[i] *= decay;
    t.lastSeenPlayer[i] *= slowDecay;
    t.lastSeenEnemy[i] *= slowDecay;
  }
  // pump from spotted units (visible to opposing team)
  for (const u of state.units) {
    if (!u.alive || u.insideOf) continue;
    if (!u.spottedByEnemy) continue;
    const observerField = u.team === 'enemy' ? t.player : t.enemy;
    const memoryField = u.team === 'enemy' ? t.lastSeenEnemy : t.lastSeenPlayer;
    const w = u.type === 'tank' ? 0.9 : u.type === 'apc' ? 0.6 : u.type === 'helicopter' ? 0.7 : 0.4;
    pump(observerField, u.pos.x, u.pos.y, w * dt * 3, 2);
    pump(memoryField, u.pos.x, u.pos.y, w * dt * 2, 2);
  }
}

/** Threat at a world position as seen by `team` (0..1). */
export function threatAt(state: GameState, team: Team, x: number, y: number): number {
  if (!state.threat) return 0;
  const field = team === 'player' ? state.threat.player : state.threat.enemy;
  return field[idxFromWorld(x, y)];
}

/** Last-seen memory at a world position for the OPPOSING team's known positions. */
export function memoryAt(state: GameState, observerTeam: Team, x: number, y: number): number {
  if (!state.threat) return 0;
  const field = observerTeam === 'player' ? state.threat.lastSeenEnemy : state.threat.lastSeenPlayer;
  return field[idxFromWorld(x, y)];
}

/** Add a one-shot pulse (e.g. on damage event) to the observer-team field. */
export function pulseThreat(state: GameState, observerTeam: Team, pos: Position, amount = 0.4) {
  if (!state.threat) state.threat = createThreatMap();
  const field = observerTeam === 'player' ? state.threat.player : state.threat.enemy;
  pump(field, pos.x, pos.y, amount, 2);
}
