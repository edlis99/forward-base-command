import type { MapRoad } from './leipalingis';

/** Intersections where lane paint must stop. Parallel/continuation segments do
 * not create a junction. Used for rendering, and independently testable. */
export function roadJunctions(roads: MapRoad[]): { x: number; y: number; radius: number }[] {
  const segments = roads.flatMap((road, roadIndex) => road.points.slice(1).map((b, i) => ({ a: road.points[i], b, road, roadIndex })));
  const buckets = new Map<string, number[]>(), compared = new Set<string>();
  const junctions = new Map<string, { x: number; y: number; radius: number }>();
  segments.forEach((s, index) => {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    for (let y = Math.floor(Math.min(s.a[1], s.b[1]) / 8); y <= Math.floor(Math.max(s.a[1], s.b[1]) / 8); y++) {
      for (let x = Math.floor(Math.min(s.a[0], s.b[0]) / 8); x <= Math.floor(Math.max(s.a[0], s.b[0]) / 8); x++) {
        const key = `${x},${y}`, entries = buckets.get(key) ?? [];
        for (const otherIndex of entries) {
          const pair = `${otherIndex},${index}`;
          if (compared.has(pair)) continue;
          compared.add(pair);
          const o = segments[otherIndex];
          if (o.roadIndex === s.roadIndex) continue;
          const ox = o.b[0] - o.a[0], oy = o.b[1] - o.a[1], cross = dx * oy - dy * ox;
          if (Math.abs(cross) < 1e-8 || Math.abs(cross) < .05 * Math.hypot(dx, dy) * Math.hypot(ox, oy)) continue;
          const ax = o.a[0] - s.a[0], ay = o.a[1] - s.a[1];
          const t = (ax * oy - ay * ox) / cross, u = (ax * dy - ay * dx) / cross;
          if (t < -.001 || t > 1.001 || u < -.001 || u > 1.001) continue;
          const jx = s.a[0] + dx * t, jy = s.a[1] + dy * t;
          junctions.set(`${Math.round(jx * 4)},${Math.round(jy * 4)}`, { x: jx, y: jy, radius: Math.max(s.road.width, o.road.width) * .85 });
        }
        entries.push(index); buckets.set(key, entries);
      }
    }
  });
  return [...junctions.values()];
}

/** Draw an opaque union of the complete network into ONE surface. No stacked
 * road meshes, no independent end caps at intersections, no depth fighting. */
export function paintRoadNetwork(ctx: CanvasRenderingContext2D, roads: MapRoad[], markings = false) {
  const stroke = (road: MapRoad, color: string, width: number) => {
    ctx.beginPath(); road.points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  ctx.save(); ctx.lineJoin = ctx.lineCap = 'round'; ctx.setLineDash([]);
  for (const road of roads) stroke(road, '#a19c81', road.width + (road.class === 'track' ? .08 : .2));
  for (const road of roads.filter(r => !r.paved)) stroke(road, '#988c6d', road.width);
  for (const road of roads.filter(r => r.paved)) stroke(road, '#485151', road.width);
  if (markings) {
    // Separate paint mask, composited only once. Remove paint around junctions
    // without punching holes in the asphalt below it.
    const canvas = document.createElement('canvas');
    canvas.width = ctx.canvas.width; canvas.height = ctx.canvas.height;
    const lines = canvas.getContext('2d')!; lines.setTransform(ctx.getTransform());
    lines.lineCap = 'butt'; lines.lineJoin = 'round'; lines.strokeStyle = '#d7d4bc';
    for (const road of roads.filter(r => r.paved && r.width >= 1.2)) {
      lines.setLineDash([.55, .65]); lines.lineWidth = .035;
      lines.beginPath(); road.points.forEach((p, i) => i ? lines.lineTo(p[0], p[1]) : lines.moveTo(p[0], p[1])); lines.stroke();
    }
    lines.setLineDash([]); lines.globalCompositeOperation = 'destination-out';
    for (const j of roadJunctions(roads.filter(r => r.class !== 'track'))) {
      lines.beginPath(); lines.arc(j.x, j.y, j.radius, 0, Math.PI * 2); lines.fill();
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(canvas, 0, 0); ctx.restore();
  }
  ctx.restore();
}
