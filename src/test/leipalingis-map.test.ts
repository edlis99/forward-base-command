import { describe, expect, it, vi, afterEach } from 'vitest';
import { createInitialState, handleRightClickWorld } from '../game/engine';
import { createUnit, distance, moveUnit, setDestination, updateCombat } from '../game/units';
import { generateTerrain, getTerrainAt, hasLineOfSight, isFootprintPassable, isWorldFootprintPassable, setTerrain } from '../game/terrain';
import { findPath } from '../game/pathfinding';
import { updateAwareness } from '../game/awareness';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { leipalingisMission } from '../game/missions';
import { LEIPALINGIS_ANCHORS, LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { refreshUnitGrid } from '../game/spatialGrid';
import { Position } from '../game/types';

const world = (x: number, y: number): Position => ({ x: (x + .5) * CELL_SIZE, y: (y + .5) * CELL_SIZE });
function flat() {
  const state = createInitialState({ ...leipalingisMission, mapLayout: 'farmhouse_complex', init: () => ({}) });
  for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) setTerrain(state.terrain, x, y, 'open');
  return state;
}
afterEach(() => vi.restoreAllMocks());

describe('road movement and exposure', () => {
  it('keeps a faster road detour through A* smoothing instead of cutting across a field', () => {
    const { terrain } = flat();
    for (let x = 10; x <= 40; x++) setTerrain(terrain, x, 6, 'road');
    for (let y = 6; y <= 10; y++) { setTerrain(terrain, 10, y, 'road'); setTerrain(terrain, 40, y, 'road'); }
    const start = world(10, 10), end = world(40, 10);
    const path = findPath(terrain, start, end, 'infantry');
    expect(path.length).toBeGreaterThan(1);
    expect(path.some(p => p.y < world(0, 8).y)).toBe(true);
    let cost = 0, previous = start;
    for (const p of path) {
      const length = Math.hypot(p.x - previous.x, p.y - previous.y);
      const steps = Math.ceil(length / 3);
      for (let i = 1; i <= steps; i++) {
        const c = getTerrainAt(terrain, previous.x + (p.x - previous.x) * i / steps, previous.y + (p.y - previous.y) * i / steps)!;
        cost += length / steps * c.movementCost / c.traction;
      }
      previous = p;
    }
    expect(cost).toBeLessThan((end.x - start.x) * .94);
  });
  it('actually moves infantry faster on asphalt than open ground', () => {
    const travel = (road: boolean) => {
      const state = flat(), pos = world(20, 20);
      if (road) for (let x = 18; x <= 40; x++) setTerrain(state.terrain, x, 20, 'road');
      const unit = createUnit('infantry', 'player', pos.x, pos.y); state.units = [unit]; unit.facing = 0;
      setDestination(unit, state, world(40, 20)); unit.order = 'move';
      for (let i = 0; i < 60; i++) { state.time += 1 / 60; moveUnit(unit, 1 / 60, state); }
      return unit.pos.x - pos.x;
    };
    expect(travel(true) / travel(false)).toBeGreaterThan(1.4);
  });
  it('builds detection 50% faster on asphalt, and slower behind hay bales', () => {
    const state = flat();
    const observer = createUnit('infantry', 'player', world(20, 20).x, world(20, 20).y);
    const target = createUnit('infantry', 'enemy', world(22, 20).x, world(22, 20).y);
    state.units = [observer, target]; observer.attackTimer = target.attackTimer = 0;
    updateAwareness(state, .1); const openDetection = target.detectionLevel;
    setTerrain(state.terrain, 22, 20, 'road'); target.detectionLevel = 0;
    updateAwareness(state, .1); expect(target.detectionLevel / openDetection).toBeCloseTo(1.5);
    setTerrain(state.terrain, 22, 20, 'sandbag'); state.terrain[20][22].concealment = .38; target.detectionLevel = 0;
    updateAwareness(state, .1); expect(target.detectionLevel).toBeLessThan(openDetection);
  });
  it('ends at the reachable snapped position when a requested tank destination is blocked', () => {
    const { terrain } = flat(); setTerrain(terrain, 30, 20, 'urban');
    const blocked = world(30, 20), path = findPath(terrain, world(20, 20), blocked, 'tank');
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).not.toEqual(blocked);
    const end = path[path.length - 1];
    expect(isFootprintPassable(terrain, Math.floor(end.x / CELL_SIZE), Math.floor(end.y / CELL_SIZE), true, false)).toBe(true);
  });
});

