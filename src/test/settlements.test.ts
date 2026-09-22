import { describe, expect, it } from 'vitest';
import { generateTerrain, isWorldFootprintPassable, setTerrain } from '../game/terrain';
import { CELL_SIZE } from '../game/constants';
import { SETTLEMENTS, settlementAt } from '../game/maps/settlements';
import { STAGING_AREAS, MapRoad, LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { roadJunctions } from '../game/maps/roadSurface';

const terrain = generateTerrain('leipalingis_region', 1917);
describe('settlement identity and approach lanes', () => {
  it('preserves populated centres and landmarks while keeping rural building density lower', () => {
    const cells = terrain.flat();
    for (const town of SETTLEMENTS) {
      const buildings = cells.filter(c => c.type === 'urban' && c.settlementId === town.id);
      expect(buildings.length, town.name).toBeGreaterThanOrEqual(town.id === 'versiai' ? 8 : 20);
      expect(buildings.some(c => c.buildingKind === town.landmark), town.name).toBe(true);
      const builtDensity = buildings.length / (Math.PI * town.rx * town.ry);
      const rural = cells.filter(c => !settlementAt(c.x / CELL_SIZE, c.y / CELL_SIZE));
      expect(builtDensity).toBeGreaterThan(rural.filter(c => c.type === 'urban').length / rural.length * 10);
    }
  });
  it('keeps every deployment clearing outside the named settlements', () => {
    for (const stage of Object.values(STAGING_AREAS)) expect(settlementAt(stage.x, stage.y)).toBeUndefined();
  });
  it('fits a vehicle through a one-cell street but blocks a hull crossing the adjoining wall', () => {
    const grid = terrain.map(row => row.map(c => ({ ...c })));
    for (let y = 10; y <= 20; y++) for (let x = 10; x <= 12; x++) setTerrain(grid, x, y, x === 11 ? 'road' : 'urban');
    expect(isWorldFootprintPassable(grid, 11.5 * CELL_SIZE, 15.5 * CELL_SIZE, true)).toBe(true);
    expect(isWorldFootprintPassable(grid, 11.1 * CELL_SIZE, 15.5 * CELL_SIZE, true)).toBe(false);
  });
});
describe('continuous road junction markings', () => {
  const road = (id: number, points: number[][]): MapRoad => ({ id, points, class: 'main', name: '', ref: '', width: 1.35, paved: true });
  it('finds crossings, ignores parallel continuations and handles degenerate source segments', () => {
    const junctions = roadJunctions([road(1, [[0, 2], [4, 2]]), road(2, [[2, 0], [2, 4]]), road(3, [[4, 2], [6, 2]]), road(4, [[2, 2], [2, 2]])]);
    expect(junctions).toEqual([{ x: 2, y: 2, radius: 1.35 * .85 }]);
    expect(roadJunctions(LEIPALINGIS_ROADS).every(j => Number.isFinite(j.x + j.y + j.radius))).toBe(true);
  });
});
