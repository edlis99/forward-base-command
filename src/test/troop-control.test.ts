import { beforeAll, describe, expect, it } from 'vitest';
import { createInitialState, handleRightClickWorld } from '../game/engine';
import { createUnit, distance, moveUnit, setDestination } from '../game/units';
import { leipalingisMission } from '../game/missions';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { GameState, TerrainCell, UnitType } from '../game/types';
import { adjustSelectedCount, selectedUnits, selectionRoster, selectRosterType, selectUnits } from '../game/selection';
import { issueSquadMove, planSquadMove, updatePlayerSquads } from '../game/playerSquads';
import { refreshUnitGrid } from '../game/spatialGrid';
import { setTerrain } from '../game/terrain';
import { LEIPALINGIS_ANCHORS } from '../game/maps/leipalingis';
import { coverState, occupyCover } from '../game/cover';

let base: GameState;
beforeAll(() => { base = createInitialState({ ...leipalingisMission, mapLayout: 'farmhouse_complex', init: () => ({}) }); });
function fixture(types: UnitType[] = ['infantry', 'infantry', 'tank', 'apc']): GameState {
  const terrain = Array.from({ length: MAP_ROWS }, (_, y) => Array.from({ length: MAP_COLS }, (_, x): TerrainCell => ({
    type: 'open', x: x * CELL_SIZE, y: y * CELL_SIZE, coverBonus: 0, concealment: 0,
    movementCost: 1, elevation: 1, blocksLOS: false, blocksMovement: false,
    vehicleImpassable: false, trampled: false, traction: 1, fatigueRate: 0,
  })));
  return { ...base, terrain, units: types.map((type, i) => createUnit(type, 'player', 1000, 980 + i * 30)),
    script: {}, time: 0, playerSquads: [], nextMoveGroupId: 1, selectionRoster: [], previewSelected: new Set(), eventLog: [] };
}
function tick(state: GameState, frames = 1) {
  for (let i = 0; i < frames; i++) {
    state.time += .05; refreshUnitGrid(state); updatePlayerSquads(state, .05);
    state.units.forEach(u => moveUnit(u, .05, state));
  }
}
const unfinished = (state: GameState) => state.units.filter(u => u.alive && u.targetPos).map(u => ({type: u.type, pos: u.pos, dest: u.finalDest, target: u.targetPos, path: u.path.slice(0, 2), wait: u.waiting}));

describe('selection and persistent roster', () => {
  it('filters by type, adjusts counts and restores the original group without selecting embarked or enemy units', () => {
    const state = fixture();
    const enemy = createUnit('tank', 'enemy', 1100, 1000), passenger = createUnit('infantry', 'player', 1000, 1000);
    passenger.insideOf = state.units[3].id; state.units.push(enemy, passenger);
    selectUnits(state, state.units.map(u => u.id));
    expect(selectedUnits(state)).toHaveLength(4);
    selectRosterType(state, 'infantry'); expect(selectedUnits(state)).toHaveLength(2);
    adjustSelectedCount(state, 'infantry', -1); expect(selectedUnits(state)).toHaveLength(1);
    adjustSelectedCount(state, 'tank', 1); expect(selectedUnits(state).map(u => u.type)).toEqual(['infantry', 'tank']);
    selectRosterType(state); expect(selectedUnits(state)).toHaveLength(4);
    state.units[0].alive = false; expect(selectionRoster(state)).toHaveLength(3);
    selectUnits(state, [state.units[1].id], 'toggle'); expect(selectedUnits(state)).toHaveLength(2);
    selectUnits(state, []); expect(selectionRoster(state)).toHaveLength(0);
  });
});

