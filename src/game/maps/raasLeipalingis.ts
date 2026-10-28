import { MissionDef, Position } from '../types';
import { CELL_SIZE } from '../constants';
import { SETTLEMENTS, SettlementId } from './settlements';
import { MAIN_CELLS } from './geography';
import { makeRaasMission, pickChain, RaasChain, RaasObjectiveDef } from '../raas';

/**
 * Authored RAAS objective chains for the designed Leipalingis map. Each chain
 * runs from the north main to the south main and is its own mirror image, so
 * both sides face the same route. Validated in src/test/leipalingis-raas.test.ts.
 */
const world = (x: number, y: number): Position => ({ x: (x + .5) * CELL_SIZE, y: (y + .5) * CELL_SIZE });
const RADIUS = { centre: 5, town: 7, village: 6, hamlet: 5 } as const; // cells

function place(id: SettlementId): RaasObjectiveDef {
  const s = SETTLEMENTS.find(t => t.id === id)!;
  return { id, name: s.name, pos: world(s.x, s.y), radius: RADIUS[s.size] * CELL_SIZE };
}
function sector(which: 'west' | 'centre' | 'east'): RaasObjectiveDef {
  const s = SETTLEMENTS.find(t => t.id === 'leipalingis')!;
  const dx = which === 'west' ? -20 : which === 'east' ? 20 : 0;
  const name = which === 'centre' ? 'Leipalingis centre' : `Leipalingis ${which}`;
  return { id: `leipalingis_${which}`, name, pos: world(s.x + dx, s.y), radius: RADIUS.centre * CELL_SIZE };
}
const chain = (id: string, name: string, ids: [SettlementId, SettlementId, 'west' | 'centre' | 'east', SettlementId, SettlementId]): RaasChain => ({
  id, name, objectives: [place(ids[0]), place(ids[1]), sector(ids[2]), place(ids[3]), place(ids[4])],
});

export const RAAS_CHAINS: RaasChain[] = [
  chain('west', 'West road', ['smarliunai', 'sadziunai', 'west', 'varnenai', 'barciai']),
  chain('east', 'East road', ['straciunai', 'guobiniai', 'east', 'versiai', 'snaigupe']),
  chain('centre', 'Route 180', ['jovaisiai', 'mazonys', 'centre', 'vilkanastrai', 'didziasalis']),
  chain('west_cross', 'Western woods', ['jovaisiai', 'sadziunai', 'west', 'varnenai', 'didziasalis']),
  chain('east_cross', 'Eastern lakes', ['jovaisiai', 'guobiniai', 'east', 'versiai', 'didziasalis']),
  chain('wide_east', 'Wide east', ['straciunai', 'mazonys', 'centre', 'vilkanastrai', 'snaigupe']),
];

export const RAAS_MAINS = {
  player: world(MAIN_CELLS.north[0], MAIN_CELLS.north[1]),
  enemy: world(MAIN_CELLS.south[0], MAIN_CELLS.south[1]),
};

/** A RAAS match on the Leipalingis map. The seed picks the chain (same seed, same chain). */
export function makeLeipalingisRaas(seed: number): MissionDef {
  const c = pickChain(RAAS_CHAINS, seed);
  return makeRaasMission({
    name: `RAAS · Leipalingis · ${c.name}`,
    mapLayout: 'leipalingis_region', mapSeed: 1917,
    chain: c, mains: RAAS_MAINS,
    composition: { infantry: 8, tank: 2, apc: 2 },
  });
}
