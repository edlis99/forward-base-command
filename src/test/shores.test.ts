import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../game/terrain';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { geography } from '../game/maps/geography';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { meshHeight } from '../scene3d/groundCover';
import { roadEdgeAt, roadHalfWidth } from '../scene3d/roadMaterial';
import { fbm, GROUND_LEVEL, groundHeightAt, RELIEF, shoreWetness, smoothShoreShare, WATER_DEPTH, waterBedHeightAt } from '../scene3d/terrainHeight';

const terrain = generateTerrain('leipalingis_region', 1917);
const cell = (x: number, y: number) => terrain[Math.floor(y)]?.[Math.floor(x)];
const wet = (x: number, y: number) => { const c = terrain[y]?.[x]; return !!c && (c.type === 'water' || !!c.bridge); };
/** A repeatable stream of numbers in 0..1. */
const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const near = (x: number, y: number, r: number, test: (cx: number, cy: number) => boolean) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (test(Math.floor(x) + dx, Math.floor(y) + dy)) return true;
  return false;
};

/** The ground's height as the plain blend of the four nearest cells (what it was everywhere before the shores were smoothed). */
function plainHeight(gx: number, gz: number) {
  const u = gx - .5, v = gz - .5, ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
  let level = 0, relief = 0, elev = 0;
  for (const [cx, cy, w] of [[ix, iz, (1 - fx) * (1 - fz)], [ix + 1, iz, fx * (1 - fz)], [ix, iz + 1, (1 - fx) * fz], [ix + 1, iz + 1, fx * fz]]) {
    const c = terrain[cy][cx];
    level += (c.roadName ? 0 : GROUND_LEVEL[c.type] ?? 0) * w; relief += (c.roadName ? 1 : RELIEF[c.type] ?? 1) * w; elev += ((c.elevation ?? 1) - 1) * w;
  }
  const hills = (fbm(gx * .03, gz * .03) - .5) * 2.4 * (geography.designed ? .35 : 1), mid = (fbm(gx * .11, gz * .11) - .5) * .36, fine = (fbm(gx * .45, gz * .45) - .5) * .06;
  return level + elev * (geography.designed ? 1.7 : 1.05) + (hills + mid + fine) * relief;
}

