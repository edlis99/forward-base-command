import { GameState } from './types';
import { distance } from './units';

/** Seconds for an uncontested point to swing from one side's ownership to the other's. */
export const CAPTURE_SECONDS = 60;
export const OWNER_THRESHOLD = 0.9;

/**
 * Symmetric capture rules for head-to-head play: a side with units on a point
 * and no enemy there pushes it its way at the same rate as the other side
 * would. Progress runs -1 (enemy) .. +1 (player); contested points hold.
 */
export function updateCapturePoints(state: GameState, dt: number) {
  for (const cp of state.capturePoints) {
    let p = 0, e = 0;
    for (const u of state.units) {
      if (!u.alive || u.insideOf || distance(u.pos, cp.pos) >= cp.radius) continue;
      if (u.team === 'player') p++; else e++;
    }
    const step = dt * (2 / CAPTURE_SECONDS);
    if (p > 0 && e === 0) cp.progress = Math.min(1, cp.progress + step);
    else if (e > 0 && p === 0) cp.progress = Math.max(-1, cp.progress - step);
    cp.owner = cp.progress >= OWNER_THRESHOLD ? 'player' : cp.progress <= -OWNER_THRESHOLD ? 'enemy' : 'neutral';
  }
}
