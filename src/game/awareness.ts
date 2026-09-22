import { GameState, Unit, Team } from './types';
import { getTerrainAt, hasLineOfSight } from './terrain';
import { distance } from './units';

/**
 * Spotting model:
 *  detectionRate = baseRate * sightFactor * concealmentFactor * stanceFactor
 * Each tick, accumulate detectionLevel toward 1; decay when no LOS or distance > sight.
 * spottedByEnemy reflects whether any opposing unit currently sees this unit.
 */
export function updateAwareness(state: GameState, dt: number): string[] {
  const msgs: string[] = [];
  const aliveUnits = state.units.filter(u => u.alive && !u.insideOf);

  for (const target of aliveUnits) {
    const opponents = aliveUnits.filter(u => u.team !== target.team);

    let bestRate = 0;
    let bestSpotter: Unit | null = null;
    for (const sp of opponents) {
      const d = distance(sp.pos, target.pos);
      if (d > sp.sightRange) continue;
      const isHeli = sp.type === 'helicopter';
      if (!hasLineOfSight(state.terrain, sp.pos.x, sp.pos.y, target.pos.x, target.pos.y, isHeli)) continue;

      // base
      let rate = 1.0;
      // distance falloff
      rate *= 1 - (d / sp.sightRange) * 0.6;
      // helicopters spot better
      if (isHeli) rate *= 1.4;
      // target concealment from terrain
      const terr = getTerrainAt(state.terrain, target.pos.x, target.pos.y);
      if (terr) {
        if (target.type !== 'helicopter') rate *= terr.exposure ?? 1;
        rate *= 1 - Math.min(0.8, terr.concealment);
        if (terr.type === 'tall_grass' && target.type !== 'infantry') {
          // grass doesn't really hide vehicles
          rate *= 1.4;
        }
      }
      // target stance — hold-fire infantry harder to spot
      if (target.stance === 'hold_fire' && target.type === 'infantry') rate *= 0.5;
      // moving units easier to spot
      const speedMag = Math.hypot(target.vel.x, target.vel.y);
      if (speedMag > 5) rate *= 1.3;
      // recently fired (smoke/flash) — uses suppression as proxy actually attacker reveals
      if (target.attackTimer > target.attackCooldown - 0.4) rate *= 1.8;

      // detection multiplier (ambush mod)
      if (target.team === 'enemy') rate *= state.detectionMultiplier || 1;

      if (rate > bestRate) { bestRate = rate; bestSpotter = sp; }
    }

    if (bestRate > 0) {
      target.detectionLevel = Math.min(1, target.detectionLevel + bestRate * dt * 1.2);
      if (target.detectionLevel >= 0.7) {
        const wasSpotted = target.spottedByEnemy;
        target.spottedByEnemy = true;
        target.lastKnownPos = { ...target.pos };
        target.lastKnownTime = state.time;
        if (!wasSpotted && target.team === 'enemy') {
          msgs.push(`Contact: enemy ${target.type} ${compassDir(bestSpotter!.pos, target.pos)}`);
        }
      }
    } else {
      // fade
      target.detectionLevel = Math.max(0, target.detectionLevel - dt * 0.5);
      if (target.detectionLevel <= 0.2 && target.spottedByEnemy) {
        target.spottedByEnemy = false;
        if (target.team === 'enemy' && target.lastKnownPos) {
          state.ghostContacts.push({
            team: target.team,
            pos: { ...target.lastKnownPos },
            type: target.type,
            time: state.time,
          });
        }
      }
    }
  }

  // age ghost contacts
  state.ghostContacts = state.ghostContacts.filter(g => state.time - g.time < 15);
  return msgs;
}

function compassDir(from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const deg = ((a * 180) / Math.PI + 360) % 360;
  if (deg < 22.5 || deg >= 337.5) return 'E';
  if (deg < 67.5) return 'SE';
  if (deg < 112.5) return 'S';
  if (deg < 157.5) return 'SW';
  if (deg < 202.5) return 'W';
  if (deg < 247.5) return 'NW';
  if (deg < 292.5) return 'N';
  return 'NE';
}

/** Returns true if this enemy unit should be visible/engageable to the given team. */
export function isVisibleTo(unit: Unit, team: Team): boolean {
  if (unit.team === team) return true;
  return unit.spottedByEnemy && unit.detectionLevel > 0.3;
}
