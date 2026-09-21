import { describe, expect, it } from 'vitest';
import {
  createInitialState, createInputState, disembarkSelected, handleRightClickWorld,
  holdPositionForSelected, setFormation, spawnReinforcement, update, updateCommandPreview,
} from '../game/engine';
import { createUnit, getFlankingBonus, updateCombat } from '../game/units';
import { updateAI } from '../game/ai';
import { getMission } from '../game/missions';
import { planSquadMove, planToSlots } from '../game/playerSquads';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { GameState, TerrainCell } from '../game/types';

function fixture(): GameState {
  const state = createInitialState(getMission());
  state.terrain = Array.from({ length: MAP_ROWS }, (_, y) => Array.from({ length: MAP_COLS }, (_, x): TerrainCell => ({
    type: 'open', x: x * CELL_SIZE, y: y * CELL_SIZE, coverBonus: 0, concealment: 0,
    movementCost: 1, elevation: 1, blocksLOS: false, blocksMovement: false,
    vehicleImpassable: false, trampled: false, traction: 1, fatigueRate: 1,
  })));
  state.units = [createUnit('infantry', 'player', 1000, 1000)];
  state.units[0].selected = true;
  return state;
}

function quietTick(state: GameState) {
  // Exercise the real engine without ending a reduced test army's mission.
  state.mission = { ...state.mission, update: () => {} };
  update(state, createInputState(), 1 / 60);
}

describe('campaign combat rules', () => {
  it('lets enemy AI finish its first-contact delay and acquire a target', () => {
    const state = fixture();
    const player = state.units[0];
    player.spottedByEnemy = true; player.detectionLevel = 1;
    const enemy = createUnit('tank', 'enemy', 1200, 1000);
    state.units.push(enemy);
    for (let i = 0; i < 120; i++) updateAI(state, 1 / 60);
    expect(enemy.attackTarget).toBe(player.id);
    expect(enemy.reactionDelay).toBe(0);
  });

  it('awards rear and side bonuses, never a frontal bonus', () => {
    const target = createUnit('tank', 'enemy', 1000, 1000);
    target.facing = 0;
    expect(getFlankingBonus(createUnit('tank', 'player', 1100, 1000), target)).toBe(0);
    expect(getFlankingBonus(createUnit('tank', 'player', 1000, 1100), target)).toBe(0.2);
    expect(getFlankingBonus(createUnit('tank', 'player', 900, 1000), target)).toBe(0.4);
  });

  it('keeps a player hold-fire order even with a nearby ally and enemy', () => {
    const state = fixture();
    const player = state.units[0];
    player.stance = 'hold_fire';
    state.units.push(createUnit('infantry', 'player', 1000, 1032));
    const enemy = createUnit('infantry', 'enemy', 1100, 1000);
    enemy.spottedByEnemy = true; enemy.detectionLevel = 1;
    state.units.push(enemy);
    updateAI(state, 1 / 60);
    updateCombat(player, 1 / 60, state);
    expect(player.stance).toBe('hold_fire');
    expect(state.projectiles).toHaveLength(0);
  });

  it('treats a click on an undetected enemy as a ground move', () => {
    const state = fixture();
    const enemy = createUnit('infantry', 'enemy', 1100, 1000);
    state.units.push(enemy);
    handleRightClickWorld(1100, 1000, state);
    expect(state.units[0].attackTarget).toBeNull();
    expect(state.units[0].order).toBe('move');
  });

  it('drops an explicit target after detection is lost and does not fire', () => {
    const state = fixture();
    const player = state.units[0];
    const enemy = createUnit('infantry', 'enemy', 1100, 1000);
    state.units.push(enemy);
    player.attackTarget = enemy.id;
    updateCombat(player, 1 / 60, state);
    expect(player.attackTarget).toBeNull();
    expect(state.projectiles).toHaveLength(0);
  });

  it('still attacks an identified target', () => {
    const state = fixture();
    const enemy = createUnit('infantry', 'enemy', 1100, 1000);
    enemy.spottedByEnemy = true; enemy.detectionLevel = 1;
    state.units.push(enemy);
    handleRightClickWorld(1100, 1000, state);
    updateCombat(state.units[0], 1 / 60, state);
    expect(state.units[0].attackTarget).toBe(enemy.id);
    expect(state.projectiles).toHaveLength(1);
  });
});

