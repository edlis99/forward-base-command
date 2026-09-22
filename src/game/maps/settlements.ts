import { geography as snapshot, GEOGRAPHIC_SCALE_X, GEOGRAPHIC_SCALE_Y } from './geography';
import { DeploymentTownId } from '../types';

export type SettlementId = 'leipalingis' | Exclude<DeploymentTownId, 'seirijai'>;
export interface Settlement {
  id: SettlementId; name: string; x: number; y: number; rx: number; ry: number;
  character: string; landmark: 'church' | 'barn' | 'civic' | 'workshop';
  wall: string; roof: string;
}
function centre(name: string) {
  const p = snapshot.places.find(p => p.name === name)!;
  return { x: Math.round(p.point[0]), y: Math.round(p.point[1]) };
}
// Tactical settlement extents, not surveyed administrative boundaries. These
// definitions drive generation, deployment, world labels and the in-game map.
const definitions: Settlement[] = [
  { id: 'leipalingis', name: 'Leipalingis', ...centre('Leipalingis'), rx: 11, ry: 8,
    character: 'Town centre · church square · converging streets', landmark: 'church', wall: '#c9c4af', roof: '#786653' },
  { id: 'jovaisiai', name: 'Jovaišiai', ...centre('Jovaišiai'), rx: 6.5, ry: 5,
    character: 'Compact village · courtyards · orchard edge', landmark: 'civic', wall: '#bcaf94', roof: '#8f5340' },
  { id: 'didziasalis', name: 'Didžiasalis', ...centre('Didžiasalis'), rx: 7, ry: 5.5,
    character: 'Farm village · barns · southern approach', landmark: 'barn', wall: '#a69f88', roof: '#616c6c' },
  { id: 'versiai', name: 'Veršiai', ...centre('Veršiai'), rx: 5.5, ry: 4.5,
    character: 'Lakeside approach · small yards · woodland edge', landmark: 'workshop', wall: '#a0a78b', roof: '#745044' },
  { id: 'straciunai', name: 'Stračiūnai', ...centre('Stračiūnai'), rx: 8, ry: 5,
    character: 'Street village · long frontage · eastern approach', landmark: 'civic', wall: '#cbc3a0', roof: '#6f7772' },
];
export const SETTLEMENTS = definitions.map(s => ({ ...s, rx: s.rx * GEOGRAPHIC_SCALE_X, ry: s.ry * GEOGRAPHIC_SCALE_Y }));
export function settlementAt(x: number, y: number): Settlement | undefined {
  return SETTLEMENTS.find(s => ((x - s.x) / s.rx) ** 2 + ((y - s.y) / s.ry) ** 2 <= 1);
}
