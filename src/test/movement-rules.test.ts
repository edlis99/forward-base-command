import { beforeAll, describe, expect, it } from 'vitest';
import { createInitialState, createInputState, handleRightClickWorld, loadOrUnloadSelected, update } from '../game/engine';
import { createUnit } from '../game/units';
import { SETTLEMENTS } from '../game/maps/settlements';
import { leipalingisMission } from '../game/missions';
import { GameState, Team, Unit, UnitType } from '../game/types';

let base: GameState;
beforeAll(() => { base = createInitialState({ ...leipalingisMission, mapLayout: 'farmhouse_complex', init: () => ({}), update: () => {} }); });
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
  const u = Object.assign(createUnit(type, team, x, y), extra); state.units.push(u); return u;
}
function run(state: GameState, seconds: number, each?: () => void) {
  const input = createInputState();
  for (let i = 0; i < seconds / 0.05; i++) { update(state, input, 0.05); each?.(); }
}
const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (r: number) => r * 180 / Math.PI;

describe('M1 / M2: hulls drive along their heading', () => {
  it('tanks drive along their hull: no sideways sliding, in any direction', () => {
    for (const dest of [[1500, 1000], [1000, 1500], [500, 1000]]) {
      const s = openState();
      const tanks = [0, 1, 2].map(i => add(s, 'tank', 'player', 1000, 1000 + i * 40, { selected: true, facing: 0 }));
      handleRightClickWorld(dest[0], dest[1], s);
      let worst = 0;
      run(s, 40, () => tanks.forEach(u => {
        if (Math.hypot(u.vel.x, u.vel.y) < u.speed * .2) return;
        const d = Math.abs(norm(Math.atan2(u.vel.y, u.vel.x) - u.facing));
        worst = Math.max(worst, Math.min(d, Math.PI - d));
      }));
      expect(deg(worst)).toBeLessThan(15);
      expect(tanks.every(u => !u.targetPos)).toBe(true);
    }
  });
  it('a tank pivots before it drives off sideways', () => {
    const s = openState();
    const tank = add(s, 'tank', 'player', 1000, 1000, { selected: true, facing: 0 });
    handleRightClickWorld(1000, 1600, s);
    let fastWhileMisaligned = 0;
    run(s, 10, () => {
      const off = Math.abs(norm(Math.PI / 2 - tank.facing));
      if (off > Math.PI / 3 && Math.hypot(tank.vel.x, tank.vel.y) > tank.speed * .35) fastWhileMisaligned++;
    });
    expect(fastWhileMisaligned).toBe(0);
  });
});

describe('M3: reversing', () => {
  it('reverses a short hop back and keeps its front where it was', () => {
    const s = openState();
    const tank = add(s, 'tank', 'player', 1000, 1000, { selected: true, facing: 0 });
    handleRightClickWorld(1000 - 4 * 32, 1000, s);
    let reversingFrames = 0;
    run(s, 25, () => { if (tank.reversing) reversingFrames++; });
    expect(reversingFrames).toBeGreaterThan(10);
    expect(tank.targetPos).toBeNull();
    expect(Math.abs(deg(norm(tank.facing)))).toBeLessThan(30);
    expect(Math.abs(tank.pos.x - (1000 - 4 * 32))).toBeLessThan(40);
  });
  it('turns round for a long move back', () => {
    const s = openState();
    const tank = add(s, 'tank', 'player', 1000, 1000, { selected: true, facing: 0 });
    handleRightClickWorld(1000 - 20 * 32, 1000, s);
    let reversingFrames = 0;
    run(s, 40, () => { if (tank.reversing) reversingFrames++; });
    expect(reversingFrames).toBe(0);
    expect(Math.abs(deg(norm(tank.facing - Math.PI)))).toBeLessThan(30);
  });
  it('infantry never use the reversing rule', () => {
    const s = openState();
    const man = add(s, 'infantry', 'player', 1000, 1000, { selected: true, facing: 0 });
    handleRightClickWorld(1000 - 3 * 32, 1000, s);
    let reversing = 0;
    run(s, 10, () => { if (man.reversing) reversing++; });
    expect(reversing).toBe(0);
  });
});

describe('M9: loading and unloading with U', () => {
  it('U loads selected infantry into the selected APC', () => {
    const s = openState();
    const apc = add(s, 'apc', 'player', 1000, 1000, { selected: true });
    const men = [0, 1, 2].map(i => add(s, 'infantry', 'player', 1100, 960 + i * 30, { selected: true }));
    loadOrUnloadSelected(s);
    expect(men.every(m => m.boardTarget === apc.id)).toBe(true);
    run(s, 20);
    expect(men.every(m => m.insideOf === apc.id)).toBe(true);
    expect(apc.passengers).toHaveLength(3);
  });
  it('fills each APC up to four seats and reports who is left behind', () => {
    const s = openState();
    const a = add(s, 'apc', 'player', 1000, 1000, { selected: true });
    const b = add(s, 'apc', 'player', 1000, 1300, { selected: true });
    const men = Array.from({ length: 9 }, (_, i) => add(s, 'infantry', 'player', 1150, 900 + i * 40, { selected: true }));
    loadOrUnloadSelected(s);
    expect(men.filter(m => m.boardTarget === a.id)).toHaveLength(4);
    expect(men.filter(m => m.boardTarget === b.id)).toHaveLength(4);
    expect(s.eventLog[0].message).toContain('1 left behind');
  });
  it('U unloads when only APCs are selected', () => {
    const s = openState();
    const apc = add(s, 'apc', 'player', 1000, 1000, { selected: true });
    const men = [0, 1].map(i => add(s, 'infantry', 'player', 1060, 990 + i * 30, { selected: true }));
    loadOrUnloadSelected(s); run(s, 15);
    expect(apc.passengers).toHaveLength(2);
    men.forEach(m => { m.selected = false; });
    loadOrUnloadSelected(s);
    expect(apc.passengers).toHaveLength(0);
    expect(men.every(m => !m.insideOf)).toBe(true);
  });
});