describe('shores: smooth water edges, banks beside roads', () => {
  it('leaves the ground exactly as it was anywhere away from water', () => {
    const rand = random(7);
    let checked = 0;
    for (let n = 0; n < 6000; n++) {
      const gx = 2 + rand() * (MAP_COLS - 4), gz = 2 + rand() * (MAP_ROWS - 4);
      if (near(gx, gz, 4, wet)) continue;
      checked++;
      expect(groundHeightAt(terrain, gx, gz)).toBeCloseTo(plainHeight(gx, gz), 9);
    }
    expect(checked).toBeGreaterThan(4000);
  });

  it("measures the water's share as a smooth field: 0 on dry land, 1 deep in a lake, in between at a shore", () => {
    const rand = random(11);
    let dry = 0, deep = 0, shore = 0;
    for (let n = 0; n < 8000; n++) {
      const gx = 2 + rand() * (MAP_COLS - 4), gz = 2 + rand() * (MAP_ROWS - 4), share = shoreWetness(terrain, gx, gz);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1 + 1e-9);
      if (!near(gx, gz, 4, wet)) { expect(share).toBe(0); dry++; }
      else if (!near(gx, gz, 4, (x, y) => !wet(x, y))) { expect(share).toBe(1); deep++; }
      else shore++;
    }
    expect(dry).toBeGreaterThan(1000); expect(deep).toBeGreaterThan(10); expect(shore).toBeGreaterThan(100);
  });

  it('keeps the shore within a third of the cell grid\'s own edge, so no water vanishes and no land floods', () => {
    const rand = random(13);
    let tested = 0;
    for (let n = 0; n < 12000; n++) {
      const gx = 2 + rand() * (MAP_COLS - 4), gz = 2 + rand() * (MAP_ROWS - 4);
      if (!near(gx, gz, 3, wet)) continue;
      const u = gx - .5, v = gz - .5, ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
      const grid = (wet(ix, iz) ? (1 - fx) * (1 - fz) : 0) + (wet(ix + 1, iz) ? fx * (1 - fz) : 0) + (wet(ix, iz + 1) ? (1 - fx) * fz : 0) + (wet(ix + 1, iz + 1) ? fx * fz : 0);
      expect(Math.abs(smoothShoreShare(terrain, gx, gz) - grid)).toBeLessThan(.31);
      tested++;
    }
    expect(tested).toBeGreaterThan(500);
  });

  it('keeps every water cell under the water: its centre is below the surface, except right beside a road (on its bank)', () => {
    let water = 0;
    for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
      const c = terrain[y][x];
      if (c.type !== 'water' || c.bridge) continue;
      water++;
      if (roadEdgeAt(x + .5, y + .5, 2) > -2) continue;
      const bed = waterBedHeightAt(terrain, x + .5, y + .5);
      expect(bed, `water cell (${x}, ${y})`).toBeDefined();
      expect(groundHeightAt(terrain, x + .5, y + .5), `water cell (${x}, ${y})`).toBeLessThan(bed! + WATER_DEPTH);
    }
    expect(water).toBeGreaterThan(5000);
  });

  it('has no cliffs: near water the ground never jumps more than 0.3 cell over 0.05', () => {
    const rand = random(17);
    let worst = 0, lines = 0;
    for (let n = 0; n < 3000; n++) {
      const gx = 2 + rand() * (MAP_COLS - 8), gz = 2 + rand() * (MAP_ROWS - 4);
      if (!near(gx, gz, 2, wet)) continue;
      lines++;
      for (let k = 0; k < 40; k++) worst = Math.max(worst, Math.abs(groundHeightAt(terrain, gx + (k + 1) * .05, gz) - groundHeightAt(terrain, gx + k * .05, gz)));
    }
    expect(lines).toBeGreaterThan(200);
    expect(worst).toBeLessThan(.3);
  });

  it('runs public roads level across their width beside water: the lane does not tilt into the lake', () => {
    let beside = 0, tilted = 0;
    for (const road of LEIPALINGIS_ROADS.filter(r => r.class !== 'track')) {
      const hw = roadHalfWidth(road);
      for (let i = 1; i < road.points.length; i++) {
        const [ax, ay] = road.points[i - 1], [bx, by] = road.points[i], l = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(l / .2));
        const nx = -(by - ay) / (l || 1), ny = (bx - ax) / (l || 1);
        for (let k = 0; k < steps; k++) {
          const x = ax + (bx - ax) * k / steps, y = ay + (by - ay) * k / steps;
          // (Not on or beside a deck: there the water meets the road's end by design.)
          if (cell(x, y)?.bridge || near(x, y, 3, (cx, cy) => !!terrain[cy]?.[cx]?.bridge) || !near(x, y, 2, (cx, cy) => terrain[cy]?.[cx]?.type === 'water')) continue;
          beside++;
          const centre = meshHeight(terrain, x, y);
          if ([-1, 1].some(side => centre - meshHeight(terrain, x + nx * side * hw, y + ny * side * hw) > .1)) tilted++;
        }
      }
    }
    expect(beside).toBeGreaterThan(1000);
    // (Before the banks: 15.6% of these stretches dipped by more than 0.1 cell, by up to 0.9.)
    expect(tilted / beside).toBeLessThan(.005);
  });

  it('keeps the water off the lane: where a road runs beside water its edges stay above the surface', () => {
    let beside = 0, flooded = 0;
    for (const road of LEIPALINGIS_ROADS.filter(r => r.class !== 'track')) {
      const hw = roadHalfWidth(road);
      for (let i = 1; i < road.points.length; i++) {
        const [ax, ay] = road.points[i - 1], [bx, by] = road.points[i], l = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(l / .2));
        const nx = -(by - ay) / (l || 1), ny = (bx - ax) / (l || 1);
        for (let k = 0; k < steps; k++) {
          const x = ax + (bx - ax) * k / steps, y = ay + (by - ay) * k / steps;
          if (cell(x, y)?.bridge || near(x, y, 3, (cx, cy) => !!terrain[cy]?.[cx]?.bridge) || !near(x, y, 2, (cx, cy) => terrain[cy]?.[cx]?.type === 'water')) continue;
          beside++;
          for (const side of [-1, 1]) {
            const ex = x + nx * side * hw, ey = y + ny * side * hw, bed = waterBedHeightAt(terrain, ex, ey);
            // (A few centimetres under is the map data putting a lake right at its road's height.)
            if (bed !== undefined && meshHeight(terrain, ex, ey) < bed + WATER_DEPTH - .05) { flooded++; break; }
          }
        }
      }
    }
    expect(beside).toBeGreaterThan(1000);
    // (Before the banks the water came up over the lane's edge at 2.8% of them, along Teiraus g. and others.)
    expect(flooded / beside).toBeLessThan(.005);
  });
});
