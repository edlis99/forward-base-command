import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateTerrain } from '../game/terrain';
import { METRE, chimneyOf, cottagePlan } from '../scene3d/villagePlans';
import { villageTrees } from '../scene3d/villageTrees';
import type { TreePlacement } from '../scene3d/VolumetricTrees';

const terrain = generateTerrain('leipalingis_region', 1917);
const TANK_HEIGHT = .157, TANK_LENGTH = .5; // cells (tank model at UNIT_SCALE.tank)

describe('village scale', () => {
  it('builds cottages at real size next to a tank: as long as it, a ridge under three of its heights', () => {
    const cells = terrain.flat().filter(c => c.type === 'urban' && (c.buildingKind ?? 'house') === 'house');
    expect(cells.length).toBeGreaterThan(200);
    for (const c of cells.slice(0, 80)) {
      const x = c.x / 32, z = c.y / 32, plan = cottagePlan(x, z), flue = chimneyOf(c, x, z)!;
      const ridge = flue.top - .75; // the chimney stands .75 m over the ridge
      expect(plan.D * METRE).toBeGreaterThan(TANK_LENGTH);
      expect(plan.D * METRE).toBeLessThan(TANK_LENGTH * 1.6);
      expect(ridge).toBeGreaterThan(5.5); expect(ridge).toBeLessThan(8.5);
      expect(ridge * METRE / TANK_HEIGHT).toBeLessThan(3.4);
    }
  });
  it('plants real fruit trees in orchards and old shade trees by the farmsteads, at real heights', () => {
    const trees: TreePlacement[] = [];
    for (let y = 0; y < terrain.length; y++) for (let x = 0; x < terrain[0].length; x++) villageTrees(terrain, x, y, trees);
    const apples = trees.filter(t => t.species === 'apple'), shade = trees.filter(t => t.species !== 'apple');
    expect(apples.length).toBeGreaterThan(500);
    expect(shade.length).toBeGreaterThan(150);
    for (const t of apples) { expect(t.size / METRE).toBeGreaterThan(4); expect(t.size / METRE).toBeLessThan(6.1); }
    for (const t of shade) { expect(t.size / METRE).toBeGreaterThan(10.9); expect(t.size / METRE).toBeLessThan(17.1); }
    // Never on a street or in the water.
    for (const t of trees) {
      const c = terrain[Math.floor(t.z)][Math.floor(t.x)];
      expect(c.type === 'road' || c.type === 'gravel' || c.type === 'water').toBe(false);
    }
  });
  it('no longer draws orchard trees as icosahedron blobs', () => {
    const source = readFileSync(join(process.cwd(), 'src/scene3d/Environment.tsx'), 'utf8');
    const rural = source.slice(source.indexOf('export function RuralBuildingsAndProps'));
    expect(rural.slice(rural.indexOf("cell.yard === 'orchard'"), rural.indexOf("} else {", rural.indexOf("cell.yard === 'orchard'")))).not.toContain("'crown'");
  });
});
