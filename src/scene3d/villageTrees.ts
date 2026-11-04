import type { TerrainCell } from '../game/types';
import type { TreePlacement } from './VolumetricTrees';
import { groundHeightAt, hash2 } from './terrainHeight';
import { METRE } from './villagePlans';

const TAU = Math.PI * 2;

/**
 * Village trees, at real size: fruit trees in orchards and gardens (4-6 m),
 * and old birches, limes and maples beside farmhouses and work yards
 * (11-17 m). Positions use each cell's local frame as the buildings do
 * (Environment.tsx): x along the frontage, +z towards the street, metres.
 */
export function villageTrees(terrain: TerrainCell[][], x: number, z: number, out: TreePlacement[]) {
  const cell = terrain[z][x];
  if (!cell.yard && cell.type !== 'urban') return;
  const angle = cell.propAngle ?? 0, cos = Math.cos(angle), sin = Math.sin(angle);
  const off = cell.type === 'urban' ? cell.buildingOffset : undefined;
  const cx = x + .5 + (off?.[0] ?? 0), cz = z + .5 + (off?.[1] ?? 0);
  const r = (salt: number) => hash2(x + salt * 13, z + salt * 7);
  const plant = (lx: number, lz: number, species: TreePlacement['species'], heightM: number, widthRatio: number, salt: number) => {
    const wx = cx + (cos * lx - sin * lz) * METRE, wz = cz + (sin * lx + cos * lz) * METRE;
    const at = terrain[Math.floor(wz)]?.[Math.floor(wx)];
    // Only on this cell or open ground beside it: never on a street, in water or in another yard.
    if (!at || (at !== cell && (!(at.type === 'open' || at.type === 'tall_grass') || at.yard || at.prop || at.roadName))) return;
    const size = heightM * METRE;
    out.push({ x: wx, z: wz, y: groundHeightAt(terrain, wx, wz) + .004, size, width: size * widthRatio,
      yaw: r(salt) * TAU, rank: r(salt + 1), species });
  };
  const shade = (lx: number, lz: number, salt: number) => {
    const k = r(salt + 2);
    if (k < .4) plant(lx, lz, 'birch', 13 + r(salt + 3) * 4, .62, salt);
    else if (k < .75) plant(lx, lz, 'oak', 12 + r(salt + 3) * 4, .9, salt);
    else plant(lx, lz, 'alder', 11 + r(salt + 3) * 3, .82, salt);
  };
  const fruit = (lx: number, lz: number, salt: number) =>
    plant(lx + (r(salt + 4) - .5) * .9, lz + (r(salt + 5) - .5) * .9, 'apple', 4.2 + r(salt + 6) * 1.6, .9 + r(salt + 7) * .2, salt);
  if (cell.yard === 'orchard') {
    // Two loose rows of fruit trees; the beehives stand in front of them.
    [[-4.8, -5.2], [0, -5.4], [4.8, -5.0], [-2.4, -.3], [2.5, -.1]].forEach(([lx, lz], i) => {
      if (i < 4 || r(20) > .3) fruit(lx, lz, 30 + i * 9);
    });
  } else if (cell.yard === 'garden') {
    // A fruit tree or a birch in the back corner away from the granary.
    if (r(40) < .45) {
      if (r(41) < .6) fruit(-5.6, -6.4, 42);
      else shade(-5.8, -6.6, 42);
    }
  } else if (cell.yard === 'courtyard') {
    if (r(50) < .5) shade(5.4, -5.2, 51);
  } else if (cell.buildingKind === 'house' || cell.buildingKind === 'brick') {
    // An old tree beside the farmhouse, in the front garden or behind it.
    if (r(60) < (cell.buildingKind === 'house' ? .32 : .2)) shade(-6.4, r(61) < .5 ? 3.8 : -6.8, 62);
  }
}
