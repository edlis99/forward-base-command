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
/** South-side twin of each north-side place (mirror across the centre line). */
const MIRROR: Partial<Record<SettlementId, SettlementId>> = {
  smarliunai: 'barciai', straciunai: 'snaigupe', jovaisiai: 'didziasalis', sadziunai: 'varnenai', guobiniai: 'versiai', mazonys: 'vilkanastrai',
};
const FIRST: SettlementId[] = ['smarliunai', 'jovaisiai', 'straciunai'];
const SECOND: SettlementId[] = ['sadziunai', 'jovaisiai', 'mazonys', 'guobiniai'];
const SECTORS = ['west', 'centre', 'east'] as const;
const LEG = { min: 30, max: 170 }; // cells between consecutive objectives

const cellsBetween = (a: RaasObjectiveDef, b: RaasObjectiveDef) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) / CELL_SIZE;

/**
 * Every lane that zig-zags sensibly: north end -> second point -> a
 * Leipalingis sector -> the mirror of the second -> the mirror of the end.
 * Crossing between the west, centre and east of the map is allowed, so the
 * route is hard to guess; each lane is still its own mirror image.
 */
export const RAAS_CHAINS: RaasChain[] = FIRST.flatMap(a => SECOND.filter(b => b !== a).flatMap(b => SECTORS.map(c => {
  const objectives = [place(a), place(b), sector(c), place(MIRROR[b]!), place(MIRROR[a]!)];
  return { id: `${a}-${b}-${c}`, name: `${objectives[0].name} · ${objectives[1].name} · ${objectives[2].name}`, objectives };
}))).filter(c => c.objectives.every((o, i) => i === 0 || (cellsBetween(c.objectives[i - 1], o) >= LEG.min && cellsBetween(c.objectives[i - 1], o) <= LEG.max)));

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
