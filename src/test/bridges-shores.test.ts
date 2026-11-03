import { describe, expect, it } from 'vitest';
import { generateTerrain, isPassable } from '../game/terrain';
import { TerrainCell } from '../game/types';
import { groundHeightAt, bridgeDeckEnds } from '../scene3d/terrainHeight';
import { spanBoxes } from '../scene3d/bridgeSpans';
import { drivewaysIn } from '../scene3d/roadMaterial';
import { mapSections } from '../scene3d/mapSections';
import { LEIPALINGIS_ROADS, PLAYABLE_CELLS } from '../game/maps/leipalingis';

const terrain = generateTerrain('leipalingis_region', 1917);
const cells = terrain.flat();
const at = (x: number, y: number) => terrain[Math.floor(y)]?.[Math.floor(x)];
const spans = [...new Set(cells.filter(c => c.bridge).map(c => c.bridge!))];

describe('bridges, shores and driveways', () => {
  it('bridges only where a road actually crosses water, from land to land', () => {
    expect(spans.length).toBeGreaterThanOrEqual(10);
    for (const s of spans) {
      // Both ends on land, the water in between.
      for (const end of [s.a, s.b]) expect(['water'].includes(at(end[0], end[1])!.type) || !!at(end[0], end[1])!.bridge).toBe(false);
      expect(s.tin).toBeGreaterThan(0); expect(s.tout).toBeLessThan(1); expect(s.tin).toBeLessThan(s.tout);
      // A real crossing: somewhere over the water there is water on both
      // sides of the road (a road along a bank used to become a "bridge"
      // lying beside the water).
      const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), nx = -(s.b[1] - s.a[1]) / L, ny = (s.b[0] - s.a[0]) / L;
      const wet = (c?: TerrainCell) => !!c && (c.type === 'water' || !!c.bridge);
      const off = s.width / 2 + .6;
      const across = Array.from({ length: 11 }, (_, k) => s.tin + (s.tout - s.tin) * k / 10).some(t => {
        const mx = s.a[0] + (s.b[0] - s.a[0]) * t, my = s.a[1] + (s.b[1] - s.a[1]) * t;
        return wet(at(mx + nx * off, my + ny * off)) && wet(at(mx - nx * off, my - ny * off));
      });
      expect(across).toBe(true);
    }
  });

  it('keeps every deck cell on its own span and the river flowing beside it', () => {
    const [x0, y0, x1, y1] = PLAYABLE_CELLS;
    for (const c of cells.filter(c => c.bridge)) {
      const x = c.x / 32, y = c.y / 32, s = c.bridge!;
      expect(c.type === 'road' || c.type === 'gravel').toBe(true);
      if (x >= x0 && y >= y0 && x < x1 && y < y1) expect(isPassable(c, true, false)).toBe(true);
      const vx = s.b[0] - s.a[0], vy = s.b[1] - s.a[1], l2 = vx * vx + vy * vy;
      const t = Math.max(0, Math.min(1, ((x + .5 - s.a[0]) * vx + (y + .5 - s.a[1]) * vy) / l2));
      expect(Math.hypot(s.a[0] + vx * t - x - .5, s.a[1] + vy * t - y - .5)).toBeLessThan(s.width / 2 + .9);
      // Units stand on the deck, above the river bed under it.
      expect(groundHeightAt(terrain, x + .5, y + .5, true)).toBeGreaterThan(groundHeightAt(terrain, x + .5, y + .5) + .3);
    }
  });

  it('never lets two bridges meet, and puts every junction at a bridge on land at its end', () => {
    const dist = (x: number, y: number, a: number[], b: number[]) => {
      const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2));
      return Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y);
    };
    for (const s of spans) for (const o of spans) {
      if (s === o) continue;
      // Sample one deck's water stretch against the other deck's line.
      for (let k = 0; k <= 10; k++) {
        const t = s.tin + (s.tout - s.tin) * k / 10, x = s.a[0] + (s.b[0] - s.a[0]) * t, y = s.a[1] + (s.b[1] - s.a[1]) * t;
        expect(dist(x, y, o.a, o.b)).toBeGreaterThan((s.width + o.width) / 2 + .3);
      }
    }
    // A road that ends at a bridge ends at one of its bank ends, on land
    // (a road the map data splits at the river carries on as its next piece).
    const continues = (r: typeof LEIPALINGIS_ROADS[number], e: number[]) => LEIPALINGIS_ROADS.some(o => o !== r && o.class === r.class
      && (o.name === r.name || !o.name || !r.name) && [o.points[0], o.points[o.points.length - 1]].some(p => Math.hypot(p[0] - e[0], p[1] - e[1]) < .05));
    for (const r of LEIPALINGIS_ROADS) for (const e of [r.points[0], r.points[r.points.length - 1]]) for (const s of spans) {
      if (continues(r, e)) continue;
      const t = ((e[0] - s.a[0]) * (s.b[0] - s.a[0]) + (e[1] - s.a[1]) * (s.b[1] - s.a[1])) / ((s.b[0] - s.a[0]) ** 2 + (s.b[1] - s.a[1]) ** 2);
      if (dist(e[0], e[1], s.a, s.b) > s.width / 2 + .3 || t < s.tin || t > s.tout) continue;
      throw new Error(`road ${r.name} ends on a bridge over the water at ${e.map(v => v.toFixed(1))}`);
    }
  });

  it('rebuilds the badly skewed crossings square to the river', () => {
    // Radvilonių g. used to cross diagonally on a 9-cell deck with a second bridge joining it.
    const radv = spans.filter(s => Math.abs(s.a[0] - 18.7) < 4 && Math.abs(s.a[1] - 118) < 4);
    expect(radv.length).toBe(1);
    expect(Math.hypot(radv[0].b[0] - radv[0].a[0], radv[0].b[1] - radv[0].a[1])).toBeLessThan(5);
    expect(spans.every(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < 7)).toBe(true);
  });

  it('slopes each deck so both ends sit on the road at the banks', () => {
    for (const s of spans) {
      const [ha, hb] = bridgeDeckEnds(terrain, s);
      expect(Math.abs(groundHeightAt(terrain, s.a[0], s.a[1], true) - ha)).toBeLessThan(.15);
      expect(Math.abs(groundHeightAt(terrain, s.b[0], s.b[1], true) - hb)).toBeLessThan(.15);
    }
    const boxes = mapSections().flatMap(section => spanBoxes(terrain, section));
    expect(boxes.length).toBeGreaterThan(spans.length * 10);
    expect(boxes.every(b => [b.x, b.y, b.z, b.sx, b.sy, b.sz, b.yaw].every(Number.isFinite))).toBe(true);
  });

  it('runs each driveway from a house front straight to a street in front of it', () => {
    const drives = drivewaysIn(terrain, 0, 0, terrain[0].length, terrain.length);
    const homes = cells.filter(c => c.type === 'urban' && c.settlementId && c.buildingKind !== 'barn' && c.buildingKind !== 'church');
    expect(drives.length).toBeGreaterThan(homes.length * .4);
    // Distance from a point to the nearest road centre line, and that road's width.
    const street = (x: number, y: number) => {
      let best = { d: Infinity, width: 0 };
      for (const r of LEIPALINGIS_ROADS) for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1], b = r.points[i];
        if (x < Math.min(a[0], b[0]) - 3 || x > Math.max(a[0], b[0]) + 3 || y < Math.min(a[1], b[1]) - 3 || y > Math.max(a[1], b[1]) + 3) continue;
        const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / l2));
        const d = Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y);
        if (d < best.d) best = { d, width: r.width };
      }
      return best;
    };
    for (const d of drives) {
      // Ends on the drawn road surface, never on a house.
      const s = street(d.to[0], d.to[1]);
      expect(s.d).toBeLessThan(s.width / 2 + .02);
      expect(at(d.to[0], d.to[1])!.type).not.toBe('urban');
      expect(Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1])).toBeLessThan(2.5);
    }
  });

  it('rounds road corners without moving any junction', () => {
    const ends = LEIPALINGIS_ROADS.flatMap(r => [r.points[0], r.points[r.points.length - 1]]);
    // Every road end that met another road still lies on a road.
    let joined = 0;
    for (const e of ends) {
      const others = LEIPALINGIS_ROADS.filter(r => r.points.some((p, i) => i > 0 && Math.hypot(p[0] - e[0], p[1] - e[1]) < 6));
      const onRoad = others.some(r => r.points.some((p, i) => {
        if (!i) return false;
        const a = r.points[i - 1], vx = p[0] - a[0], vy = p[1] - a[1], l2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((e[0] - a[0]) * vx + (e[1] - a[1]) * vy) / l2));
        return Math.hypot(a[0] + vx * t - e[0], a[1] + vy * t - e[1]) < .02 && !(r.points[0] === e || r.points[r.points.length - 1] === e);
      }));
      if (onRoad) joined++;
    }
    expect(joined).toBeGreaterThan(ends.length * .3);
    // No sharp kinks left on main roads (turns between consecutive pieces stay gentle).
    for (const r of LEIPALINGIS_ROADS.filter(r => /primary|secondary/.test(r.class))) {
      for (let i = 1; i < r.points.length - 1; i++) {
        const a = r.points[i - 1], b = r.points[i], c = r.points[i + 1];
        const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
        const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
        if (lu < .05 || lv < .05) continue;
        const turn = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))));
        if (turn > .45) expect(ends.some(e => Math.hypot(e[0] - b[0], e[1] - b[1]) < .35)).toBe(true);
      }
    }
  });
});
