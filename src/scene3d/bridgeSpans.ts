import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { groundHeightAt } from './terrainHeight';

/**
 * Road bridges where a road crosses a river or lake. The map marks the deck
 * cells (`cell.bridge`): they are road for movement, while the ground under
 * them is river bed and the water sheet runs on beneath. Each crossing
 * (connected deck cells) becomes one straight span: deck slab, running
 * surface, edge beams, railings and supports. Paved roads get concrete,
 * gravel roads and tracks timber.
 */
export interface Box { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; color: string }

interface Span { cells: [number, number][]; bridge: NonNullable<TerrainCell['bridge']>; dx: number; dz: number }
const spanCache = new WeakMap<TerrainCell[][], Map<string, Span>>();

/** Connected deck cells form one crossing, aligned with the mean road direction:
 * a road that bends on the bridge would otherwise give two crooked decks.
 * Keyed by the crossing's first cell, so a span on a section border is drawn once. */
function crossings(terrain: TerrainCell[][]) {
  let spans = spanCache.get(terrain);
  if (spans) return spans;
  spans = new Map();
  const seen = new Set<number>(), cols = terrain[0].length;
  for (let y = 0; y < terrain.length; y++) for (let x = 0; x < cols; x++) {
    const first = terrain[y][x].bridge;
    if (!first || seen.has(y * cols + x)) continue;
    const cells: [number, number][] = [], queue: [number, number][] = [[x, y]];
    seen.add(y * cols + x);
    let sx = 0, sz = 0;
    while (queue.length) {
      const [cx, cy] = queue.pop()!; cells.push([cx, cy]);
      const b = terrain[cy][cx].bridge!;
      let ux = b.b[0] - b.a[0], uz = b.b[1] - b.a[1];
      const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
      if (ux * (first.b[0] - first.a[0]) + uz * (first.b[1] - first.a[1]) < 0) { ux = -ux; uz = -uz; }
      sx += ux; sz += uz;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (terrain[ny]?.[nx]?.bridge && !seen.has(ny * cols + nx)) { seen.add(ny * cols + nx); queue.push([nx, ny]); }
      }
    }
    const l = Math.hypot(sx, sz) || 1;
    spans.set(`${x},${y}`, { cells, bridge: first, dx: sx / l, dz: sz / l });
  }
  spanCache.set(terrain, spans);
  return spans;
}

export function spanBoxes(terrain: TerrainCell[][], section: MapSection): Box[] {
  const boxes: Box[] = [];
  for (const [key, { cells, bridge, dx, dz }] of crossings(terrain)) {
    const [kx, ky] = key.split(',').map(Number);
    if (kx < section.x || ky < section.y || kx >= section.x + section.width || ky >= section.y + section.height) continue;
    const ax = cells.reduce((n, c) => n + c[0] + .5, 0) / cells.length, ay = cells.reduce((n, c) => n + c[1] + .5, 0) / cells.length;
    // Deck covers every crossing cell along the road line, plus a little bank.
    const ts = cells.map(([x, y]) => (x + .5 - ax) * dx + (y + .5 - ay) * dz);
    const t0 = Math.min(...ts) - .6, t1 = Math.max(...ts) + .6, L = t1 - t0, tm = (t0 + t1) / 2;
    const at = (t: number) => [ax + dx * t, ay + dz * t] as const;
    const [mx, mz] = at(tm);
    // Level deck at the height units stand at on it (surfaceY over deck cells).
    const top = Math.max(...cells.map(([x, y]) => groundHeightAt(terrain, x + .5, y + .5, true)));
    // Deck carries the road and its gravel shoulders.
    const yaw = -Math.atan2(dz, dx), w = Math.max(.55, bridge.width + .3);
    const deck = bridge.paved ? '#8f8c84' : '#7a6248', trim = bridge.paved ? '#b1aea4' : '#5f4a35';
    const side = (o: number) => [mx - dz * o, mz + dx * o] as const;
    boxes.push({ x: mx, y: top - .06, z: mz, sx: L, sy: .12, sz: w, yaw, color: deck });
    // Running surface: asphalt on a road bridge, lighter planks on a timber one.
    boxes.push({ x: mx, y: top + .003, z: mz, sx: L - .04, sy: .01, sz: bridge.paved ? bridge.width : w - .14, yaw, color: bridge.paved ? '#4a5151' : '#8c7354' });
    for (const s of [-1, 1]) {
      const [ex, ez] = side(s * (w / 2 + .03));
      boxes.push({ x: ex, y: top - .1, z: ez, sx: L, sy: .22, sz: .07, yaw, color: trim });
      const o = s * (w / 2 - .03), [rx, rz] = side(o);
      // Railing: top and middle rails on posts about every half cell.
      for (const h of [.11, .22]) boxes.push({ x: rx, y: top + h, z: rz, sx: L, sy: .045, sz: .05, yaw, color: trim });
      const posts = Math.max(2, Math.round((L - .2) / .45));
      for (let k = 0; k <= posts; k++) {
        const [px, pz] = at(t0 + .1 + (L - .2) * k / posts);
        boxes.push({ x: px - dz * o, y: top + .12, z: pz + dx * o, sx: .06, sy: .24, sz: .06, yaw, color: trim });
      }
    }
    // Supports down to the bed: abutments at the ends, piers on long spans.
    const supports = [t0 + .15, t1 - .15];
    for (let k = 1, n = Math.floor(L / 1.6); k < n; k++) supports.push(t0 + L * k / n);
    for (const t of supports) {
      const [px, pz] = at(t), bed = groundHeightAt(terrain, px, pz), h = Math.max(.1, top - .12 - bed);
      boxes.push({ x: px, y: bed + h / 2, z: pz, sx: .16, sy: h, sz: w * .86, yaw, color: bridge.paved ? '#7f7c75' : '#5e4a36' });
    }
  }
  return boxes;
}
