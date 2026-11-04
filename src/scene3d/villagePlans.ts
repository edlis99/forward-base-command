import { TerrainCell } from '../game/types';
import { hash2 } from './terrainHeight';

/**
 * Metres to map cells. A cell is about 16 m: the tank model is 0.5 cell long
 * (about 9 m with its gun) and 0.16 cell (2.5 m) tall. Village buildings,
 * yards and cover props are modelled in metres at real size, so a cottage
 * ridge stands about three tank heights tall and a hay bale is shoulder high.
 */
export const METRE = 1 / 16;

/** Plans (metres) of the two kinds of house whose chimneys smoke (see Ambience). */
export function cottagePlan(x: number, z: number) {
  return { W: 6.4 + hash2(x, z + 13) * 1.2, D: 9.4 + hash2(x + 11, z) * 1.8, zc: -2.4, P: .55, E: 2.55 + hash2(x + 29, z + 7) * .35, pitch: .8 };
}
export function brickPlan(x: number, z: number) {
  return { W: 8.2 + hash2(x, z + 13) * .8, D: 9.0 + hash2(x + 11, z) * 1.2, zc: -2.3, P: .7, E: 3.5, pitch: .7, hip: hash2(x + 29, z + 7) > .62, hipRise: 3.2 };
}
/** Ridge height of a pitched roof over a span (as built by `pitched`: 10 cm of roof over the attic). */
const ridgeHeight = (eave: number, span: number, pitch: number) => eave + span / 2 * Math.tan(pitch) + .1;
/** A house's chimney in its cell's local frame (metres) and the height of its top, or null. */
export function chimneyOf(cell: TerrainCell, x: number, z: number): { lx: number; lz: number; top: number } | null {
  if (cell.type !== 'urban') return null;
  if ((cell.buildingKind ?? 'house') === 'house') {
    const p = cottagePlan(x, z);
    return { lx: .35, lz: p.zc - .4, top: ridgeHeight(p.P + p.E, p.W, p.pitch) + .75 };
  }
  if (cell.buildingKind === 'brick') {
    const p = brickPlan(x, z);
    return { lx: -p.W * .18, lz: p.zc - .6, top: (p.hip ? p.P + p.E + p.hipRise : ridgeHeight(p.P + p.E, p.W, p.pitch)) + .7 };
  }
  return null;
}
