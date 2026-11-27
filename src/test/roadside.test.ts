import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../game/terrain';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { SETTLEMENTS } from '../game/maps/settlements';
import { roadEdgeAt, roadKind } from '../scene3d/roadMaterial';
import { trafficPlan } from '../scene3d/roadRules';
import { planRoadside, POLE_SPACING, roadsideClear } from '../scene3d/roadsidePlan';

const terrain = generateTerrain('leipalingis_region', 1917);
const plan = planRoadside(terrain);
const depth = (x: number, y: number) => Math.min(...SETTLEMENTS.map(s => Math.hypot((x - s.x) / s.rx, (y - s.y) / s.ry)));

/** The road (never a farm track) whose centre line is nearest a point, and how far. */
function nearestRoad(x: number, y: number) {
  let best = { d: Infinity, kind: 0 };
  for (const road of LEIPALINGIS_ROADS) for (let i = 1; i < road.points.length; i++) {
    if (roadKind(road) < 2) continue;
    const [ax, ay] = road.points[i - 1], [bx, by] = road.points[i], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)), d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
    if (d < best.d) best = { d, kind: roadKind(road) };
  }
  return best;
}

describe('the roadside: poles and wires, street lamps, wayside crosses', () => {
  it('lines the paved roads with utility poles, wired in long runs, and lights the towns', () => {
    expect(plan.poles.length).toBeGreaterThan(500);
    expect(plan.spans.length).toBeGreaterThan(300);
    expect(plan.lamps.length).toBeGreaterThan(30);
    expect(plan.crosses.length).toBeGreaterThanOrEqual(3);
    // Mostly wired: most poles join their neighbour (a run of 3 or more poles).
    const joined = new Set(plan.spans.flatMap(s => [s.a, s.b]));
    expect(joined.size / plan.poles.length).toBeGreaterThan(.85);
  });

  it('puts everything on clear ground: off the carriageways, out of the water and the buildings, clear of the signs', () => {
    const traffic = trafficPlan();
    for (const thing of [...plan.poles, ...plan.lamps, ...plan.crosses]) {
      expect(roadsideClear(terrain, thing.x, thing.y), `(${thing.x.toFixed(1)}, ${thing.y.toFixed(1)})`).toBe(true);
      expect(roadEdgeAt(thing.x, thing.y, 1.5)).toBeLessThan(-.19);
      expect(traffic.posts.some(p => Math.hypot(p.x - thing.x, p.y - thing.y) < .6)).toBe(false);
    }
  });

  it('spaces the poles like a real line (about 48 m), and breaks the wire where a pole is missing', () => {
    for (const span of plan.spans) {
      const a = plan.poles[span.a], b = plan.poles[span.b], d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(d).toBeGreaterThan(.9);
      expect(d).toBeLessThan(POLE_SPACING * 1.7);
    }
    // No two poles stand in each other's way.
    for (let i = 0; i < plan.poles.length; i += 3) for (let j = i + 1; j < plan.poles.length; j++)
      if (Math.abs(plan.poles[i].x - plan.poles[j].x) < 1 && Math.abs(plan.poles[i].y - plan.poles[j].y) < 1) expect(Math.hypot(plan.poles[i].x - plan.poles[j].x, plan.poles[i].y - plan.poles[j].y)).toBeGreaterThanOrEqual(1);
  });

  it('runs the lines along paved roads and village streets, never farm tracks, and gravel only inside a settlement', () => {
    for (const pole of plan.poles) {
      // Each stands beside a road that is not a track (within its half width and the pole offset of the centre line).
      expect(pole.kind, `pole (${pole.x.toFixed(1)}, ${pole.y.toFixed(1)})`).toBeGreaterThanOrEqual(2);
      expect(nearestRoad(pole.x, pole.y).d).toBeLessThan(1);
      if (pole.kind === 2) expect(depth(pole.x, pole.y)).toBeLessThan(1.2);
    }
    expect(plan.poles.some(p => p.kind === 2)).toBe(true);
    expect(plan.poles.some(p => p.kind >= 3)).toBe(true);
  });

  it('puts street lamps only in the towns and the centres, and wayside crosses out in the country, a long way apart', () => {
    for (const lamp of plan.lamps) {
      const town = SETTLEMENTS.find(s => Math.hypot((lamp.x - s.x) / s.rx, (lamp.y - s.y) / s.ry) < .76);
      expect(town, `lamp (${lamp.x.toFixed(1)}, ${lamp.y.toFixed(1)})`).toBeDefined();
      expect(['centre', 'town']).toContain(town!.size);
    }
    for (const [i, a] of plan.crosses.entries()) {
      expect(depth(a.x, a.y)).toBeGreaterThan(1.2);
      for (const b of plan.crosses.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(30);
    }
  });
});