describe('formations and replacement commands', () => {
  it('creates distinct line, column and wedge layouts, matching the issued preview', () => {
    const state = fixture();
    state.units = Array.from({ length: 6 }, (_, i) => createUnit('infantry', 'player', 1000, 1000 + i * 32));
    state.units.forEach(u => { u.selected = true; });
    const dest = { x: 1500, y: 1500 };
    const layouts = ['line', 'column', 'wedge'].map(formation => {
      setFormation(state, formation as 'line' | 'column' | 'wedge');
      const slots = planToSlots(planSquadMove(state, state.units, dest, { facing: 0 }));
      return slots.map(s => s.pos);
    });
    expect(new Set(layouts[0].map(p => p.x)).size).toBe(1);
    expect(new Set(layouts[1].map(p => p.y)).size).toBe(1);
    expect(new Set(layouts[2].map(p => p.x)).size).toBeGreaterThan(1);
    expect(new Set(layouts[2].map(p => p.y)).size).toBeGreaterThan(1);
    updateCommandPreview(state, dest.x, dest.y, 0, 1.5);
    const preview = state.commandPreview!.slots;
    handleRightClickWorld(dest.x, dest.y, state, false, false, 0, 1.5);
    for (const slot of preview) expect(state.units.find(u => u.id === slot.id)!.finalDest).toEqual(slot.pos);
  });

  it('cancels pending boarding and digging when holding position', () => {
    const state = fixture();
    const unit = state.units[0];
    const apc = createUnit('apc', 'player', 1005, 1000);
    state.units.push(apc);
    unit.boardTarget = apc.id; unit.digOnArrive = true;
    holdPositionForSelected(state);
    quietTick(state);
    expect(unit.insideOf).toBeNull();
    expect(unit.boardTarget).toBeNull();
    expect(unit.digOnArrive).toBe(false);
    expect(unit.order).toBe('hold_position');
  });

  it('cancels deferred actions when replacing a move, while shift keeps the current destination', () => {
    const state = fixture();
    const unit = state.units[0];
    unit.boardTarget = 'old-apc'; unit.digOnArrive = true;
    handleRightClickWorld(1500, 1500, state);
    expect(unit.boardTarget).toBeNull();
    expect(unit.digOnArrive).toBe(false);
    const first = { ...unit.finalDest! };
    handleRightClickWorld(1800, 1500, state, true);
    expect(unit.finalDest).toEqual(first);
    expect(unit.waypoints).toHaveLength(1);
  });
});

describe('APC transport', () => {
  it('boards, follows the carrier and unloads into separate passable positions', () => {
    const state = fixture();
    const passenger = state.units[0];
    const apc = createUnit('apc', 'player', 1008, 1000);
    state.units.push(apc);
    handleRightClickWorld(apc.pos.x, apc.pos.y, state);
    quietTick(state);
    expect(passenger.insideOf).toBe(apc.id);
    expect(passenger.selected).toBe(false);
    apc.pos = { x: 1400, y: 1400 };
    quietTick(state);
    expect(passenger.pos).toEqual(apc.pos);
    const second = createUnit('infantry', 'player', 1400, 1400);
    second.insideOf = apc.id; apc.passengers.push(second.id); state.units.push(second);
    apc.selected = true;
    disembarkSelected(state);
    expect(apc.passengers).toHaveLength(0);
    expect(passenger.insideOf).toBeNull();
    expect(second.insideOf).toBeNull();
    expect(passenger.pos).not.toEqual(second.pos);
    expect(passenger.order).toBe('hold_position');
  });

  it('keeps passengers aboard if all nearby exits are blocked', () => {
    const state = fixture();
    const passenger = state.units[0];
    const apc = createUnit('apc', 'player', 1000, 1000);
    apc.selected = true; apc.passengers = [passenger.id]; passenger.insideOf = apc.id;
    state.units.push(apc);
    for (const row of state.terrain) for (const cell of row) cell.blocksMovement = true;
    disembarkSelected(state);
    expect(apc.passengers).toEqual([passenger.id]);
    expect(passenger.insideOf).toBe(apc.id);
  });
});

describe('campaign objectives and reinforcements', () => {
  it('spawns an affordable reinforcement once and deducts its cost', () => {
    const state = fixture();
    state.reinforcementBudget = 60;
    expect(spawnReinforcement('infantry', state)).toBe(true);
    expect(state.units).toHaveLength(2);
    expect(state.reinforcementBudget).toBe(10);
    expect(spawnReinforcement('infantry', state)).toBe(false);
    expect(state.units).toHaveLength(2);
  });

  it('does not spend resources or issue moves after the mission ends', () => {
    const state = fixture();
    state.gameOver = true; state.reinforcementBudget = 200;
    expect(spawnReinforcement('infantry', state)).toBe(false);
    handleRightClickWorld(1500, 1500, state);
    expect(state.reinforcementBudget).toBe(200);
    expect(state.units[0].targetPos).toBeNull();
  });

  it('does not capture the centre using an embarked passenger at stale coordinates', () => {
    const state = createInitialState(getMission());
    const passenger = state.units.find(u => u.team === 'player')!;
    passenger.insideOf = 'apc-elsewhere'; passenger.pos = { ...state.capturePoints[0].pos };
    const before = state.capturePoints[0].progress;
    state.mission.update(state, 1);
    expect(state.capturePoints[0].progress).toBe(before);
    expect(state.script.__counterattackFired).toBe(false);
  });

  it('completes preserve-armour on victory and counts first-tick casualties', () => {
    const state = createInitialState(getMission());
    const victim = state.units.find(u => u.team === 'enemy')!;
    victim.alive = false;
    state.mission.update(state, 1 / 60);
    expect(state.script.__killsEnemy).toBe(1);
    state.units.filter(u => u.team === 'enemy').forEach(u => { u.alive = false; });
    state.units.find(u => u.team === 'player')!.pos = { ...state.capturePoints[0].pos };
    state.capturePoints[0].progress = 1;
    state.mission.update(state, 1 / 60);
    expect(state.gameResult).toBe('win');
    expect(state.objectives.find(o => o.id === 'preserve_armour')!.status).toBe('complete');
  });
});
