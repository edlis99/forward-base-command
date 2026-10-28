import { geography as snapshot, GEOGRAPHIC_SCALE_X, GEOGRAPHIC_SCALE_Y } from './geography';

export type SettlementId =
  | 'leipalingis' | 'seirijai' | 'straciunai' | 'jovaisiai' | 'varnenai' | 'snaigupe' | 'ricieliai' | 'smarliunai' | 'barciai'
  | 'viktarinas' | 'sadziunai' | 'guobiniai' | 'gailiunai' | 'senkonys' | 'mazonys' | 'barzdziunai'
  | 'didziasalis' | 'vilkanastrai' | 'versiai' | 'kaziuliai';
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
// Real places of the Leipalingis area (positions from the map data). Two large
// towns anchor the middle: Leipalingis and Seirijai (added on route 180).
const definitions: Settlement[] = [
  town('leipalingis', 'Leipalingis', 'centre', 'church', 'Town · church square · brick centre, wooden outskirts', '#c9c4af', '#786653'),
  town('seirijai', 'Seirijai', 'centre', 'church', 'Lakeside town on route 180 · market square · ring street', '#d2c8b0', '#8a4f3c'),
  town('straciunai', 'Stračiūnai', 'town', 'workshop', 'Street village · depot yards', '#cbc3a0', '#6f7772'),
  town('jovaisiai', 'Jovaišiai', 'town', 'civic', 'Village on route 180 · courtyards', '#bcaf94', '#8f5340'),
  town('varnenai', 'Varnėnai', 'town', 'barn', 'Farm village · barns and orchards', '#b3a98f', '#7d5844'),
  town('snaigupe', 'Snaigupė', 'town', 'workshop', 'Street village · workshops', '#c2bba0', '#745044'),
  town('ricieliai', 'Ricieliai', 'town', 'civic', 'Village by the eastern woods', '#c0b89b', '#6d5a4b'),
  town('smarliunai', 'Smarliūnai', 'town', 'barn', 'Farm village · lake to the north', '#c4bb9e', '#7a5a46'),
  town('barciai', 'Barčiai', 'town', 'civic', 'Western village · school', '#bfb79c', '#6f6a5e'),
  town('viktarinas', 'Viktarinas', 'town', 'barn', 'Southern farm village', '#b9ae92', '#6b5242'),
  town('sadziunai', 'Šadžiūnai', 'village', 'barn', 'Road village · woods to the east', '#ada58d', '#68625a'),
  town('guobiniai', 'Guobiniai', 'village', 'civic', 'Road village · lake country', '#a0a78b', '#745044'),
  town('gailiunai', 'Gailiūnai', 'village', 'barn', 'Farm village by the eastern lakes', '#b6ad93', '#7c5b46'),
  town('senkonys', 'Senkonys', 'village', 'barn', 'Farm village south of Varnėnai', '#aea78f', '#6a6258'),
  town('mazonys', 'Mažonys', 'village', 'barn', 'Village between Jovaišiai and the river', '#b8ae94', '#7a5c48'),
  town('barzdziunai', 'Barzdžiūnai', 'village', 'workshop', 'Village north of Stračiūnai', '#b4ab90', '#6e6658'),
  town('didziasalis', 'Didžiasalis', 'hamlet', 'barn', 'Hamlet on the southern lakes', '#a69f88', '#616c6c'),
  town('vilkanastrai', 'Vilkanastrai', 'hamlet', 'barn', 'Hamlet south of Leipalingis', '#aea78f', '#6a6258'),
  town('versiai', 'Veršiai', 'hamlet', 'civic', 'Hamlet east of Leipalingis', '#a0a78b', '#745044'),
  town('kaziuliai', 'Kaziuliai', 'hamlet', 'barn', 'Hamlet in the south-east', '#b0a68c', '#6c5a4a'),
];
export const SETTLEMENTS = definitions.map(s => ({ ...s, rx: s.rx * GEOGRAPHIC_SCALE_X, ry: s.ry * GEOGRAPHIC_SCALE_Y }));
export function settlementAt(x: number, y: number): Settlement | undefined {
  return SETTLEMENTS.find(s => ((x - s.x) / s.rx) ** 2 + ((y - s.y) / s.ry) ** 2 <= 1);
}
