import { describe, expect, it } from 'vitest';
import { createInitialState, handleLeftClickWorld, handleRightClickWorld } from '../game/engine';
import { getMission } from '../game/missions';

describe('coordinated group movement', () => {
  it('assigns one paced movement group with separate formation destinations', () => {
    const mission = getMission('leipalingis');
    const state = createInitialState(mission);
    const selected = state.units.filter(unit => unit.alive && unit.team === 'player').slice(0, 3);
    selected.forEach(unit => { unit.selected = true; });

    handleRightClickWorld(900, 900, state);

    const groupIds = new Set(selected.map(unit => unit.moveGroupId));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).not.toBeNull();
    expect(selected.every(unit => unit.groupSpeedCap != null)).toBe(true);
    expect(new Set(selected.map(unit => `${unit.finalDest?.x},${unit.finalDest?.y}`)).size).toBeGreaterThan(1);
  });

  it('selects the nearest overlapping troop deterministically', () => {
    const state = createInitialState(getMission('leipalingis'));
    const friendly = state.units.filter(unit => unit.alive && unit.team === 'player').slice(0, 2);
    friendly[0].pos = { x: 100, y: 100 };
    friendly[1].pos = { x: 108, y: 100 };
    handleLeftClickWorld(107, 100, state, false);
    expect(friendly[0].selected).toBe(false);
    expect(friendly[1].selected).toBe(true);
  });
});