describe('coordinated travel', () => {
  it('keeps infantry on fast and slow terrain together and finishes the move', () => {
    const state = fixture(['infantry', 'infantry']);
    state.units[0].pos = { x: 1000, y: 976 }; state.units[1].pos = { x: 1000, y: 1008 };
    for (let x = 25; x < 60; x++) { setTerrain(state.terrain, x, 30, 'road'); setTerrain(state.terrain, x, 31, 'forest'); }
    state.preferredFormation = 'line'; issueSquadMove(state, state.units, { x: 1550, y: 992 }, { facing: 0 });
    tick(state, 180);
    expect(Math.abs(state.units[0].pos.x - state.units[1].pos.x)).toBeLessThan(55);
    expect(state.units.every(u => u.pos.x > 1060)).toBe(true);
    tick(state, 1600); expect(unfinished(state)).toEqual([]);
  });
  it('paces armour with infantry, assigns role spacing, and finishes without stacking', () => {
    const state = fixture();
    issueSquadMove(state, state.units, { x: 1550, y: 1000 }, { facing: 0 });
    const planned = state.units.map(u => ({ ...u.finalDest! }));
    expect(planned[2].x).toBeGreaterThan(planned[0].x);
    expect(planned[3].x).toBeLessThan(planned[0].x);
    tick(state, 140);
    const cap = state.units[0].groupSpeedCap!;
    expect(state.units[2].groupSpeedCap).toBeCloseTo(cap);
    expect(Math.max(...state.units.map(u => u.pos.x)) - Math.min(...state.units.map(u => u.pos.x))).toBeLessThan(110);
    tick(state, 1200); expect(unfinished(state)).toEqual([]);
    state.units.forEach((u, i) => expect(distance(u.pos, planned[i])).toBeLessThan(16));
    for (const a of state.units) for (const b of state.units) if (a !== b) expect(distance(a.pos, b.pos)).toBeGreaterThan(9);
  });
  it('screens armour with infantry when approaching a built-up area', () => {
    const state = fixture();
    for (let y = 27; y < 36; y++) for (let x = 44; x < 52; x++) if (y % 2 === 0) setTerrain(state.terrain, x, y, 'urban');
    const plan = planSquadMove(state, state.units, { x: 1510, y: 1008 }, { facing: 0 });
    const offsets = plan[0].localOffsets;
    expect(offsets[state.units[0].id].x).toBeGreaterThan(offsets[state.units[2].id].x);
  });
  it('keeps the current formation on queue, waits for all members, and completes both legs', () => {
    const state = fixture();
    issueSquadMove(state, state.units, { x: 1250, y: 1000 }, { facing: 0 });
    const ids = state.units.map(u => u.squadId), dests = state.units.map(u => ({ ...u.finalDest! }));
    issueSquadMove(state, state.units, { x: 1550, y: 1250 }, { queue: true, facing: Math.PI / 2, attackMove: true });
    expect(state.units.map(u => u.squadId)).toEqual(ids);
    expect(state.units.map(u => u.finalDest)).toEqual(dests);
    let reachedSecondLeg = false;
    for (let i = 0; i < 1800; i++) {
      if (state.units.some(u => !u.targetPos && u.waypoints.length)) expect(state.units.every(u => u.waypoints.length === 1)).toBe(true);
      tick(state);
      if (state.units.every(u => u.waypoints.length === 0)) reachedSecondLeg = true;
    }
    expect(reachedSecondLeg).toBe(true); expect(unfinished(state)).toEqual([]);
    expect(state.units.every(u => Math.abs(u.facing - Math.PI / 2) < .01)).toBe(true);
    expect(state.units.every(u => u.pos.y > 1160)).toBe(true);
  });
  it('lets independent vehicles use their own speed and keeps aircraft out of ground pacing', () => {
    const state = fixture(['infantry', 'apc', 'helicopter']); state.coordinatedMovement = false;
    issueSquadMove(state, state.units, { x: 1800, y: 1000 }); tick(state, 160);
    expect(state.units[1].pos.x - state.units[0].pos.x).toBeGreaterThan(40);
    expect(state.units.every(u => u.groupSpeedCap == null)).toBe(true);
    state.coordinatedMovement = true; issueSquadMove(state, state.units, { x: 2000, y: 1000 }); tick(state);
    expect(state.units[2].groupSpeedCap).toBeGreaterThan(state.units[0].groupSpeedCap!);
  });
  it('waits for a pinned member, then releases the group after a casualty', () => {
    const state = fixture(['infantry', 'tank']); issueSquadMove(state, state.units, { x: 1500, y: 1000 });
    state.units[0].prone = true; state.units[0].suppression = 1; tick(state, 40);
    expect(state.units[1].waiting).toBe('formation'); expect(state.units[1].pos.x).toBe(1000);
    state.units[0].alive = false; tick(state, 800); expect(unfinished(state)).toEqual([]);
  });
  it('passes a stationary friendly and avoids a head-on infantry deadlock', () => {
    const state = fixture(['infantry', 'infantry', 'tank']);
    state.units[0].pos = { x: 1000, y: 1000 }; state.units[1].pos = { x: 1300, y: 1000 }; state.units[2].pos = { x: 1160, y: 1000 };
    setDestination(state.units[0], state, { x: 1300, y: 1000 }); setDestination(state.units[1], state, { x: 1000, y: 1000 });
    tick(state, 1000); expect(unfinished(state)).toEqual([]);
  });
});

