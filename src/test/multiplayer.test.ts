import { describe, expect, it } from 'vitest';
import { applyCommand, Command } from '../game/commands';
import { makeDuelMission } from '../game/duel';
import { createMatch, Match, replayMatch, snapshotFor, stateDigest, stepMatch, submitCommand, TICK_RATE } from '../game/match';
import { createInitialState, createInputState, update } from '../game/engine';
import { shuffled } from '../game/rng';
import { createUnit } from '../game/units';
import { leipalingisMission } from '../game/missions';
import { MAP_WIDTH, MAP_HEIGHT } from '../game/constants';
import { GameState, Team } from '../game/types';

const CENTRE = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
const mission = (rules = {}, comp = { infantry: 6, tank: 1, apc: 0 }) => makeDuelMission({
  name: 'Test duel', mapLayout: 'farmhouse_complex', mapSeed: 7, composition: comp,
  spawn: { x: CENTRE.x - 840, y: CENTRE.y }, points: [{ id: 'mid', label: 'Crossroads', pos: CENTRE }], rules: { scoreToWin: 30, timeLimit: 240, ...rules },
});
function flatten(state: GameState) {
  for (const row of state.terrain) for (const c of row) {
    Object.assign(c, { type: 'open', coverBonus: 0, concealment: 0, movementCost: 1, elevation: 1, blocksLOS: false,
      blocksMovement: false, vehicleImpassable: false, trampled: false, traction: 1, fatigueRate: 0, prop: undefined, exposure: 1 });
  }
}
function newMatch(seed = 1, rules = {}): Match {
  return createMatch(mission(rules), { seed, setup: flatten });
}
const ids = (m: Match, team: Team) => m.state.units.filter(u => u.team === team && u.alive).map(u => u.id);
const rush = (m: Match, team: Team) => submitCommand(m, team, { type: 'move', unitIds: ids(m, team), x: CENTRE.x, y: CENTRE.y, attackMove: true });
function play(m: Match, seconds: number) { for (let i = 0; i < seconds * TICK_RATE && !m.state.gameOver; i++) stepMatch(m); }

describe('determinism and replay', () => {
  it('same seed + same commands gives an identical match; a different seed does not', () => {
    const run = (seed: number) => { const m = newMatch(seed); rush(m, 'player'); rush(m, 'enemy'); play(m, 45); return stateDigest(m.state); };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });
  it('gives units the same ids in every match, whatever else ran before', () => {
    const a = newMatch(1), b = newMatch(2);
    expect(ids(a, 'player')).toEqual(ids(b, 'player'));
    expect(ids(a, 'enemy')).toEqual(ids(b, 'enemy'));
  });
  it('replays a recorded match from its seed and accepted command log', () => {
    const m = newMatch(11); rush(m, 'player'); rush(m, 'enemy'); play(m, 20);
    submitCommand(m, 'player', { type: 'hold', unitIds: ids(m, 'player').slice(0, 3) }); play(m, 25);
    expect(m.log.length).toBeGreaterThan(2);
    const copy = replayMatch(mission(), { seed: 11, setup: flatten }, m.log, m.tick);
    expect(copy.tick).toBe(m.tick);
    expect(stateDigest(copy.state)).toBe(stateDigest(m.state));
  });
  it('shuffles reproducibly from the game seed', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffled(items, { rngState: 42 }), b = shuffled(items, { rngState: 42 });
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(items);
  });
});

describe('command validation (server side)', () => {
  it('lets a side command only its own units', () => {
    const m = newMatch();
    const result = applyCommand(m.state, 'enemy', { type: 'move', unitIds: ids(m, 'player'), x: CENTRE.x, y: CENTRE.y });
    expect(result.ok).toBe(false);
    expect(m.state.units.filter(u => u.team === 'player').every(u => !u.targetPos)).toBe(true);
  });
  it('ignores foreign ids mixed into a valid command', () => {
    const m = newMatch();
    const mine = ids(m, 'player').slice(0, 2), theirs = ids(m, 'enemy').slice(0, 2);
    expect(applyCommand(m.state, 'player', { type: 'hold', unitIds: [...mine, ...theirs] }).ok).toBe(true);
    for (const u of m.state.units) expect(u.order === 'hold_position').toBe(mine.includes(u.id));
  });
  it('rejects malformed and out-of-bounds commands', () => {
    const m = newMatch(); const unitIds = ids(m, 'player');
    const bad: unknown[] = [
      { type: 'move', unitIds, x: NaN, y: 5 }, { type: 'move', unitIds, x: -10, y: 5 }, { type: 'move', unitIds, x: MAP_WIDTH + 1, y: 5 },
      { type: 'move', unitIds, x: 5, y: 5, facing: 'up' }, { type: 'stance', unitIds, stance: 'berserk' }, { type: 'teleport', unitIds }, null, 'move',
    ];
    for (const cmd of bad) expect(applyCommand(m.state, 'player', cmd as Command).ok).toBe(false);
  });
  it('rejects attacks on unseen, dead or friendly targets', () => {
    const m = newMatch(); const unitIds = ids(m, 'player');
    const [enemyId] = ids(m, 'enemy');
    expect(applyCommand(m.state, 'player', { type: 'attack', unitIds, targetId: enemyId }).ok).toBe(false); // not spotted
    expect(applyCommand(m.state, 'player', { type: 'attack', unitIds, targetId: unitIds[1] }).ok).toBe(false); // friendly
    const enemy = m.state.units.find(u => u.id === enemyId)!;
    enemy.spottedByEnemy = true; enemy.detectionLevel = 1;
    expect(applyCommand(m.state, 'player', { type: 'attack', unitIds, targetId: enemyId }).ok).toBe(true);
    enemy.alive = false;
    expect(applyCommand(m.state, 'player', { type: 'attack', unitIds, targetId: enemyId }).ok).toBe(false);
  });
  it('refuses commands once the match is over', () => {
    const m = newMatch(); m.state.gameOver = true;
    expect(applyCommand(m.state, 'player', { type: 'hold', unitIds: ids(m, 'player') }).ok).toBe(false);
  });
});

