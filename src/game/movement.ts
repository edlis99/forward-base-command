import { GameState, Unit } from './types';
import { deckUnder, getTerrainAt } from './terrain';

/** Actual attainable ground speed, before steering and arrival easing. */
export function availableSpeed(unit: Unit, state: GameState): number {
  if (unit.prone && unit.suppression > .5) return 0;
  const cell = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  // A deck may reach over the river beside its own cells: on it the ground is the bridge, not the water.
  const onDeck = unit.type !== 'helicopter' && !!cell && (cell.type === 'water' || !!cell.bridge) && !!deckUnder(state.terrain, unit.pos.x, unit.pos.y);
  const terrainFactor = unit.type === 'helicopter' || !cell || onDeck ? 1 : cell.traction / cell.movementCost;
  return unit.speed * terrainFactor * (1 - unit.suppression * .5) * (.7 + unit.morale * .3) * (1 - unit.fatigue * .4);
}
/**
 * Speed a unit keeps on the march: its pace on good ground, without the
 * terrain under it, momentary suppression or fatigue (which builds up within
 * seconds in mud). Coordinated groups are paced by their members' march
 * speeds, so one tank bogged in mud no longer slows the whole group at that
 * instant: the cohesion rule holds back the units ahead of it and the rest
 * close up at full pace. A pinned soldier still holds the group.
 */
export function marchSpeed(unit: Unit): number {
  if (unit.prone && unit.suppression > .5) return 0;
  return unit.speed * (.7 + unit.morale * .3);
}
export function routeRemaining(unit: Unit): number {
  if (!unit.targetPos) return 0;
  let last = unit.targetPos, length = Math.hypot(last.x - unit.pos.x, last.y - unit.pos.y);
  for (const p of unit.path) { length += Math.hypot(p.x - last.x, p.y - last.y); last = p; }
  return length;
}
