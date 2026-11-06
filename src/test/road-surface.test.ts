import { describe, expect, it } from 'vitest';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { MAP_SECTIONS } from '../scene3d/mapSections';
import { createRoadData, ROAD_E_MAX, ROAD_GUTTER, roadHalfWidth, roadKind } from '../scene3d/roadMaterial';

/** The road data of the section holding a point, decoded there: edge distance, across, kind, dashes. */
function roadDataAt(x: number, z: number) {
  const section = MAP_SECTIONS.find(s => x >= s.x && x < s.x + s.width && z >= s.y && z < s.y + s.height)!;
  const texture = createRoadData(section);
  const { data, width } = texture.image as { data: Uint8Array; width: number };
  const res = width / (section.width + ROAD_GUTTER * 2);
  const i = (Math.floor((z - section.y + ROAD_GUTTER) * res) * width + Math.floor((x - section.x + ROAD_GUTTER) * res)) * 4;
  return { edge: (data[i] / 255 - .5) * 2 * ROAD_E_MAX, across: (data[i + 1] / 255 - .5) * 4, kind: data[i + 2] / 255 * 4, dash: data[i + 3] / 255 };
}

/** A straight stretch of road at least `min` cells long, well inside the map. */
function stretch(test: (r: (typeof LEIPALINGIS_ROADS)[number]) => boolean, min = 3) {
  for (const road of LEIPALINGIS_ROADS.filter(test)) for (let i = 1; i < road.points.length; i++) {
    const [ax, az] = road.points[i - 1], [bx, bz] = road.points[i], len = Math.hypot(bx - ax, bz - az);
    if (len >= min && Math.min(ax, bx) > 20 && Math.min(az, bz) > 20 && Math.max(ax, bx) < 420 && Math.max(az, bz) < 300)
      return { road, ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len };
  }
  throw new Error('no such road');
}

describe('road surfaces', () => {
  it('stores where a main road runs: its edges, the side of it, its kind and its dashes', () => {
    const { road, ax, az, ux, uz, len } = stretch(r => roadKind(r) === 4);
    const hw = roadHalfWidth(road), mx = ax + ux * len / 2, mz = az + uz * len / 2;
    const centre = roadDataAt(mx, mz);
    expect(centre.edge).toBeCloseTo(hw, 1);
    expect(Math.abs(centre.across)).toBeLessThan(.15);
    expect(Math.round(centre.kind)).toBe(4);
    // Either side: across has opposite signs; off the road the edge distance is negative.
    const left = roadDataAt(mx - uz * hw * .6, mz + ux * hw * .6), right = roadDataAt(mx + uz * hw * .6, mz - ux * hw * .6);
    expect(Math.sign(left.across)).toBe(-Math.sign(right.across));
    expect(Math.abs(left.across)).toBeGreaterThan(.4);
    expect(roadDataAt(mx - uz * (hw + .3), mz + ux * (hw + .3)).edge).toBeLessThan(-.15);
    // Along the centre line the dashes come and go.
    const dashes = Array.from({ length: 24 }, (_, k) => roadDataAt(ax + ux * (.5 + k * .1), az + uz * (.5 + k * .1)).dash);
    expect(Math.min(...dashes)).toBeLessThan(.3);
    expect(Math.max(...dashes)).toBeGreaterThan(.6);
  });
  it('tells asphalt, gravel and farm tracks apart', () => {
    for (const kind of [1, 2, 3]) {
      const { ax, az, ux, uz, len } = stretch(r => roadKind(r) === kind, 1.5);
      expect(Math.round(roadDataAt(ax + ux * len / 2, az + uz * len / 2).kind)).toBe(kind);
    }
  });
  it('runs no centre line through a junction', () => {
    // Where a main road crosses another road at a good angle (a shallow fork keeps its line).
    const segments = LEIPALINGIS_ROADS.filter(r => r.class !== 'track').flatMap(road => road.points.slice(1).map((b, i) => ({ road, a: road.points[i], b })));
    let found = 0;
    for (const s of segments) {
      if (roadKind(s.road) !== 4 || found >= 3) continue;
      for (const o of segments) {
        if (o.road === s.road) continue;
        const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], ox = o.b[0] - o.a[0], oz = o.b[1] - o.a[1], cross = dx * oz - dz * ox;
        const ls = Math.hypot(dx, dz), lo = Math.hypot(ox, oz);
        if (Math.abs(cross) < .7 * ls * lo) continue; // under 45 degrees
        const t = ((o.a[0] - s.a[0]) * oz - (o.a[1] - s.a[1]) * ox) / cross, u = ((o.a[0] - s.a[0]) * dz - (o.a[1] - s.a[1]) * dx) / cross;
        if (t < .05 || t > .95 || u < .05 || u > .95) continue;
        const jx = s.a[0] + dx * t, jz = s.a[1] + dz * t;
        if (jx < 20 || jz < 20 || jx > 420 || jz > 300) continue;
        expect(roadDataAt(jx, jz).dash).toBe(1);
        found++;
        break;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