describe('what each client may see', () => {
  it('hides unspotted enemies and never leaks hidden fields', () => {
    const m = newMatch();
    expect(snapshotFor(m, 'player').units.every(u => u.team === 'player')).toBe(true);
    const target = m.state.units.find(u => u.team === 'enemy')!;
    target.spottedByEnemy = true; target.detectionLevel = 1;
    const view = snapshotFor(m, 'player').units.find(u => u.id === target.id)!;
    expect(view).toBeDefined();
    expect(view.order).toBeUndefined(); expect(view.ammo).toBeUndefined(); expect(view.suppression).toBeUndefined();
    expect(snapshotFor(m, 'enemy').units.find(u => u.id === target.id)!.order).toBeDefined(); // owner sees its own detail
  });
  it('keeps a snapshot small enough to send every tick', () => {
    const m = newMatch(); play(m, 5);
    const size = JSON.stringify(snapshotFor(m, 'player')).length;
    expect(size).toBeLessThan(8000);
  });
});

describe('who drives each side', () => {
  const enemyMovement = (enemy: 'ai' | 'human') => {
    const state = createInitialState({ ...leipalingisMission, mapLayout: 'farmhouse_complex', init: () => ({}), update: () => {} }, undefined, { controllers: { player: 'human', enemy } });
    flatten(state);
    const me = createUnit('infantry', 'player', 1000, 1000), foe = createUnit('infantry', 'enemy', 1220, 1000);
    foe.stance = 'aggressive'; state.units = [me, foe];
    for (let i = 0; i < 200; i++) { update(state, createInputState(), 0.05); me.detectionLevel = 1; me.spottedByEnemy = true; foe.detectionLevel = 1; foe.spottedByEnemy = true; }
    return Math.hypot(foe.pos.x - 1220, foe.pos.y - 1000);
  };
  it('runs the AI only for a side that has no human', () => {
    expect(enemyMovement('ai')).toBeGreaterThan(20);
    expect(enemyMovement('human')).toBeLessThan(1);
  });
});

describe('head-to-head match', () => {
  it('a side holding the objective alone scores and wins', () => {
    const m = newMatch(3);
    m.state.units.filter(u => u.team === 'enemy').forEach(u => { u.stance = 'hold_fire'; u.order = 'hold_position'; });
    rush(m, 'player'); play(m, 200);
    expect(m.state.gameOver).toBe(true);
    expect(m.state.winner).toBe('player');
    expect(m.state.gameResult).toBe('win');
    expect(m.state.capturePoints[0].owner).toBe('player');
    expect(m.state.duel!.score.player).toBeGreaterThanOrEqual(30);
    expect(snapshotFor(m, 'enemy').winner).toBe('player');
  });
  it('plays two scripted bots to a decision, identically every time', () => {
    const run = () => { const m = newMatch(9, { timeLimit: 150 }); rush(m, 'player'); rush(m, 'enemy'); play(m, 200); return m; };
    const a = run(), b = run();
    expect(a.state.gameOver).toBe(true);
    expect(a.state.winner === 'player' || a.state.winner === 'enemy' || a.state.winner === null).toBe(true);
    expect(a.state.time).toBeLessThanOrEqual(151);
    expect(stateDigest(a.state)).toBe(stateDigest(b.state));
  });
  it('declares the side with no units left the loser', () => {
    const m = newMatch(); m.state.units.filter(u => u.team === 'enemy').forEach(u => { u.alive = false; });
    stepMatch(m);
    expect(m.state.winner).toBe('player');
  });
});