describe('cover occupancy', () => {
  it('shows approach then settled cover, reserves separate slots, and leaves cover on a new move', () => {
    const state = fixture(['infantry', 'infantry', 'infantry']);
    setTerrain(state.terrain, 35, 31, 'sandbag'); state.terrain[31][35].prop = 'boulder';
    const at = { x: 1136, y: 1008 };
    expect(occupyCover(state, state.units.slice(0, 2), at).size).toBe(2);
    expect(occupyCover(state, [state.units[2]], at).size).toBe(0);
    expect(state.units.slice(0, 2).map(coverState)).toEqual(['moving', 'moving']);
    tick(state, 600); expect(state.units.slice(0, 2).map(coverState)).toEqual(['covered', 'covered']);
    expect(distance(state.units[0].pos, state.units[1].pos)).toBeGreaterThan(9);
    selectUnits(state, state.units.map(u => u.id)); handleRightClickWorld(1500, 1000, state); tick(state);
    expect(state.units.map(coverState)).toEqual(['none', 'none', 'none']);
  });
});


it('moves a mixed force through a one-cell opening without blocking one another', () => {
  const state = fixture(['infantry', 'infantry', 'tank', 'apc']);
  for (let y = 15; y < 52; y++) if (y !== 32) setTerrain(state.terrain, 36, y, 'wall');
  issueSquadMove(state, state.units, { x: 1450, y: 1035 }, { facing: 0 });
  tick(state, 2400); expect(unfinished(state)).toEqual([]);
});

it('brings the deployed mixed campaign force to Leipalingis with stable destinations', () => {
  const state = createInitialState(leipalingisMission);
  state.units = state.units.filter(u => u.team === 'player');
  const at = LEIPALINGIS_ANCHORS.leipalingis;
  issueSquadMove(state, state.units, { x: (at.x + .5) * CELL_SIZE, y: (at.y + .5) * CELL_SIZE });
  for (let i = 0; i < 20000 && state.units.some(u => u.targetPos); i++) tick(state);
  expect(unfinished(state)).toEqual([]);
}, 20000);


it('releases an unreachable queued order without crashing squad maintenance', () => {
  const state = fixture(['infantry']);
  issueSquadMove(state, state.units, { x: 1050, y: 980 });
  issueSquadMove(state, state.units, { x: 1300, y: 980 }, { queue: true });
  for (let x = 38; x <= 43; x++) for (let y = 28; y <= 33; y++) {
    if (x === 38 || x === 43 || y === 28 || y === 33) setTerrain(state.terrain, x, y, 'wall');
  }
  tick(state, 500);
  expect(state.units[0].targetPos).toBeNull();
  expect(state.units[0].squadId).toBeNull();
});


it('leaves a cover approach cleanly when the next queued move starts', () => {
  const state = fixture(['infantry']);
  setTerrain(state.terrain, 35, 31, 'sandbag'); state.terrain[31][35].prop = 'logs';
  occupyCover(state, state.units, { x: 1136, y: 1008 });
  issueSquadMove(state, state.units, { x: 1400, y: 1000 }, { queue: true });
  tick(state, 1000);
  expect(unfinished(state)).toEqual([]);
  expect(state.units[0].order).toBe('idle');
  expect(state.units[0].coverTarget).toBeUndefined();
  expect(coverState(state.units[0])).toBe('none');
});
