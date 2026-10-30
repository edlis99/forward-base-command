import { describe, expect, it } from 'vitest';
import { generateTerrain, isWorldFootprintPassable, setTerrain } from '../game/terrain';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { SETTLEMENTS, settlementAt } from '../game/maps/settlements';
import { STAGING_AREAS, MapRoad, LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { mapSections } from '../scene3d/mapSections';
import { geography } from '../game/maps/geography';
import { roadJunctions } from '../game/maps/roadSurface';

const terrain = generateTerrain('leipalingis_region', 1917);
describe('settlement identity and approach lanes', () => {
  it('preserves populated centres and landmarks while keeping rural building density lower', () => {
    const cells = terrain.flat();
    for (const town of SETTLEMENTS) {
      const buildings = cells.filter(c => c.type === 'urban' && c.settlementId === town.id);
      // Real house counts, not every shed and barn as a house: villages keep a
      // garden cell between homes, so they hold a few dozen houses at most.
      expect(buildings.length, town.name).toBeGreaterThanOrEqual({ centre: 180, town: 50, village: 14, hamlet: 8 }[town.size]);
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


describe('expanded geographic scale', () => {
  it('keeps the same geographic bounds while using the full 440 × 320 region', () => {
    expect([MAP_COLS, MAP_ROWS, CELL_SIZE]).toEqual([440, 320, 32]);
    const [west, south, east, north] = geography.bounds;
    for (const town of SETTLEMENTS) {
      const p = geography.places.find(p => p.name === town.name)!;
      expect(Math.abs(town.x - (p.lon - west) / (east - west) * MAP_COLS)).toBeLessThan(1);
      expect(Math.abs(town.y - (north - p.lat) / (north - south) * MAP_ROWS)).toBeLessThan(1);
    }
    // Settlements spread across most of the playable region in both directions.
    expect(Math.max(...SETTLEMENTS.map(s => s.x)) - Math.min(...SETTLEMENTS.map(s => s.x))).toBeGreaterThan(MAP_COLS * .55);
    expect(Math.max(...SETTLEMENTS.map(s => s.y)) - Math.min(...SETTLEMENTS.map(s => s.y))).toBeGreaterThan(MAP_ROWS * .55);
    for (const road of LEIPALINGIS_ROADS) for (const [x, y] of road.points) {
      expect(x).toBeGreaterThanOrEqual(-.001); expect(x).toBeLessThanOrEqual(MAP_COLS + .001);
      expect(y).toBeGreaterThanOrEqual(-.001); expect(y).toBeLessThanOrEqual(MAP_ROWS + .001);
    }
  });
  it('adds accessible gardens and yards alongside the fuller settlements', () => {
    const yards = terrain.flat().filter(c => c.yard);
    expect(yards.length).toBeGreaterThan(150);
    for (const c of yards) {
      expect(c.roadName).toBeUndefined();
      expect(c.blocksMovement || c.vehicleImpassable).toBe(false);
      const x = c.x / CELL_SIZE, y = c.y / CELL_SIZE;
      expect([[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => terrain[y + dy]?.[x + dx]?.type === 'urban')).toBe(true);
    }
  });
  it('covers map edges with non-overlapping sections, including the partial eastern strip', () => {
    const coverage = new Uint8Array(MAP_COLS * MAP_ROWS);
    for (const s of mapSections()) {
      expect(s.x + s.width).toBeLessThanOrEqual(MAP_COLS); expect(s.y + s.height).toBeLessThanOrEqual(MAP_ROWS);
      for (let y = s.y; y < s.y + s.height; y++) for (let x = s.x; x < s.x + s.width; x++) coverage[y * MAP_COLS + x]++;
    }
    expect(coverage.every(n => n === 1)).toBe(true);
  });
});
