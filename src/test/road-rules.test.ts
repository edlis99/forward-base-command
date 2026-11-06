import { describe, expect, it } from 'vitest';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { MAP_SECTIONS } from '../scene3d/mapSections';
import { createRoadData, roadEdgeAt, roadHalfWidth, roadKind, ROAD_GUTTER } from '../scene3d/roadMaterial';
import { roadRank, trafficPlan, type SignPost } from '../scene3d/roadRules';

const plan = trafficPlan();
const near = (a: { x: number; y: number }, b: { x: number; y: number }, r: number) => Math.hypot(a.x - b.x, a.y - b.y) < r;
const has = (post: SignPost, type: string) => post.plates.some(p => p.type === type);

/** The centre line's dash value baked at a point (1: no line there, 0: continuous). */
const baked = new Map<(typeof MAP_SECTIONS)[number], { data: Uint8Array; width: number }>();
function dashAtPoint(x: number, y: number) {
  const section = MAP_SECTIONS.find(s => x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height)!;
  if (!baked.has(section)) baked.set(section, createRoadData(section).image as { data: Uint8Array; width: number });
  const { data, width } = baked.get(section)!, res = width / (section.width + ROAD_GUTTER * 2);
  return data[(Math.floor((y - section.y + ROAD_GUTTER) * res) * width + Math.floor((x - section.x + ROAD_GUTTER) * res)) * 4 + 3] / 255;
}

/** The point `s` cells along a path. */
function pointAlong(path: [number, number][], s: number) {
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], l = Math.hypot(bx - ax, by - ay);
    if (s <= l || i === path.length - 1) return { x: ax + (bx - ax) * Math.min(1, s / (l || 1)), y: ay + (by - ay) * Math.min(1, s / (l || 1)) };
    s -= l;
  }
  return { x: path[0][0], y: path[0][1] };
}

/** The nearest point on any road's centre line. */
function nearestCentre(x: number, y: number) {
  let best = { d: Infinity, x: 0, y: 0 };
  for (const road of LEIPALINGIS_ROADS) for (let i = 1; i < road.points.length; i++) {
    const [ax, ay] = road.points[i - 1], [bx, by] = road.points[i], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)), qx = ax + vx * t, qy = ay + vy * t, d = Math.hypot(x - qx, y - qy);
    if (d < best.d) best = { d, x: qx, y: qy };
  }
  return best;
}

