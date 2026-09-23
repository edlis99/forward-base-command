import { GameState, Unit } from './types';
import { getTerrainAt } from './terrain';

/** Actual attainable ground speed, before steering and arrival easing. */
export function availableSpeed(unit: Unit, state: GameState): number {
  if (unit.prone && unit.suppression > .5) return 0;
  const cell = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  const terrainFactor = unit.type === 'helicopter' || !cell ? 1 : cell.traction / cell.movementCost;
  return unit.speed * terrainFactor * (1 - unit.suppression * .5) * (.7 + unit.morale * .3) * (1 - unit.fatigue * .4);
}
export function routeRemaining(unit: Unit): number {
  if (!unit.targetPos) return 0;
  let last = unit.targetPos, length = Math.hypot(last.x - unit.pos.x, last.y - unit.pos.y);
  for (const p of unit.path) { length += Math.hypot(p.x - last.x, p.y - last.y); last = p; }
  return length;
}
