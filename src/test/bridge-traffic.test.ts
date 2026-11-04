import { describe, expect, it } from 'vitest';
import { createInitialState } from '../game/engine';
import { createUnit, moveUnit } from '../game/units';
import { leipalingisMission } from '../game/missions';
import { CELL_SIZE } from '../game/constants';
import { GameState, UnitType } from '../game/types';
import { issueSquadMove, updatePlayerSquads } from '../game/playerSquads';
import { refreshUnitGrid } from '../game/spatialGrid';
import { generateTerrain, deckLane, deckUnder, spanAxis, spanCoords, walkableAt } from '../game/terrain';

const terrain = generateTerrain('leipalingis_region', 1917);
const base = createInitialState({ ...leipalingisMission, mapLayout: 'farmhouse_complex', init: () => ({}) });
const spans = [...new Set(terrain.flat().filter(c => c.bridge).map(c => c.bridge!))];

/** A mixed group on the road a few cells before a bridge, ordered to a point well past it. */
function crossing(span: (typeof spans)[number]) {
  const { ax, ay, ux, uy, L } = spanAxis(span);
  const start = { x: (ax - ux * 7) * CELL_SIZE, y: (ay - uy * 7) * CELL_SIZE };
  const dest = { x: (ax + ux * (L + 12)) * CELL_SIZE, y: (ay + uy * (L + 12)) * CELL_SIZE };
  const types: UnitType[] = ['tank', 'tank', 'apc', 'apc', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry'];
  const units = types.map((t, i) => createUnit(t, 'player', start.x + (i % 4 - 1.5) * 26 - ux * Math.floor(i / 4) * 30, start.y + (i % 4 - 1.5) * 26 - uy * Math.floor(i / 4) * 30));
  const state: GameState = { ...base, terrain, units, script: {}, time: 0, playerSquads: [], nextMoveGroupId: 1, selectionRoster: [], previewSelected: new Set(), eventLog: [] };
  issueSquadMove(state, units, dest, {});
  expect(units.every(u => u.targetPos)).toBe(true);
  let worstOff = 0;
  for (let f = 0; f < 3000 && units.some(u => u.targetPos); f++) {
    state.time += .05; refreshUnitGrid(state); updatePlayerSquads(state, .05);
    units.forEach(u => moveUnit(u, .05, state));
    for (const u of units) {
      const c = terrain[Math.floor(u.pos.y / CELL_SIZE)]?.[Math.floor(u.pos.x / CELL_SIZE)];
      if (c?.bridge !== span) continue;
      const { along, across } = spanCoords(span, u.pos.x, u.pos.y);
      if (along > 0 && along < L) worstOff = Math.max(worstOff, Math.abs(across) - deckLane(span));
    }
  }
  // Everyone ends up over on the far side, round the destination.
  for (const u of units) expect(Math.hypot(u.pos.x - dest.x, u.pos.y - dest.y) / CELL_SIZE, u.type).toBeLessThan(4);
  return { units, time: state.time, worstOff };
}

describe('troops on bridges', () => {
  it('a deck carries units over the river beside its cells; the river part of a deck cell is water', () => {
    const span = spans.find(s => s.width < .3)!;
    const { ax, ay, ux, uy, L } = spanAxis(span);
    const mid = { x: (ax + ux * L / 2) * CELL_SIZE, y: (ay + uy * L / 2) * CELL_SIZE };
    expect(deckUnder(terrain, mid.x, mid.y)).toBe(span);
    expect(walkableAt(terrain, mid.x, mid.y, true)).toBe(true);
    // Beside the deck, still inside a deck cell: the river.
    const cell = terrain.flat().find(c => c.bridge === span && Math.abs(spanCoords(span, c.x + 16, c.y + 16).across) > deckLane(span) + .05)!;
    expect(cell).toBeDefined();
    expect(walkableAt(terrain, cell.x + 16, cell.y + 16, false)).toBe(false);
  });
  it('a mixed group files over a narrow skewed farm-track bridge on its deck, without jamming at the far end', () => {
    // This crossing used to lock solid: units on the deck waited for their
    // group while the tanks behind them waited for the deck to clear.
    const span = spans.find(s => Math.abs(s.a[0] - 103.3) < .5 && Math.abs(s.a[1] - 108.1) < .5)!;
    expect(span.width).toBeLessThan(.3);
    const { units, time, worstOff } = crossing(span);
    expect(units.filter(u => u.targetPos).map(u => u.type)).toEqual([]);
    expect(time).toBeGreaterThan(20); expect(time).toBeLessThan(120);
    expect(worstOff).toBeLessThan(.02);
  }, 60000);
  it('a column on a road bridge keeps to the deck and gets everyone across', () => {
    const span = spans.find(s => Math.abs(s.a[0] - 56.2) < .5 && Math.abs(s.a[1] - 110.2) < .5)!;
    const { units, time, worstOff } = crossing(span);
    expect(units.filter(u => u.targetPos).map(u => u.type)).toEqual([]);
    expect(time).toBeLessThan(120);
    expect(worstOff).toBeLessThan(.02);
  }, 60000);
});
