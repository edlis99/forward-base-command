import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { TerrainCell, TerrainType } from '../game/types';
import { buildGroundGeometry } from '../scene3d/groundGeometry';

function cell(type: TerrainType, extra: Partial<TerrainCell> = {}): TerrainCell {
  return {
    type, x: 0, y: 0, coverBonus: 0, concealment: 0, movementCost: 1,
    elevation: 1, blocksLOS: false, blocksMovement: false, vehicleImpassable: false,
    trampled: false, traction: 1, fatigueRate: 1, ...extra,
  };
}

function terrain() {
  const open = cell('open');
  return Array.from({ length: MAP_ROWS }, () => Array<TerrainCell>(MAP_COLS).fill(open));
}

function vertexAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) === x && position.getZ(i) === z) return i;
  }
  throw new Error(`No terrain vertex at ${x}, ${z}`);
}

function weightsAt(geometry: THREE.BufferGeometry, x: number, z: number) {
  const i = vertexAt(geometry, x, z);
  const a = geometry.getAttribute('splatA'), b = geometry.getAttribute('splatB');
  return [a.getX(i), a.getY(i), a.getZ(i), b.getX(i), b.getY(i), b.getZ(i)];
}

describe('textured terrain geometry', () => {
  it('supplies nonzero material weights for all six ground surfaces', () => {
    const map = terrain();
    const types: TerrainType[] = ['open', 'tall_grass', 'forest', 'mud', 'gravel', 'road'];
    types.forEach((type, i) => { map[12][10 + i] = cell(type); });
    const geometry = buildGroundGeometry(map, { id: 'surfaces', x: 10, y: 12, width: 6, height: 1 });
    types.forEach((_, material) => {
      const expected = Array<number>(6).fill(0);
      expected[material] = 1;
      expect(weightsAt(geometry, 10.5 + material, 12.5)).toEqual(expected);
    });
    geometry.dispose();
  });

  it('blends neighbouring surfaces and keeps every vertex fully covered', () => {
    const map = terrain();
    map[12][10] = cell('open'); map[12][11] = cell('forest');
    map[13][10] = cell('mud'); map[13][11] = cell('gravel');
    const geometry = buildGroundGeometry(map, { id: 'blend', x: 10, y: 12, width: 2, height: 2 });
    expect(weightsAt(geometry, 11, 13)).toEqual([0.25, 0, 0.25, 0.25, 0.25, 0]);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const weights = weightsAt(geometry, positions.getX(i), positions.getZ(i));
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
      expect(weights.every(weight => weight >= 0 && weight <= 1)).toBe(true);
    }
    geometry.dispose();
  });

  it('keeps material blends, height and texture coordinates aligned across sections', () => {
    const map = terrain();
    for (let z = 11; z <= 15; z++) {
      map[z][11] = cell('forest'); map[z][12] = cell('tall_grass');
    }
    const left = buildGroundGeometry(map, { id: 'left', x: 10, y: 12, width: 2, height: 2 });
    const right = buildGroundGeometry(map, { id: 'right', x: 12, y: 12, width: 2, height: 2 });
    for (let z = 12; z <= 14; z += 0.5) {
      expect(weightsAt(left, 12, z)).toEqual(weightsAt(right, 12, z));
      const a = vertexAt(left, 12, z), b = vertexAt(right, 12, z);
      expect(left.getAttribute('position').getY(a)).toBe(right.getAttribute('position').getY(b));
      expect(left.getAttribute('uv').getX(a)).toBe(right.getAttribute('uv').getX(b));
      expect(left.getAttribute('uv').getY(a)).toBe(right.getAttribute('uv').getY(b));
    }
    left.dispose(); right.dispose();
  });

  it('leaves regional road underlays to the road overlay while preserving yards', () => {
    const map = terrain();
    map[12][10] = cell('road', { roadName: 'Regional road' });
    map[12][11] = cell('urban', { yard: 'courtyard' });
    const section = { id: 'road', x: 10, y: 12, width: 2, height: 1 };
    const regional = buildGroundGeometry(map, section, true);
    const tactical = buildGroundGeometry(map, section, false);
    expect(weightsAt(regional, 10.5, 12.5)).toEqual([1, 0, 0, 0, 0, 0]);
    expect(weightsAt(tactical, 10.5, 12.5)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(weightsAt(regional, 11.5, 12.5)).toEqual([0, 0, 0, 0, 1, 0]);
    regional.dispose(); tactical.dispose();
  });
});
