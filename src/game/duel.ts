import { CapturePoint, GameState, MapLayoutId, MissionDef, Position, Team, Unit } from './types';
import { createUnit } from './units';
import { updateCapturePoints } from './capture';
import { MAP_WIDTH, MAP_HEIGHT } from './constants';

export interface DuelRules { scoreToWin: number; timeLimit: number; pointsPerSecond: number }
export const DEFAULT_DUEL_RULES: DuelRules = { scoreToWin: 300, timeLimit: 900, pointsPerSecond: 1 };

export interface DuelSetup {
  name: string;
  mapLayout: MapLayoutId;
  mapSeed?: number;
  /** Forces each side starts with. */
  composition: { infantry: number; tank: number; apc: number };
  /** Where 'player' deploys; 'enemy' deploys at the point mirrored through the map centre. */
  spawn: Position;
  /** Objectives. */
  points: { id: string; label: string; pos: Position; radius?: number }[];
  rules?: Partial<DuelRules>;
}

/** Point reflection through the centre of the map. */
export const mirror = (p: Position): Position => ({ x: MAP_WIDTH - p.x, y: MAP_HEIGHT - p.y });

function deployForce(team: Team, centre: Position, comp: DuelSetup['composition']): Unit[] {
  const order: Array<[keyof DuelSetup['composition'], 'infantry' | 'tank' | 'apc']> = [['infantry', 'infantry'], ['tank', 'tank'], ['apc', 'apc']];
  const dir = team === 'player' ? 1 : -1; // rows stack away from the front
  const units: Unit[] = [];
  let row = 0;
  for (const [key, type] of order) {
    for (let i = 0; i < comp[key]; i++) {
      const col = i % 4, line = Math.floor(i / 4);
      const u = createUnit(type, team, centre.x - dir * (line + row) * 40, centre.y + (col - 1.5) * 36 * dir);
      u.homePos = { ...u.pos };
      units.push(u);
    }
    row += Math.ceil(comp[key] / 4);
  }
  return units;
}

/**
 * Points race: each side scores while it owns capture points; first to the
 * target score wins, otherwise the higher score when time runs out. A side
 * with no units left loses at once.
 */
export function updateDuel(state: GameState, dt: number) {
  if (state.gameOver || !state.duel) return;
  updateCapturePoints(state, dt);
  const d = state.duel;
  for (const cp of state.capturePoints) {
    if (cp.owner === 'player') d.score.player += dt * d.pointsPerSecond;
    else if (cp.owner === 'enemy') d.score.enemy += dt * d.pointsPerSecond;
  }
  const alive = (t: Team) => state.units.some(u => u.alive && u.team === t);
  let winner: Team | null | undefined;
  if (!alive('player') && !alive('enemy')) winner = null;
  else if (!alive('player')) winner = 'enemy';
  else if (!alive('enemy')) winner = 'player';
  else if (d.score.player >= d.scoreToWin || d.score.enemy >= d.scoreToWin) winner = d.score.player >= d.scoreToWin ? 'player' : 'enemy';
  else if (state.time >= d.timeLimit) winner = d.score.player === d.score.enemy ? null : d.score.player > d.score.enemy ? 'player' : 'enemy';
  if (winner === undefined) return;
  state.gameOver = true;
  state.winner = winner;
  state.gameResult = winner === 'player' ? 'win' : winner === 'enemy' ? 'lose' : null;
  state.eventLog.unshift({ message: winner ? `${winner} wins the match` : 'Match drawn', time: state.time, type: 'objective' });
}

export function makeDuelMission(setup: DuelSetup): MissionDef {
  const rules = { ...DEFAULT_DUEL_RULES, ...setup.rules };
  return {
    id: 'duel',
    name: setup.name,
    summary: 'Head-to-head: hold more objectives than your opponent.',
    briefing: `Capture and hold objectives. First to ${rules.scoreToWin} points wins; the match lasts ${Math.round(rules.timeLimit / 60)} minutes.`,
    rewardKills: false,
    mapLayout: setup.mapLayout,
    mapSeed: setup.mapSeed,
    init: () => {
      const capturePoints: CapturePoint[] = setup.points.map(p => ({ id: p.id, label: p.label, pos: { ...p.pos }, radius: p.radius ?? 140, owner: 'neutral', progress: 0 }));
      return {
        units: [...deployForce('player', setup.spawn, setup.composition), ...deployForce('enemy', mirror(setup.spawn), setup.composition)],
        capturePoints,
        duel: { score: { player: 0, enemy: 0 }, ...rules },
      };
    },
    update: (state, dt) => updateDuel(state, dt),
  };
}