describe('roads by the Lithuanian traffic rules', () => {
  it("controls Leipalingis's central crossroads with traffic lights: a light, a stop line and a crossing on every approach", () => {
    const j = plan.junctions.find(k => k.control === 'signals')!;
    expect(j.settlement?.id).toBe('leipalingis');
    const lights = plan.signals.filter(s => s.junction === j.id);
    expect(lights.length).toBe(j.legs.length);
    // The main road and the side roads take turns.
    expect(new Set(lights.map(l => l.group)).size).toBe(2);
    expect(plan.markings.filter(m => m.type === 'stop-line' && near(m, j, 2.2)).length).toBe(j.legs.length);
    expect(plan.markings.filter(m => m.type === 'signal-crossing' && near(m, j, 2)).length).toBeGreaterThanOrEqual(3);
  });

  it("makes Seirijai's market square a roundabout: the round sign and 203 at every entry, with give-way triangles", () => {
    const j = plan.junctions.find(k => k.control === 'roundabout')!;
    expect(j.settlement?.id).toBe('seirijai');
    expect(plan.roundabouts).toHaveLength(1);
    const entries = plan.posts.filter(p => has(p, 'roundabout') && has(p, 'give-way') && near(p, j, 3));
    expect(entries.length).toBe(j.legs.length);
    expect(plan.markings.filter(m => m.type === 'give-way' && near(m, j, 2)).length).toBe(j.legs.length);
  });

  it('puts 203 "Duoti kelią" or 204 "STOP" on public side roads at priority junctions, and nothing on field tracks', () => {
    let sides = 0, signed = 0;
    for (const j of plan.junctions.filter(k => k.control === 'priority')) {
      for (const leg of j.legs.filter(l => !j.main.includes(l))) {
        const control = plan.posts.filter(p => (has(p, 'give-way') || has(p, 'stop')) && near(p, j, 1.6));
        if (leg.road.class === 'track') continue;
        sides++;
        if (control.length) signed++;
      }
      // The main road outranks every side road it gives priority over.
      expect(Math.min(...j.main.map(l => l.rank))).toBeGreaterThanOrEqual(Math.max(...j.legs.filter(l => !j.main.includes(l)).map(l => l.rank)) - 1e-9);
    }
    expect(sides).toBeGreaterThan(20);
    expect(signed / sides).toBeGreaterThan(.85);
    // Junctions of field tracks only, or of equal minor streets, carry no priority signs (the right-hand
    // rule) - those standing clear of any junction that does.
    const controlled = plan.junctions.filter(k => k.control !== 'equal');
    for (const j of plan.junctions.filter(k => k.control === 'equal' && !controlled.some(c => near(c, k, 2))))
      expect(plan.posts.some(p => (has(p, 'give-way') || has(p, 'stop') || has(p, 'main-road')) && near(p, j, .9))).toBe(false);
  });

  it('uses STOP only out in the country, where a side road joins a main state road', () => {
    for (const post of plan.posts.filter(p => has(p, 'stop'))) {
      const j = plan.junctions.filter(k => near(post, k, 1.6)).sort((a, b) => Math.hypot(a.x - post.x, a.y - post.y) - Math.hypot(b.x - post.x, b.y - post.y))[0];
      expect(j).toBeDefined();
      expect(!j.settlement || j.settlement.size === 'hamlet').toBe(true);
      expect(Math.min(...j.main.map(l => roadRank(l.road)))).toBeGreaterThanOrEqual(4.9);
    }
  });

  it('stands every sign off the carriageway, on the right for the drivers it faces', () => {
    let right = 0;
    for (const post of plan.posts) {
      expect(roadEdgeAt(post.x, post.y, 1.5)).toBeLessThan(-.05);
      // Drivers it is for come towards its face: heading the other way to its facing.
      const c = nearestCentre(post.x, post.y), hx = -Math.cos(post.facing), hy = -Math.sin(post.facing);
      if ((post.x - c.x) * -hy + (post.y - c.y) * hx > 0) right++;
    }
    expect(plan.posts.length).toBeGreaterThan(300);
    expect(right / plan.posts.length).toBeGreaterThan(.95);
  });

  it('signs every town and village on the public roads into it, its end sign leaving it; hamlets have the blue name sign', () => {
    const starts = plan.posts.filter(p => has(p, 'town-start')), ends = plan.posts.filter(p => has(p, 'town-end'));
    expect(starts.length).toBeGreaterThan(30);
    for (const name of new Set(starts.map(p => p.plates[0].text))) {
      const n = starts.filter(p => p.plates[0].text === name).length, m = ends.filter(p => p.plates[0].text === name).length;
      expect(Math.abs(n - m)).toBeLessThanOrEqual(1);
    }
    expect(starts.some(p => p.plates[0].text === 'Leipalingis')).toBe(true);
    expect(plan.posts.some(p => has(p, 'place-name'))).toBe(true);
    // 70 km/h ahead of the larger settlements on the main roads.
    expect(plan.posts.some(p => has(p, 'speed-70'))).toBe(true);
  });

  it('marks zebra crossings with 533 "Pėsčiųjų perėja" on both sides', () => {
    const zebras = plan.markings.filter(m => m.type === 'zebra');
    expect(zebras.length).toBeGreaterThan(5);
    for (const z of zebras) {
      // One on each side of the road (crossings close together may share the verge with a neighbour's).
      const across = [-Math.sin(z.angle), Math.cos(z.angle)];
      const sides = plan.posts.filter(p => has(p, 'crossing') && near(p, z, z.across / 2 + .7)).map(p => Math.sign((p.x - z.x) * across[0] + (p.y - z.y) * across[1]));
      expect(new Set(sides).size).toBe(2);
    }
  });

  it('runs the centre line continuous (1.1) before a junction', () => {
    // A marked main road at a priority junction: just outside the junction its centre line is solid.
    const j = plan.junctions.find(k => k.control === 'priority' && k.main.every(l => l.road.paved && l.road.width >= .6 && l.road.class !== 'track')
      && k.x > 30 && k.y > 30 && k.x < 400 && k.y < 290)!;
    const leg = j.main[0], hw = roadHalfWidth(leg.road);
    const section = MAP_SECTIONS.find(s => j.x >= s.x && j.x < s.x + s.width && j.y >= s.y && j.y < s.y + s.height)!;
    const tex = createRoadData(section), { data, width } = tex.image as { data: Uint8Array; width: number };
    const res = width / (section.width + ROAD_GUTTER * 2);
    const dashAt = (x: number, y: number) => data[(Math.floor((y - section.y + ROAD_GUTTER) * res) * width + Math.floor((x - section.x + ROAD_GUTTER) * res)) * 4 + 3] / 255;
    // From just beyond the junction's mouth out to the solid stretch's end, along the leg's centre line.
    const samples: number[] = [];
    for (let s = hw + 1; s < 1.9; s += .1) {
      const x = j.x + leg.dir[0] * s, y = j.y + leg.dir[1] * s;
      if (x >= section.x && x < section.x + section.width && y >= section.y && y < section.y + section.height) samples.push(dashAt(x, y));
    }
    expect(samples.length).toBeGreaterThan(2);
    expect(Math.max(...samples)).toBeLessThan(.05);
  });

  it('ends the centre line at the stop line (none runs on into the junction) and paints none over crossings', () => {
    const j = plan.junctions.find(k => k.control === 'signals')!;
    let checked = 0;
    for (const leg of j.legs.filter(l => roadKind(l.road) === 4)) {
      // This approach's stop line, and how far out along the leg it lies.
      const line = plan.markings.filter(m => m.type === 'stop-line' && near(m, j, 2.2))
        .sort((a, b) => ((b.x - j.x) * leg.dir[0] + (b.y - j.y) * leg.dir[1]) - ((a.x - j.x) * leg.dir[0] + (a.y - j.y) * leg.dir[1]))[0];
      const at = (line.x - j.x) * leg.dir[0] + (line.y - j.y) * leg.dir[1];
      // Over the crossing and up to the stop line: no line. Behind it: continuous.
      for (let s = .5; s < at - .06; s += .05) { const p = pointAlong(leg.path, s); expect(dashAtPoint(p.x, p.y)).toBe(1); }
      for (let s = at + .1; s < at + .5; s += .05) { const p = pointAlong(leg.path, s); expect(dashAtPoint(p.x, p.y)).toBeLessThan(.05); }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
    for (const c of plan.markings.filter(m => m.type === 'zebra' || m.type === 'signal-crossing')) expect(dashAtPoint(c.x, c.y)).toBe(1);
  });
});
