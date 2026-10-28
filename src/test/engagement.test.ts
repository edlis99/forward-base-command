import { beforeAll, describe, expect, it } from 'vitest';
import { createInitialState, createInputState, handleRightClickWorld, update } from '../game/engine';
import { createUnit, scoreTarget, setDestination } from '../game/units';
import { leipalingisMission } from '../game/missions';
import { GameState, Team, Unit, UnitType } from '../game/types';

/** Flat, open, fully visible test ground with no mission scripting. */
let base: GameState;
beforeAll(() => {
  base = createInitialState({ ...leipalingisMission, mapLayout: 'farmhouse_complex', init: () => ({}), update: () => {} });
});
function openState(): GameState {
  for (const row of base.terrain) for (const c of row) {
    Object.assign(c, { type: 'open', coverBonus: 0, concealment: 0, movementCost: 1, elevation: 1, blocksLOS: false,
      blocksMovement: false, vehicleImpassable: false, trampled: false, traction: 1, fatigueRate: 0, prop: undefined, exposure: 1 });
  }
  Object.assign(base, { units: [], script: {}, time: 0, playerSquads: [], nextMoveGroupId: 1, projectiles: [], wreckage: [],
    explosions: [], eventLog: [], ghostContacts: [], commandMarkers: [], threat: undefined, gameOver: false, gameResult: null });
  return base;
}
function add(state: GameState, type: UnitType, team: Team, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = Object.assign(createUnit(type, team, x, y), extra);
  state.units.push(u);
  return u;
}
function run(state: GameState, seconds: number, each?: () => void) {
  const input = createInputState();
  for (let i = 0; i < seconds / 0.05; i++) { update(state, input, 0.05); each?.(); }
}
const reveal = (state: GameState) => state.units.forEach(u => { u.detectionLevel = 1; u.spottedByEnemy = true; });

describe('suppression by weapon class', () => {
  it('does not pin a tank with rifle fire', () => {
    const state = openState();
    const tank = add(state, 'tank', 'player', 1000, 1000);
    for (let i = 0; i < 4; i++) add(state, 'infantry', 'enemy', 1100, 960 + i * 25, { stance: 'aggressive' });
    reveal(state);
    let pinnedFrames = 0;
    run(state, 20, () => { reveal(state); if (tank.prone && tank.suppression > .5) pinnedFrames++; });
    expect(pinnedFrames).toBe(0);
  });
  it('still pins infantry with rifle fire', () => {
    const state = openState();
    const rifleman = add(state, 'infantry', 'player', 1000, 1000, { stance: 'hold_fire' });
    for (let i = 0; i < 4; i++) add(state, 'infantry', 'enemy', 1090, 960 + i * 25, { stance: 'aggressive' });
    reveal(state);
    let maxSuppression = 0;
    run(state, 6, () => { reveal(state); maxSuppression = Math.max(maxSuppression, rifleman.suppression); });
    expect(maxSuppression).toBeGreaterThan(.5);
  });
});

describe('target selection', () => {
  it('prefers the enemy that is shooting at it over an equally near one', () => {
    const state = openState();
    const me = add(state, 'infantry', 'player', 1000, 1000);
    const shooter = add(state, 'infantry', 'enemy', 1100, 1000, { attackTarget: me.id, lastFireTime: 0 });
    const idle = add(state, 'infantry', 'enemy', 1100, 1010);
    expect(scoreTarget(me, shooter, 100, state)).toBeGreaterThan(scoreTarget(me, idle, 100, state));
  });
  it('drops an out-of-range target and fights the nearer enemy instead', () => {
    const state = openState();
    const me = add(state, 'infantry', 'player', 1000, 1000, { stance: 'defend' });
    const near = add(state, 'infantry', 'enemy', 1090, 1000, { stance: 'hold_fire' });
    const far = add(state, 'tank', 'enemy', 1200, 1000, { stance: 'hold_fire' });
    me.attackTarget = far.id; // e.g. set when the tank hit him from beyond his own range
    reveal(state);
    run(state, 8, () => reveal(state));
    expect(near.health).toBeLessThan(near.maxHealth);
  });
});

describe('ordered attack', () => {
  it('closes to firing range and engages a target that walks away', () => {
    const state = openState();
    const me = add(state, 'infantry', 'player', 600, 1000, { selected: true });
    const foe = add(state, 'infantry', 'enemy', 1000, 1000, { stance: 'hold_fire' });
    reveal(state);
    handleRightClickWorld(1000, 1000, state);
    setDestination(foe, state, { x: 1400, y: 1000 }); foe.order = 'move';
    run(state, 25, () => reveal(state));
    expect(foe.health).toBeLessThan(foe.maxHealth);
    expect(Math.hypot(me.pos.x - foe.pos.x, me.pos.y - foe.pos.y)).toBeLessThan(me.range + 40);
  });
  it('stands down when the target is dead', () => {
    const state = openState();
    const me = add(state, 'infantry', 'player', 600, 1000, { selected: true });
    const foe = add(state, 'infantry', 'enemy', 900, 1000, { stance: 'hold_fire' });
    reveal(state);
    handleRightClickWorld(900, 1000, state);
    expect(me.order).toBe('attack');
    foe.alive = false;
    run(state, 1);
    expect(me.order).toBe('idle');
    expect(me.attackTarget).toBeNull();
  });
  it('gives up after losing sight of the target for too long', () => {
    const state = openState();
    const me = add(state, 'infantry', 'player', 600, 1000, { selected: true });
    const foe = add(state, 'infantry', 'enemy', 1500, 1000, { stance: 'hold_fire' });
    reveal(state);
    handleRightClickWorld(1500, 1000, state);
    foe.detectionLevel = 0; foe.spottedByEnemy = false;
    run(state, 14, () => { foe.detectionLevel = 0; foe.spottedByEnemy = false; });
    expect(me.order).toBe('idle');
  });
});

describe('attack-move versus move', () => {
  it('halts to fight a contact, then resumes the advance and reaches the objective', () => {
    const state = openState();
    const squad = [0, 1, 2, 3].map(i => add(state, 'infantry', 'player', 600, 1000 + i * 20, { selected: true }));
    const foes = [0, 1].map(i => add(state, 'infantry', 'enemy', 900, 1100 + i * 20, { stance: 'defend', order: 'hold_position' }));
    handleRightClickWorld(1300, 1020, state, false, true);
    let sawEngaging = false;
    run(state, 150, () => { if (squad.some(u => u.engaging)) sawEngaging = true; });
    expect(sawEngaging).toBe(true);
    expect(foes.every(f => !f.alive)).toBe(true);
    const survivors = squad.filter(u => u.alive);
    expect(survivors.length).toBeGreaterThan(0);
    expect(Math.max(...survivors.map(u => u.pos.x))).toBeGreaterThan(1200);
    expect(survivors.every(u => !u.engaging)).toBe(true);
  });
  it('never halts a plain move order for a contact', () => {
    const state = openState();
    const squad = [0, 1].map(i => add(state, 'infantry', 'player', 600, 1000 + i * 20, { selected: true }));
    add(state, 'infantry', 'enemy', 900, 1100, { stance: 'defend', order: 'hold_position' });
    handleRightClickWorld(1300, 1020, state);
    let engaged = false;
    run(state, 40, () => { if (squad.some(u => u.engaging)) engaged = true; });
    expect(engaged).toBe(false);
  });
});
