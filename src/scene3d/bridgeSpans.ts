import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { BRIDGE_DECK_LIFT, bridgeDeckEnds, groundHeightAt } from './terrainHeight';
import { deckWidth, railings } from '../game/terrain';

/**
 * Road bridges where a road's centre line crosses a river or lake. The map
 * marks the deck cells (`cell.bridge`, shared per crossing): road for
 * movement, while the ground under them is river bed and the water sheet
 * runs on beneath. Each crossing is one straight span along the road from a
 * point on land to a point on land, sloped so both ends sit flush on the
 * road: deck slab, running surface, edge beams, railings over the water,
 * abutments at the banks and piers on long spans. Paved roads get concrete,
 * gravel roads and tracks timber.
 */
export interface Box { x: number; y: number; z: number; sx: number; sy: number; sz: number; yaw: number; pitch?: number; color: string }
type BridgeInfo = NonNullable<TerrainCell['bridge']>;

const spanCache = new WeakMap<TerrainCell[][], BridgeInfo[]>();
/** Every crossing on the map once (cells of a crossing share one info object). */
function crossings(terrain: TerrainCell[][]) {
  let spans = spanCache.get(terrain);
  if (!spans) {
    const unique = new Set<BridgeInfo>();
    for (const row of terrain) for (const c of row) if (c.bridge) unique.add(c.bridge);
    spans = [...unique];
    spanCache.set(terrain, spans);
  }
  return spans;
}

export function spanBoxes(terrain: TerrainCell[][], section: MapSection): Box[] {
  const boxes: Box[] = [];
  for (const bridge of crossings(terrain)) {
    const [ax, az] = bridge.a, [bx, bz] = bridge.b;
    // Drawn by the section holding the span's middle, so a span on a border appears once.
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (mx < section.x || mz < section.y || mx >= section.x + section.width || mz >= section.y + section.height) continue;
    const L = Math.hypot(bx - ax, bz - az) || 1, dx = (bx - ax) / L, dz = (bz - az) / L;
    const [ha, hb] = bridgeDeckEnds(terrain, bridge);
    const top = (t: number) => ha + (hb - ha) * t + BRIDGE_DECK_LIFT;
    const at = (t: number) => [ax + (bx - ax) * t, az + (bz - az) * t] as const;
    const yaw = -Math.atan2(dz, dx), pitch = Math.atan2(hb - ha, L);
    // Deck carries the road and its gravel shoulders.
    const w = deckWidth(bridge);
    const deck = bridge.paved ? '#8f8c84' : '#7a6248', trim = bridge.paved ? '#b1aea4' : '#5f4a35';
    const along = (t0: number, t1: number, offset: number, y: number, sy: number, sz: number, color: string) => {
      const tm = (t0 + t1) / 2, [px, pz] = at(tm);
      boxes.push({ x: px - dz * offset, y: top(tm) + y, z: pz + dx * offset, sx: L * (t1 - t0), sy, sz, yaw, pitch, color });
    };
    // Slab and running surface over the whole span, onto the road at both ends.
    along(0, 1, 0, -.06, .12, w, deck);
    along(.01, .99, 0, .004, .01, bridge.paved ? bridge.width : w - .14, bridge.paved ? '#4a5151' : '#8c7354');
    if (bridge.paved) {
      // Concrete: raised kerbs inside the railings and a girder under the deck over the water.
      for (const s of [-1, 1]) along(.02, .98, s * (w / 2 - .09), .02, .04, .07, '#a9a69c');
      along(Math.max(0, bridge.tin - .08), Math.min(1, bridge.tout + .08), 0, -.17, .12, w * .62, '#77746d');
    } else {
      // Timber: plank seams across the deck.
      const planks = Math.max(4, Math.round(L / .2));
      for (let k = 1; k < planks; k++) {
        const t = k / planks, [px, pz] = at(t);
        boxes.push({ x: px, y: top(t) + .011, z: pz, sx: .022, sy: .006, sz: w - .16, yaw, pitch, color: '#5e4a36' });
      }
    }
    // Railings only over the water, a little way onto each bank: the same
    // railings units cannot pass through (game/terrain railings()).
    const rail = railings(bridge), r0 = rail.from / L, r1 = rail.to / L;
    for (const s of [-1, 1]) {
      along(0, 1, s * (w / 2 + .03), -.1, .22, .07, trim);
      const o = s * (w / 2 - .03);
      for (const h of [.11, .22]) along(r0, r1, o, h, .045, .05, trim);
      const posts = Math.max(2, Math.round(L * (r1 - r0) / .45));
      for (let k = 0; k <= posts; k++) {
        const t = r0 + (r1 - r0) * k / posts, [px, pz] = at(t), end = k === 0 || k === posts;
        boxes.push({ x: px - dz * o, y: top(t) + (end ? .15 : .12), z: pz + dx * o,
          sx: end ? .1 : .06, sy: end ? .3 : .24, sz: end ? .1 : .06, yaw, color: trim });
      }
    }
    // Abutments where the banks meet the water, piers on longer spans. They
    // run along the river (parallel to its banks), so a skewed bridge reads
    // as built for the river rather than as a slab dropped across it.
    const supports = [bridge.tin, bridge.tout];
    const wet = L * (bridge.tout - bridge.tin);
    for (let k = 1, n = Math.floor(wet / 1.6); k < n; k++) supports.push(bridge.tin + (bridge.tout - bridge.tin) * k / n);
    let flow = bridge.flow ? [bridge.flow[0], bridge.flow[1]] : [-dz, dx];
    // Very oblique supports would be absurdly long: cap the skew at 55 degrees.
    const sinSkew = Math.abs(flow[0] * dz - flow[1] * dx);
    if (sinSkew < .57) flow = [-dz, dx];
    const across = Math.abs(flow[0] * dz - flow[1] * dx) || 1;
    const supportYaw = -Math.atan2(flow[1], flow[0]);
    supports.forEach((t, k) => {
      const [px, pz] = at(t), bed = groundHeightAt(terrain, px, pz), h = Math.max(.1, top(t) - .12 - bed);
      const abutment = k < 2;
      boxes.push({ x: px, y: bed + h / 2, z: pz, sx: (w * (abutment ? 1.08 : .9)) / across, sy: h, sz: abutment ? .3 : .16, yaw: supportYaw,
        color: bridge.paved ? '#7f7c75' : '#5e4a36' });
    });
  }
  return boxes;
}
