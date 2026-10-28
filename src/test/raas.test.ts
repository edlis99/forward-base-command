import { describe, expect, it } from 'vitest';
import { attackIndex, makeRaasMission, pickChain, RaasChain, RaasRules } from '../game/raas';
import { createMatch, Match, replayMatch, snapshotFor, stateDigest, stepMatch, submitCommand, TICK_RATE } from '../game/match';
import { createUnit } from '../game/units';
import { GameState, Team, UnitType } from '../game/types';

const Y = 5000;
const chain: RaasChain = { id: 'test', name: 'Test lane', objectives: [0, 1, 2, 3, 4].map(i => ({ id: `o${i}`, name: `Obj ${i}`, pos: { x: 3000 + i * 1000, y: Y }, radius: 140 })) };
function flatten(state: GameState) {
  for (const row of state.terrain) for (const c of row) {
    Object.assign(c, { type: 'open', coverBonus: 0, concealment: 0, movementCost: 1, elevation: 1, blocksLOS: false,
      blocksMovement: false, vehicleImpassable: false, trampled: false, traction: 1, fatigueRate: 0, prop: undefined, exposure: 1 });
  }
}
const mission = (rules: Partial<RaasRules> = {}) => makeRaasMission({
  name: 'RAAS test', mapLayout: 'farmhouse_complex', mapSeed: 3, chain, rules,
  mains: { player: { x: 2000, y: Y }, enemy: { x: 8000, y: Y } }, composition: { infantry: 4, tank: 1, apc: 0 },
});
/** Empty match; tests place exactly the soldiers they need (hold fire, so only capture rules act). */
function bare(rules: Partial<RaasRules> = {}, controllers?: Record<Team, 'human' | 'ai'>): Match {
  const m = createMatch(mission(rules), { seed: 1, setup: flatten, controllers });
  return m;
}
function place(m: Match, team: Team, n: number, x: number, type: UnitType = 'infantry') {
  for (let i = 0; i < n; i++) {
    const u = createUnit(type, team, x + (i % 3) * 14, Y + Math.floor(i / 3) * 14 - 14);
    u.stance = 'hold_fire'; u.homePos = { ...u.pos }; u.order = 'hold_position';
    m.state.units.push(u);
  }
}
/** Keep both sides alive (elimination ends the match) without them interfering. */
function reserves(m: Match) { m.state.units = []; place(m, 'player', 1, 1500); place(m, 'enemy', 1, 8500); }
const run = (m: Match, seconds: number) => { for (let i = 0; i < seconds * TICK_RATE && !m.state.gameOver; i++) stepMatch(m); };
const obj = (m: Match, i: number) => m.state.raas!.objectives[i];

describe('RAAS objective sequence', () => {
  it('starts with each side holding the point beside its main and the middle neutral', () => {
    const m = bare(); run(m, 0.1);
    expect(m.state.raas!.objectives.map(o => o.owner)).toEqual(['player', 'neutral', 'neutral', 'neutral', 'enemy']);
    expect(attackIndex(m.state.raas!.objectives, 'player')).toBe(1);
    expect(attackIndex(m.state.raas!.objectives, 'enemy')).toBe(3);
  });
  it('ignores infantry on an objective that is not next in the sequence', () => {
    const m = bare(); reserves(m); place(m, 'player', 4, 5000); run(m, 60);
    expect(obj(m, 2).owner).toBe('neutral');
    expect(obj(m, 2).progress).toBe(0);
    expect(obj(m, 2).reason).toContain('previous objective');
  });
  it('captures the next neutral point after sustained occupation, and unlocks the one after', () => {
    const m = bare(); reserves(m); place(m, 'player', 1, 4000);
    run(m, 30); expect(obj(m, 1).owner).toBe('neutral');
    run(m, 15); expect(obj(m, 1).owner).toBe('player');
    expect(attackIndex(m.state.raas!.objectives, 'player')).toBe(2);
  });
  it('a runner passing through does nothing: abandoned progress drains away', () => {
    const m = bare(); reserves(m); place(m, 'player', 2, 4000);
    run(m, 8);
    const partial = obj(m, 1).progress;
    expect(partial).toBeGreaterThan(0);
    m.state.units = m.state.units.filter(u => !(u.team === 'player' && Math.abs(u.pos.x - 4000) < 200));
    run(m, 30);
    expect(obj(m, 1).progress).toBe(0);
    expect(obj(m, 1).owner).toBe('neutral');
  });
  it('needs a minimum commitment to neutralise an enemy point', () => {
    const m = bare(); reserves(m);
    m.state.raas!.objectives[1].owner = 'player'; m.state.raas!.objectives[1].progress = 1;
    m.state.raas!.objectives[2].owner = 'player'; m.state.raas!.objectives[2].progress = 1;
    m.state.raas!.objectives[3].owner = 'enemy'; m.state.raas!.objectives[3].progress = -1;
    place(m, 'player', 1, 6000); run(m, 60);
    expect(obj(m, 3).owner).toBe('enemy');
    expect(obj(m, 3).reason).toContain('needs 2');
    place(m, 'player', 1, 6020); run(m, 41);
    expect(obj(m, 3).owner).toBe('neutral');
    run(m, 41);
    expect(obj(m, 3).owner).toBe('player');
  });
  it('equal infantry stalls; a clear majority beats a lone defender', () => {
    const m = bare(); reserves(m); place(m, 'player', 2, 4000); place(m, 'enemy', 2, 4030);
    run(m, 40);
    expect(obj(m, 1).progress).toBe(0);
    expect(obj(m, 1).status).toBe('contested');
    const defender = m.state.units.find(u => u.team === 'enemy' && Math.abs(u.pos.x - 4030) < 100)!;
    m.state.units = m.state.units.filter(u => u !== defender); // one defender left against two attackers
    run(m, 45);
    expect(obj(m, 1).owner).toBe('player');
  });
  it('caps how much a big crowd speeds up capture', () => {
    const m = bare(); reserves(m); place(m, 'player', 12, 4000);
    run(m, 15); expect(obj(m, 1).owner).toBe('neutral'); // 40 s / 2x cap = 20 s at best
    run(m, 6); expect(obj(m, 1).owner).toBe('player');
  });
  it('double neutral: each side must restore its own lost point before attacking again', () => {
    const m = bare(); reserves(m);
    const o = m.state.raas!.objectives;
    Object.assign(o[1], { owner: 'neutral', progress: 0 }); // player lost its forward point
    Object.assign(o[3], { owner: 'neutral', progress: 0 }); // enemy lost its forward point
    expect(attackIndex(o, 'player')).toBe(1);
    expect(attackIndex(o, 'enemy')).toBe(3);
  });
});

