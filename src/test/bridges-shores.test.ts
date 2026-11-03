import { describe, expect, it } from 'vitest';
import { generateTerrain, isPassable } from '../game/terrain';
import { groundHeightAt } from '../scene3d/terrainHeight';
import { spanBoxes } from '../scene3d/bridgeSpans';
import { drivewaysIn } from '../scene3d/roadMaterial';
import { mapSections } from '../scene3d/mapSections';
import { PLAYABLE_CELLS } from '../game/maps/leipalingis';

const terrain = generateTerrain('leipalingis_region', 1917);
const cells = terrain.flat();
const at = (x: number, y: number) => terrain[y]?.[x];

describe('bridges, shores and driveways', () => {
  it('turns road crossings into bridge decks that leave the river flowing', () => {
    const decks = cells.filter(c => c.bridge);
    const spans = new Set(decks.map(c => `${c.bridge!.a}>${c.bridge!.b}`));
    expect(spans.size).toBeGreaterThanOrEqual(20);
    for (const c of decks) {
      const x = c.x / 32, y = c.y / 32;
      // Passable road surface for vehicles (the scenery border is closed everywhere).
      expect(c.type === 'road' || c.type === 'gravel').toBe(true);
      const [x0, y0, x1, y1] = PLAYABLE_CELLS;
      if (x >= x0 && y >= y0 && x < x1 && y < y1) expect(isPassable(c, true, false)).toBe(true);
      // Water still runs beside the deck: the road no longer dams the river.
      expect([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
        .some(([dx, dy]) => at(x + dx, y + dy)?.type === 'water' || at(x + dx, y + dy)?.bridge)).toBe(true);
      // Units stand on the deck, above the river bed under it.
      expect(groundHeightAt(terrain, x + .5, y + .5, true)).toBeGreaterThan(groundHeightAt(terrain, x + .5, y + .5) + .3);
    }
  });

  it('draws each crossing once, as one straight span', () => {
    const boxes = mapSections().flatMap(section => spanBoxes(terrain, section));
    expect(boxes.length).toBeGreaterThan(100);
    expect(boxes.every(b => [b.x, b.y, b.z, b.sx, b.sy, b.sz, b.yaw].every(Number.isFinite))).toBe(true);
  });

  it('gives most village and town houses a driveway to their street', () => {
    const drives = drivewaysIn(terrain, 0, 0, terrain[0].length, terrain.length);
    const homes = cells.filter(c => c.type === 'urban' && c.settlementId && c.buildingKind !== 'barn' && c.buildingKind !== 'church');
    expect(drives.length).toBeGreaterThan(homes.length * .6);
    for (const d of drives) expect(Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1])).toBeLessThan(2.7);
  });
});
