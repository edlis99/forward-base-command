import { describe, expect, it } from 'vitest';
import { generateTerrain, setTerrain } from '../game/terrain';
import { cellCoverScore, cellConcealmentScore } from '../game/tactical';

describe('trench terrain', () => {
  it('provides strong infantry cover and concealment while blocking vehicles', () => {
    const terrain = generateTerrain('leipalingis_region', 1337);
    setTerrain(terrain, 1, 1, 'trench');
    const trench = terrain[1][1];

    expect(trench.vehicleImpassable).toBe(true);
    expect(cellCoverScore(trench)).toBeGreaterThanOrEqual(0.85);
    expect(cellConcealmentScore(trench)).toBeGreaterThanOrEqual(0.55);
  });
});