describe('usable tactical objects', () => {
  it('assigns separate cover positions, reaches them and holds until replaced', () => {
    const state = flat();
    state.units = [20, 21].map(y => createUnit('infantry', 'player', world(20, y).x, world(20, y).y));
    state.units.forEach(u => { u.selected = true; });
    for (const y of [20, 22]) { setTerrain(state.terrain, 23, y, 'sandbag'); state.terrain[y][23].prop = 'stone_wall'; }
    const at = world(23, 20); handleRightClickWorld(at.x, at.y, state);
    expect(new Set(state.units.map(u => JSON.stringify(u.finalDest))).size).toBe(2);
    expect(state.units.every(u => u.holdOnArrive)).toBe(true);
    for (let i = 0; i < 900; i++) { state.time += 1 / 60; refreshUnitGrid(state); state.units.forEach(u => moveUnit(u, 1 / 60, state)); }
    expect(state.units.every(u => u.order === 'hold_position' && u.inCover)).toBe(true);
    const next = world(30, 20); handleRightClickWorld(next.x, next.y, state);
    expect(state.units.every(u => u.order === 'move' && !u.holdOnArrive)).toBe(true);
  });
  it('allows fire from occupied buildings but blocks fire through an intermediate building', () => {
    const { terrain } = flat(); setTerrain(terrain, 20, 20, 'urban');
    const a = world(20, 20), b = world(24, 20);
    expect(hasLineOfSight(terrain, a.x, a.y, b.x, b.y)).toBe(true);
    expect(hasLineOfSight(terrain, b.x, b.y, a.x, a.y)).toBe(true);
    setTerrain(terrain, 22, 20, 'urban');
    expect(hasLineOfSight(terrain, a.x, a.y, b.x, b.y)).toBe(false);
  });
  it('reduces incoming hit probability at physical cover', () => {
    const shoot = (covered: boolean) => {
      const state = flat(), a = world(20, 20), b = world(22, 20);
      const attacker = createUnit('infantry', 'player', a.x, a.y);
      const target = createUnit('infantry', 'enemy', b.x, b.y);
      target.spottedByEnemy = true; target.detectionLevel = 1; target.facing = Math.PI;
      attacker.accuracy = 1; attacker.facing = 0;
      if (covered) { setTerrain(state.terrain, 22, 20, 'sandbag'); Object.assign(state.terrain[20][22], { prop: 'stone_wall', coverBonus: .62 }); }
      state.units = [attacker, target]; updateCombat(attacker, .1, state);
      return state.projectiles[0]?.hit;
    };
    vi.spyOn(Math, 'random').mockReturnValue(.72);
    expect(shoot(false)).toBe(true); expect(shoot(true)).toBe(false);
  });
});

describe('Leipalingis geography and campaign access', () => {
  it('uses imported roads and correctly oriented settlements', () => {
    const a = LEIPALINGIS_ANCHORS;
    expect(a.jovaisiai.y).toBeLessThan(a.leipalingis.y);
    expect(a.didziasalis.y).toBeGreaterThan(a.leipalingis.y);
    expect(a.straciunai.x).toBeGreaterThan(a.leipalingis.x);
    expect(a.straciunai.y).toBeLessThan(a.leipalingis.y);
    expect(a.seirijai.y / MAP_ROWS).toBeLessThan(.1);
    for (const ref of ['180', '133', '134', '2505']) expect(LEIPALINGIS_ROADS.some(r => r.ref === ref)).toBe(true);
  });
  it('offers reachable objectives for infantry, tanks and APCs from every staging area', () => {
    const terrain = generateTerrain('leipalingis_region', leipalingisMission.mapSeed);
    const goal = world(LEIPALINGIS_ANCHORS.leipalingis.x, LEIPALINGIS_ANCHORS.leipalingis.y);
    for (const town of leipalingisMission.deploymentTowns!) for (const type of ['infantry', 'tank', 'apc'] as const) {
      const path = findPath(terrain, town.pos, goal, type);
      expect(path.length, `${town.name} / ${type}`).toBeGreaterThan(0);
      const end = path[path.length - 1]; expect(Math.hypot(end.x - goal.x, end.y - goal.y)).toBeLessThan(140);
    }
    const cells = terrain.flat();
    expect(new Set(cells.flatMap(c => c.prop ? [c.prop] : []))).toEqual(new Set(['logs', 'hay', 'stone_wall', 'wreck', 'barricade', 'boulder', 'scrub']));
    expect(cells.filter(c => c.prop).length).toBeGreaterThan(150);
  });
});


it('completes expanded regional travel with each ground unit without hull clipping', () => {
  const state = createInitialState(leipalingisMission);
  const l = LEIPALINGIS_ANCHORS.leipalingis, goal = world(l.x, l.y);
  for (const town of leipalingisMission.deploymentTowns!) for (const type of ['infantry', 'tank', 'apc'] as const) {
    const unit = createUnit(type, 'player', town.pos.x, town.pos.y);
    state.units = [unit]; state.time = 0;
    setDestination(unit, state, goal); unit.order = 'move';
    const destination = { ...unit.finalDest! }; let clipped = false;
    for (let i = 0; i < 10000 && distance(unit.pos, destination) > 16; i++) {
      state.time += .05; refreshUnitGrid(state); moveUnit(unit, .05, state);
      if (type !== 'infantry' && !isWorldFootprintPassable(state.terrain, unit.pos.x, unit.pos.y, true)) clipped = true;
    }
    expect(clipped, `${town.name} / ${type}`).toBe(false);
    expect(distance(unit.pos, destination), `${town.name} / ${type}`).toBeLessThanOrEqual(16);
  }
}, 15000);
