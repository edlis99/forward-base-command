import { MissionDef, Position } from '../types';
import { CELL_SIZE } from '../constants';
import { SETTLEMENTS, SettlementId } from './settlements';
import { MAIN_CELLS } from './geography';
import { makeRaasMission, pickChain, RaasChain, RaasObjectiveDef } from '../raas';

/**
 * RAAS lanes for the Leipalingis map. The map is real-world based and not
 * mirrored, so lanes were chosen by measurement: for every candidate lane the
 * travel time from the west main to each west-side objective was compared with
 * the east main's time to the matching east-side objective, and the middle
 * objective had to be about equally far from both mains. Only lanes within
 * those limits are listed. src/test/leipalingis-raas.test.ts re-checks them.
 */
const world = (x: number, y: number): Position => ({ x: (x + .5) * CELL_SIZE, y: (y + .5) * CELL_SIZE });
const RADIUS = { centre: 5.5, town: 7, village: 6, hamlet: 5 } as const; // cells

/** Sectors of the two large towns, offset (cells) to where their buildings stand. */
const SECTORS = {
  leipalingis: { west: [-12, 0], centre: [-3, 0], east: [11, 0] },
  seirijai: { west: [-12, 0], centre: [1, 1], east: [12, 0] },
} as const;
type Big = keyof typeof SECTORS;
type ObjectiveId = SettlementId | `${Big}_${'west' | 'centre' | 'east'}`;

function objective(id: ObjectiveId): RaasObjectiveDef {
  const m = /^(leipalingis|seirijai)_(west|centre|east)$/.exec(id);
  if (m) {
    const s = SETTLEMENTS.find(t => t.id === m[1])!;
    const [dx, dy] = SECTORS[m[1] as Big][m[2] as 'west' | 'centre' | 'east'];
    return { id, name: `${s.name} ${m[2]}`, pos: world(s.x + dx, s.y + dy), radius: RADIUS.centre * CELL_SIZE };
  }
  const s = SETTLEMENTS.find(t => t.id === id)!;
  return { id, name: s.name, pos: world(s.x, s.y), radius: RADIUS[s.size] * CELL_SIZE };
}

/** West main -> ... -> east main. Measured-balanced (see the comment above). */
export const RAAS_LANES: ObjectiveId[][] = [
  ['smarliunai', 'jovaisiai', 'seirijai_west', 'mazonys', 'barzdziunai'],
  ['smarliunai', 'jovaisiai', 'seirijai_centre', 'mazonys', 'barzdziunai'],
  ['smarliunai', 'jovaisiai', 'seirijai_west', 'mazonys', 'vilkanastrai'],
  ['sadziunai', 'smarliunai', 'seirijai_west', 'barzdziunai', 'versiai'],
  ['smarliunai', 'jovaisiai', 'seirijai_centre', 'mazonys', 'vilkanastrai'],
  ['sadziunai', 'smarliunai', 'seirijai_centre', 'barzdziunai', 'versiai'],
  ['varnenai', 'smarliunai', 'seirijai_west', 'barzdziunai', 'versiai'],
  ['varnenai', 'smarliunai', 'seirijai_centre', 'barzdziunai', 'versiai'],
  ['sadziunai', 'smarliunai', 'leipalingis_centre', 'vilkanastrai', 'versiai'],
  ['varnenai', 'smarliunai', 'leipalingis_centre', 'vilkanastrai', 'versiai'],
];

export const RAAS_CHAINS: RaasChain[] = RAAS_LANES.map(ids => {
  const objectives = ids.map(objective);
  return { id: ids.join('-'), name: `${objectives[0].name} · ${objectives[2].name} · ${objectives[4].name}`, objectives };
});

/** Player deploys at the west main, the AI / opponent at the east main. */
export const RAAS_MAINS = {
  player: world(MAIN_CELLS.north[0], MAIN_CELLS.north[1]),
  enemy: world(MAIN_CELLS.south[0], MAIN_CELLS.south[1]),
};

/** A RAAS match on the Leipalingis map. The seed picks the lane (same seed, same lane). */
export function makeLeipalingisRaas(seed: number): MissionDef {
  const c = pickChain(RAAS_CHAINS, seed);
  return makeRaasMission({
    name: `RAAS · Leipalingis · ${c.name}`,
    mapLayout: 'leipalingis_region', mapSeed: 1917,
    chain: c, mains: RAAS_MAINS,
    composition: { infantry: 8, tank: 2, apc: 2 },
  });
}
