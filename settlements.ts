import { geography as snapshot, GEOGRAPHIC_SCALE_X, GEOGRAPHIC_SCALE_Y } from './geography';

export type SettlementId =
  | 'leipalingis' | 'jovaisiai' | 'didziasalis' | 'versiai' | 'straciunai'
  | 'smarliunai' | 'barciai' | 'snaigupe' | 'sadziunai' | 'varnenai' | 'guobiniai' | 'mazonys' | 'vilkanastrai';
export type SettlementSize = 'centre' | 'town' | 'village' | 'hamlet';
export interface Settlement {
  id: SettlementId; name: string; x: number; y: number; rx: number; ry: number;
  size: SettlementSize;
  character: string; landmark: 'church' | 'barn' | 'civic' | 'workshop';
  wall: string; roof: string;
}
function centre(name: string) {
  const p = snapshot.places.find(p => p.name === name)!;
  return { x: Math.round(p.point[0]), y: Math.round(p.point[1]) };
}
const R: Record<SettlementSize, [number, number]> = { centre: [11, 9], town: [7.5, 5.5], village: [6, 4.5], hamlet: [4, 3.5] };
const town = (id: SettlementId, name: string, size: SettlementSize, landmark: Settlement['landmark'], character: string, wall: string, roof: string): Settlement =>
  ({ id, name, ...centre(name), rx: R[size][0], ry: R[size][1], size, landmark, character, wall, roof });
// Tactical settlement extents on the designed map. Mirror pairs (north <-> south)
// share size and landmark so neither side gets a better town.
const definitions: Settlement[] = [
  town('leipalingis', 'Leipalingis', 'centre', 'church', 'Town centre · church square · two crescent streets', '#c9c4af', '#786653'),
  town('smarliunai', 'Smarliūnai', 'town', 'civic', 'North-west town · ring street · lake to the north', '#c4bb9e', '#7a5a46'),
  town('barciai', 'Barčiai', 'town', 'civic', 'South-west town · ring street · lake to the south', '#bfb79c', '#6f6a5e'),
  town('straciunai', 'Stračiūnai', 'town', 'workshop', 'North-east town · street village · depot yards', '#cbc3a0', '#6f7772'),
  town('snaigupe', 'Snaigupė', 'town', 'workshop', 'South-east town · street village · depot yards', '#c2bba0', '#745044'),
  town('jovaisiai', 'Jovaišiai', 'village', 'civic', 'Compact village on route 180 · courtyards', '#bcaf94', '#8f5340'),
  town('didziasalis', 'Didžiasalis', 'village', 'barn', 'Farm village on route 180 · barns', '#a69f88', '#616c6c'),
  town('sadziunai', 'Šadžiūnai', 'village', 'barn', 'Western road village · woods to the east', '#b3a98f', '#7d5844'),
  town('varnenai', 'Varnėnai', 'village', 'barn', 'Western road village · woods to the east', '#ada58d', '#68625a'),
  town('guobiniai', 'Guobiniai', 'village', 'civic', 'Eastern road village · lake country', '#c0b89b', '#6d5a4b'),
  town('versiai', 'Veršiai', 'village', 'civic', 'Eastern road village · lake country', '#a0a78b', '#745044'),
  town('mazonys', 'Mažonys', 'hamlet', 'barn', 'Hamlet between Jovaišiai and the east road', '#b6ad93', '#7c5b46'),
  town('vilkanastrai', 'Vilkanastrai', 'hamlet', 'barn', 'Hamlet between Didžiasalis and the east road', '#aea78f', '#6a6258'),
];
export const SETTLEMENTS = definitions.map(s => ({ ...s, rx: s.rx * GEOGRAPHIC_SCALE_X, ry: s.ry * GEOGRAPHIC_SCALE_Y }));
export function settlementAt(x: number, y: number): Settlement | undefined {
  return SETTLEMENTS.find(s => ((x - s.x) / s.rx) ** 2 + ((y - s.y) / s.ry) ** 2 <= 1);
}
