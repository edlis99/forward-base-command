import { describe, expect, it } from 'vitest';
import { attackIndex, knownTo, makeRaasMission, pickChain, RaasChain, RaasRules } from '../game/raas';
import { applyCommand } from '../game/commands';
import { FOB_RULES } from '../game/fob';
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
// The capture-rule tests below use the Squad starting state (each side owns
// its first point) and reveal everything; the newer defaults are tested further down.
const mission = (rules: Partial<RaasRules> = {}, composition = { infantry: 4, tank: 1, apc: 0 }) => makeRaasMission({
  name: 'RAAS test', mapLayout: 'farmhouse_complex', mapSeed: 3, chain, rules: { startOwned: true, progressiveReveal: false, ...rules },
  mains: { player: { x: 2000, y: Y }, enemy: { x: 8000, y: Y } }, composition,
});
/** Empty match; tests place exactly the soldiers they need (hold fire, so only capture rules act). */
function bare(rules: Partial<RaasRules> = {}, controllers?: Record<Team, 'human' | 'ai'>, composition?: { infantry: number; tank: number; apc: number }): Match {
  const m = createMatch(mission(rules, composition), { seed: 1, setup: flatten, controllers });
  return m;
}
function place(m: Match, team: Team, n: number, x: number, type: UnitType = 'infantry') {
  for (let i = 0; i < n; i++) {
    const u = createUnit(type, team, x + (i % 3) * 14, Y + Math.floor(i / 3) * 14 - 14);
    u.stance = 'hold_fire'; u.homePos = { ...u.pos }; u.order = 'hold_position';
    m.state.units.push(u);
  }
}
/** Move the most recently placed soldier to (x, y) and make that its hold position. */
function moveLast(m: Match, x: number, y: number) { const u = m.state.units[m.state.units.length - 1]; u.pos = { x, y }; u.homePos = { x, y }; }
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

describe('RAAS default start and reveal', () => {
  it('starts every point neutral, so the first objective must be taken before the second', () => {
    const m = bare({ startOwned: false }); reserves(m); place(m, 'player', 4, 4000); run(m, 60);
    expect(obj(m, 0).owner).toBe('neutral');
    expect(obj(m, 1).owner).toBe('neutral'); // standing on the second point does nothing yet
    place(m, 'player', 2, 3000); run(m, 45);
    expect(obj(m, 0).owner).toBe('player');
    run(m, 40);
    expect(obj(m, 1).owner).toBe('player');
  });
  it('reveals objectives as a side advances, separately for each side', () => {
    const m = bare({ startOwned: false, progressiveReveal: true }); reserves(m); run(m, 0.1);
    expect(knownTo(m.state.raas!, 'player')).toEqual([true, false, false, false, false]);
    expect(knownTo(m.state.raas!, 'enemy')).toEqual([false, false, false, false, true]);
    expect(m.state.capturePoints.map(c => c.id)).toEqual(['o0']);
    expect(snapshotFor(m, 'enemy').raas!.objectives.map(o => o.id)).toEqual(['o4']);
    place(m, 'player', 2, 3000); run(m, 45);
    expect(knownTo(m.state.raas!, 'player')).toEqual([true, true, false, false, false]);
  });
});