describe('RAAS tickets and outcome', () => {
  it('charges tickets for losses and for losing a point', () => {
    const m = bare({ minToNeutralise: 1 }); reserves(m); place(m, 'player', 1, 4000, 'tank');
    const tank = m.state.units.find(u => u.type === 'tank')!;
    tank.alive = false; run(m, 0.1);
    expect(m.state.raas!.tickets.player).toBe(300 - 25);
    Object.assign(obj(m, 1), { owner: 'enemy', progress: -1 });
    Object.assign(obj(m, 2), { owner: 'enemy', progress: -1 }); Object.assign(obj(m, 3), { owner: 'enemy', progress: -1 });
    place(m, 'player', 3, 4000); run(m, 45);
    expect(obj(m, 1).owner).not.toBe('enemy');
    expect(m.state.raas!.tickets.enemy).toBeLessThanOrEqual(300 - 20);
  });
  it('a clear territorial lead bleeds the opponent until it loses', () => {
    const m = bare({ startTickets: 30 }); reserves(m);
    const o = m.state.raas!.objectives;
    for (const i of [1, 2]) Object.assign(o[i], { owner: 'player', progress: 1 });
    run(m, 200);
    expect(m.state.gameOver).toBe(true);
    expect(m.state.winner).toBe('player');
    expect(m.state.raas!.tickets.enemy).toBeLessThanOrEqual(0);
  });
  it('a side with no units left loses', () => {
    const m = bare(); m.state.units = []; place(m, 'player', 1, 1500); stepMatch(m);
    expect(m.state.winner).toBe('player');
  });
});

describe('RAAS chain pool, AI and determinism', () => {
  it('draws chains deterministically from the pool and uses all of them', () => {
    const pool = ['a', 'b', 'c'].map(id => ({ ...chain, id }));
    expect(pickChain(pool, 42).id).toBe(pickChain(pool, 42).id);
    const seen = new Set(Array.from({ length: 60 }, (_, s) => pickChain(pool, s).id));
    expect(seen.size).toBe(3);
  });
  it('the AI commander captures its next objective when unopposed', () => {
    const m = bare({}, { player: 'human', enemy: 'ai' });
    m.state.units.filter(u => u.team === 'player').forEach(u => { u.stance = 'hold_fire'; });
    run(m, 150);
    expect(obj(m, 3).owner).toBe('enemy');
  });
  it('replays an AI-versus-AI RAAS match identically', () => {
    const opts = { seed: 4, setup: flatten, controllers: { player: 'ai', enemy: 'ai' } as Record<Team, 'human' | 'ai'> };
    const a = createMatch(mission({ timeLimit: 120 }), opts); run(a, 125);
    const b = replayMatch(mission({ timeLimit: 120 }), opts, a.log, a.tick);
    expect(stateDigest(b.state)).toBe(stateDigest(a.state));
    expect(a.state.gameOver).toBe(true);
  });
  it('tells each side which objective it may attack, without enemy head counts', () => {
    const m = bare(); run(m, 0.1);
    const view = snapshotFor(m, 'player').raas!;
    expect(view.objectives.map(o => o.yourTurn)).toEqual([false, true, false, false, false]);
    expect(snapshotFor(m, 'enemy').raas!.objectives[3].yourTurn).toBe(true);
    expect(JSON.stringify(view)).not.toContain('present');
  });
});