describe('M10 / M11: road convoys and spacing', () => {
  const nearest = (u: Unit, others: Unit[]) => Math.min(...others.filter(o => o !== u).map(o => Math.hypot(o.pos.x - u.pos.x, o.pos.y - u.pos.y))) / 32;
  it('drives a long road move as a spaced column that stays on the road, then deploys', () => {
    const s = createInitialState({ ...leipalingisMission, init: () => ({}), update: () => {} });
    s.units = [];
    const J = SETTLEMENTS.find(t => t.id === 'jovaisiai')!, L = SETTLEMENTS.find(t => t.id === 'leipalingis')!;
    const types: UnitType[] = ['tank', 'tank', 'apc', 'apc', 'infantry', 'infantry', 'infantry', 'infantry'];
    // Start on open road just outside Jovaisiai (not inside its houses, where a vehicle cannot stand).
    const roadNear = (cx: number, cy: number) => {
      let best = { x: 0, y: 0 }, bd = Infinity;
      for (let y = cy - 12; y <= cy + 12; y++) for (let x = cx - 12; x <= cx + 12; x++) {
        const c = s.terrain[y][x];
        if (c.type === 'road' && !c.settlementId && Math.hypot(x - cx, y - cy) < bd) { bd = Math.hypot(x - cx, y - cy); best = { x: (x + .5) * 32, y: (y + .5) * 32 }; }
      }
      return best;
    };
    const start = roadNear(J.x, J.y + 10);
    const group = types.map((t, i) => add(s, t, 'player', start.x + (i % 4 - 1.5) * 30, start.y + Math.floor(i / 4) * 30, { selected: true }));
    // Destination: open road on route 180 short of Leipalingis (not inside the town, where units would occupy buildings).
    let dest = { x: 0, y: 0 }, best = Infinity;
    for (let y = L.y - 30; y < L.y - 12; y++) for (let x = L.x - 12; x < L.x + 12; x++) {
      const c = s.terrain[y][x];
      if (c.type === 'road' && !c.settlementId && Math.abs(y - (L.y - 20)) < best) { best = Math.abs(y - (L.y - 20)); dest = { x: (x + .5) * 32, y: (y + .5) * 32 }; }
    }
    handleRightClickWorld(dest.x, dest.y, s);
    expect(group.filter(u => u.convoyAhead).length).toBe(group.length - 1);
    const veh = group.filter(u => u.type !== 'infantry');
    let onRoad = 0, moving = 0; const gaps: number[] = [];
    run(s, 300, () => {
      if (Math.round(s.time * 20) % 20) return;
      for (const u of veh) {
        if (!u.targetPos || Math.hypot(u.vel.x, u.vel.y) < 3 || !u.convoyAhead) continue;
        // The march itself; in the last stretch units leave the road to deploy into formation.
        if (u.finalDest && Math.hypot(u.finalDest.x - u.pos.x, u.finalDest.y - u.pos.y) < 15 * 32) continue;
        moving++;
        const c = s.terrain[Math.floor(u.pos.y / 32)][Math.floor(u.pos.x / 32)];
        if (c.type === 'road' || c.type === 'gravel') onRoad++;
        gaps.push(nearest(u, veh.filter(o => o.targetPos)));
      }
    });
    gaps.sort((a, b) => a - b);
    // Measured on this route: 78% before the road-march rule, 88% after.
    expect(onRoad / moving).toBeGreaterThan(.85);
    expect(gaps[gaps.length >> 1]).toBeGreaterThan(2);
    // Robust low end of the march (the moment of pulling out side by side at the start is excluded by the percentile).
    expect(gaps[Math.floor(gaps.length * .1)]).toBeGreaterThan(1.5);
    expect(group.every(u => !u.targetPos)).toBe(true);
    expect(group.every(u => !u.convoyAhead)).toBe(true);
  }, 60000);
  it('does not form a column for a short move or a cross-country move', () => {
    const s = openState();
    const group = ['tank', 'tank', 'apc'].map((t, i) => add(s, t as UnitType, 'player', 1000 + i * 60, 1000, { selected: true }));
    handleRightClickWorld(1300, 1100, s);
    expect(group.some(u => u.convoyAhead)).toBe(false);
    handleRightClickWorld(1000 + 60 * 32, 1000, s); // long, but no roads on the open test ground
    expect(group.some(u => u.convoyAhead)).toBe(false);
  });
  it('spreads units out in formation: vehicles about a hull length or more apart, infantry not bunched', () => {
    const s = openState();
    const veh = ['tank', 'tank', 'apc', 'apc'].map((t, i) => add(s, t as UnitType, 'player', 1000 + i * 30, 1000, { selected: true }));
    const inf = [0, 1, 2, 3, 4].map(i => add(s, 'infantry', 'player', 1000 + i * 20, 1100, { selected: true }));
    handleRightClickWorld(1600, 1050, s);
    run(s, 60);
    // Measured before these rules: APCs 0.55 cells apart, closest infantry 0.43.
    for (const u of veh) expect(nearest(u, veh)).toBeGreaterThan(.9);
    for (const u of inf) expect(nearest(u, inf)).toBeGreaterThan(.5);
  });
});