describe('RAAS radios, spawn points and reinforcements', () => {
  const apcAt = (m: Match, team: Team, x: number) => {
    const u = createUnit('apc', team, x, Y + 300); u.stance = 'hold_fire'; m.state.units.push(u); return u;
  };
  it('lets a stopped APC deploy a radio, but not near an objective or another radio', () => {
    const m = bare(); reserves(m);
    const near = apcAt(m, 'player', 3000); near.pos.y = Y + 100;
    expect(applyCommand(m.state, 'player', { type: 'build_radio', unitId: near.id })).toEqual({ ok: false, reason: 'too close to an objective' });
    const apc = apcAt(m, 'player', 3500);
    expect(applyCommand(m.state, 'player', { type: 'build_radio', unitId: apc.id }).ok).toBe(true);
    const second = apcAt(m, 'player', 3700);
    expect(applyCommand(m.state, 'player', { type: 'build_radio', unitId: second.id })).toEqual({ ok: false, reason: 'too close to another friendly radio' });
    const foot = m.state.units.find(u => u.type === 'infantry' && u.team === 'player')!;
    expect(applyCommand(m.state, 'player', { type: 'build_radio', unitId: foot.id }).ok).toBe(false);
  });
  it('builds a spawn point only with two infantry on site and no enemy close, then marks it overrun', () => {
    const m = bare(); reserves(m);
    const apc = apcAt(m, 'player', 3500);
    applyCommand(m.state, 'player', { type: 'build_radio', unitId: apc.id });
    const site = { x: 3560, y: Y + 300 };
    expect(applyCommand(m.state, 'player', { type: 'build_spawn', x: site.x + 2000, y: site.y }).ok).toBe(false); // outside radio radius
    expect(applyCommand(m.state, 'player', { type: 'build_spawn', ...site }).ok).toBe(true);
    const fob = m.state.raas!.fobs[0];
    place(m, 'player', 1, site.x); moveLast(m, site.x, site.y);
    run(m, FOB_RULES.habBuildSeconds + 2);
    expect(fob.hab!.built).toBe(false);
    place(m, 'player', 1, site.x + 10); moveLast(m, site.x + 10, site.y);
    run(m, FOB_RULES.habBuildSeconds + 2);
    expect(fob.hab!.built).toBe(true);
    place(m, 'enemy', 1, site.x + 120); moveLast(m, site.x + 120, site.y);
    run(m, 0.2);
    expect(fob.overrun).toBe(true);
  });
  it('brings a lost soldier back after a delay at the forward spawn point, and charges tickets for the loss', () => {
    const m = bare(); reserves(m);
    const apc = apcAt(m, 'player', 3500);
    applyCommand(m.state, 'player', { type: 'build_radio', unitId: apc.id });
    applyCommand(m.state, 'player', { type: 'build_spawn', x: 3560, y: Y + 300 });
    const fob = m.state.raas!.fobs[0];
    fob.hab!.built = true; fob.hab!.progress = 1;
    const victim = createUnit('infantry', 'player', 4500, Y); m.state.units.push(victim);
    run(m, 0.1); victim.alive = false; run(m, 0.1);
    expect(m.state.raas!.tickets.player).toBe(300 - 5);
    expect(m.state.raas!.reserve).toHaveLength(1);
    const before = m.state.units.length;
    run(m, FOB_RULES.respawnSeconds.infantry + 1);
    const fresh = m.state.units.slice(before);
    expect(fresh).toHaveLength(1);
    expect(Math.hypot(fresh[0].pos.x - 3560, fresh[0].pos.y - (Y + 300))).toBeLessThan(4 * 32);
  });
  it('returns vehicles at the main, and stops reinforcing a side with no tickets', () => {
    const m = bare(); reserves(m);
    const tank = createUnit('tank', 'player', 4500, Y); m.state.units.push(tank);
    run(m, 0.1); tank.alive = false; run(m, FOB_RULES.respawnSeconds.tank + 1);
    const back = m.state.units.find(u => u.type === 'tank' && u.alive && u.team === 'player')!;
    expect(Math.hypot(back.pos.x - 2000, back.pos.y - Y)).toBeLessThan(5 * 32);
    m.state.raas!.tickets.player = 3;
    back.alive = false; run(m, 1);
    expect(m.state.raas!.reserve.filter(q => q.team === 'player')).toHaveLength(0);
  });
  it('lets enemies dig down an undefended radio, taking its spawn point with it', () => {
    const m = bare(); reserves(m);
    const apc = apcAt(m, 'player', 3500);
    applyCommand(m.state, 'player', { type: 'build_radio', unitId: apc.id });
    m.state.units = m.state.units.filter(u => u !== apc);
    place(m, 'enemy', 1, 3500); moveLast(m, 3500, Y + 300);
    run(m, FOB_RULES.digSeconds + 1);
    expect(m.state.raas!.fobs[0].alive).toBe(false);
    expect(m.state.raas!.tickets.player).toBe(300 - FOB_RULES.radioLossTickets);
  });
});

describe('RAAS win conditions', () => {
  it('does not end the match when a side is wiped out but reinforcements are on the way', () => {
    const m = bare(); m.state.units = []; place(m, 'player', 1, 1500); place(m, 'enemy', 1, 8500);
    run(m, 0.1); m.state.units.filter(u => u.team === 'enemy').forEach(u => { u.alive = false; });
    run(m, 1);
    expect(m.state.gameOver).toBe(false);
    run(m, 25);
    expect(m.state.units.some(u => u.team === 'enemy' && u.alive)).toBe(true);
  });
  it('drains a side that has lost every objective fast', () => {
    const m = bare({ startTickets: 100, bleedLead: 99 }); reserves(m);
    m.state.raas!.objectives.forEach(o => { o.owner = 'player'; o.progress = 1; });
    run(m, 30);
    expect(m.state.raas!.tickets.enemy).toBeLessThanOrEqual(100 - 29);
  });
  it('the AI builds a radio and a spawn point on its own', () => {
    const m = bare({}, { player: 'human', enemy: 'ai' }, { infantry: 4, tank: 1, apc: 1 });
    m.state.units.filter(u => u.team === 'player').forEach(u => { u.stance = 'hold_fire'; });
    run(m, 150);
    const fob = m.state.raas!.fobs.find(f => f.team === 'enemy');
    expect(fob).toBeDefined();
    expect(fob!.hab?.built).toBe(true);
  });
});
