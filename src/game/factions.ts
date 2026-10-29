import type { Team, UnitType } from './types';

export type FactionId = 'aster' | 'vostran';
export interface FactionDef {
  id: FactionId;
  name: string;
  shortName: string;
  emblem: string;
  inspiration: string;
  description: string;
  uniform: string;
  armor: string;
  kit: string;
  units: Record<UnitType, string>;
}

/** Factions change presentation only. Both use the same UNIT_STATS and RAAS rules. */
export const FACTIONS: Record<FactionId, FactionDef> = {
  aster: {
    id: 'aster', name: 'Aster Defence Coalition', shortName: 'ASTER', emblem: '✦',
    inspiration: 'Western equipment',
    description: 'A professional expeditionary coalition. Woodland uniforms, angular armour and wheeled troop carriers.',
    uniform: '#526347', armor: '#58644a', kit: '#343e31',
    units: { infantry: 'Ranger', tank: 'Bastion MBT', apc: 'Lynx APC', helicopter: 'Kestrel' },
  },
  vostran: {
    id: 'vostran', name: 'Vostran Union', shortName: 'VOSTRAN', emblem: '◆',
    inspiration: 'Eastern equipment',
    description: 'A continental mechanised force. Olive field kit, compact tank turrets and low-profile eight-wheel carriers.',
    uniform: '#77744e', armor: '#73714f', kit: '#464833',
    units: { infantry: 'Motor Rifle', tank: 'Volk MBT', apc: 'Bars APC', helicopter: 'Korshun' },
  },
};

export const FACTION_IDS: FactionId[] = ['aster', 'vostran'];
export function opposingFaction(id: FactionId): FactionId { return id === 'aster' ? 'vostran' : 'aster'; }
export function factionPair(player: FactionId = 'aster'): Record<Team, FactionId> {
  return { player, enemy: opposingFaction(player) };
}

/** Default also supports older saved states and lightweight test fixtures. */
export function factionFor(state: { factions?: Record<Team, FactionId> }, team: Team): FactionDef {
  return FACTIONS[state.factions?.[team] ?? (team === 'player' ? 'aster' : 'vostran')];
}
