import { describe, expect, it } from 'vitest';
import { pineProbability } from '../scene3d/RealisticVegetation';
import { SETTLEMENTS } from '../game/maps/settlements';
import { MAP_COLS, MAP_ROWS } from '../game/constants';

describe('Leipalingis woodland composition', () => {
  it('favours pine near Gailiunai and Didziasalis instead of painting the whole map as pine', () => {
    const pinePlaces = SETTLEMENTS.filter(s => s.id === 'gailiunai' || s.id === 'didziasalis');
    expect(pinePlaces).toHaveLength(2);
    const far = [[0, 0], [MAP_COLS, 0], [0, MAP_ROWS], [MAP_COLS, MAP_ROWS]]
      .sort((a, b) => {
        const distance = (p: number[]) => Math.min(...pinePlaces.map(s => Math.hypot(p[0] - s.x, p[1] - s.y)));
        return distance(b) - distance(a);
      })[0];
    for (const place of pinePlaces) {
      expect(pineProbability(place.x, place.y)).toBeGreaterThan(.70);
      expect(pineProbability(place.x, place.y)).toBeGreaterThan(pineProbability(far[0], far[1]));
    }
  });

  it('returns deterministic bounded probabilities throughout the map', () => {
    for (const [x, z] of [[0, 0], [20, 80], [MAP_COLS, MAP_ROWS], [MAP_COLS / 2, MAP_ROWS / 2]]) {
      expect(pineProbability(x, z)).toBe(pineProbability(x, z));
      expect(pineProbability(x, z)).toBeGreaterThanOrEqual(.18);
      expect(pineProbability(x, z)).toBeLessThanOrEqual(.89);
    }
  });
});
