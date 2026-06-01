import { GameState, Unit, Position } from './types';
import { distance, setDestination, angleBetween } from './units';
import { hasLineOfSight, getTerrainAt, isPassable } from './terrain';
import { isVisibleTo } from './awareness';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from './constants';

function canEngage(unit: Unit, target: Unit, state: GameState): boolean {
  if (distance(unit.pos, target.pos) > unit.range) return false;
  if (!isVisibleTo(target, unit.team)) return false;
  return hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, target.pos.x, target.pos.y, unit.type === 'helicopter');
}

function findNearestCover(state: GameState, unit: Unit, near?: Position, minBonus = 0.25): Position | null {
  const gx = Math.floor(unit.pos.x / CELL_SIZE);
  const gy = Math.floor(unit.pos.y / CELL_SIZE);
  const veh = unit.type === 'tank' || unit.type === 'apc';
  const heli = unit.type === 'helicopter';
  let best: { d: number; pos: Position } | null = null;
  const R = 10;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const tx = gx + dx, ty = gy + dy;
      if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) continue;
      const cell = state.terrain[ty][tx];
      if (!isPassable(cell, veh, heli)) continue;
      if ((cell.coverBonus + cell.concealment * 0.5) >= minBonus) {
        const pos = { x: tx * CELL_SIZE + CELL_SIZE / 2, y: ty * CELL_SIZE + CELL_SIZE / 2 };
        let d = Math.abs(dx) + Math.abs(dy);
        if (near) d += distance(pos, near) * 0.01;
        if (!best || d < best.d) best = { d, pos };
      }
    }
  }
  return best?.pos ?? null;
}

/** Compute a flanking approach: perpendicular offset toward better cover near target. */
function flankApproach(unit: Unit, target: Unit, state: GameState): Position {
  const dx = target.pos.x - unit.pos.x;
  const dy = target.pos.y - unit.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  // perpendicular direction (random sign per-unit, stable via id hash)
  const sign = (unit.id.charCodeAt(unit.id.length - 1) % 2) === 0 ? 1 : -1;
  const px = -dy / len * sign;
  const py = dx / len * sign;
  // standoff distance for vehicles
  const veh = unit.type === 'tank' || unit.type === 'apc';
  const standoff = veh ? unit.range * 0.8 : unit.range * 0.85;
  const baseX = target.pos.x - (dx / len) * standoff;
  const baseY = target.pos.y - (dy / len) * standoff;
  // flank offset
  const flankAmt = CELL_SIZE * 3 + Math.random() * CELL_SIZE * 2;
  const candidate = { x: baseX + px * flankAmt, y: baseY + py * flankAmt };
  // Snap to cover if available
  const cover = findNearestCover(state, { ...unit, pos: candidate } as Unit, target.pos, 0.2);
  return cover ?? candidate;
}

/**
 * Per-unit AI. Friendlies follow player orders; passive auto-engage handled in combat.
 * Enemies behave with cover-seeking, flanking, suppression-aware pinning, and ambush triggers.
 */
export function updateAI(state: GameState, dt: number) {
  // Tick reaction delays and rally timers for everyone
  for (const u of state.units) {
    if (!u.alive) continue;
    if (u.reactionDelay > 0) u.reactionDelay = Math.max(0, u.reactionDelay - dt);
    // prone if suppressed; recover when calm
    if (u.suppression > 0.55) u.prone = true;
    else if (u.suppression < 0.2) u.prone = false;
  }

  // Hold-fire ambush trigger: any hold_fire unit with an engageable target + nearby ally LOS,
  // switches to aggressive momentarily (coordinated first volley).
  for (const u of state.units) {
    if (!u.alive || u.stance !== 'hold_fire' || u.ambushReady) continue;
    const enemies = state.units.filter(e => e.alive && e.team !== u.team && !e.insideOf);
    for (const e of enemies) {
      const d = distance(u.pos, e.pos);
      if (d > u.range) continue;
      if (!hasLineOfSight(state.terrain, u.pos.x, u.pos.y, e.pos.x, e.pos.y, u.type === 'helicopter')) continue;
      // confirm an ally within 200 also has LOS (coordination)
      const allyHasLOS = state.units.some(a => a.alive && a.team === u.team && a.id !== u.id &&
        distance(a.pos, u.pos) < 220 &&
        hasLineOfSight(state.terrain, a.pos.x, a.pos.y, e.pos.x, e.pos.y, a.type === 'helicopter'));
      if (allyHasLOS) {
        u.stance = 'aggressive';
        u.ambushReady = true;
        u.attackTarget = e.id;
        state.eventLog.unshift({ message: `${u.team} ${u.type}: ambush triggered`, time: state.time, type: 'contact' });
        break;
      }
    }
  }

  for (const u of state.units) {
    if (!u.alive || u.insideOf) continue;
    if (u.team === 'player') continue;
    runEnemyBehavior(u, state, dt);
  }
}

function runEnemyBehavior(unit: Unit, state: GameState, dt: number) {
  // Pinned by suppression: do not move, only fire from cover
  if (unit.prone && unit.suppression > 0.5) {
    unit.targetPos = null;
    return;
  }

  // Rally / break
  if ((unit.health / unit.maxHealth < 0.3 || unit.morale < 0.25) && state.time > unit.rallyUntil) {
    if (unit.order !== 'retreat') {
      const cover = findNearestCover(state, unit, unit.homePos, 0.3);
      if (cover) {
        setDestination(unit, state, cover);
        unit.order = 'retreat';
        unit.attackTarget = null;
        unit.rallyUntil = state.time + 8;
        return;
      }
    }
  }
  if (unit.order === 'retreat' && state.time < unit.rallyUntil) {
    // still recovering — slow morale recover
    unit.morale = Math.min(1, unit.morale + dt * 0.04);
    return;
  }
  if (unit.order === 'retreat' && state.time >= unit.rallyUntil) {
    unit.order = 'idle';
  }

  const enemies = state.units.filter(u => u.alive && u.team !== unit.team && !u.insideOf);
  if (enemies.length === 0) return;

  // Find nearest visible / engageable
  let closest: Unit | null = null;
  let closestDist = Infinity;
  let engageable: Unit | null = null;
  let engageableDist = Infinity;
  for (const e of enemies) {
    if (!isVisibleTo(e, unit.team)) continue;
    const d = distance(unit.pos, e.pos);
    if (d < closestDist) { closest = e; closestDist = d; }
    if (canEngage(unit, e, state) && d < engageableDist) { engageableDist = d; engageable = e; }
  }

  // Apply reaction delay on first contact
  if (closest && unit.attackTarget !== closest.id && unit.reactionDelay <= 0) {
    unit.reactionDelay = 0.3 + Math.random() * 0.5;
  }
  if (unit.reactionDelay > 0) return;

  // APC dismount if engaging close
  if (unit.type === 'apc' && unit.passengers.length > 0 && closest && closestDist < 250) {
    for (const pid of [...unit.passengers]) {
      const p = state.units.find(u => u.id === pid);
      if (p) {
        p.insideOf = null;
        p.pos = { x: unit.pos.x + (Math.random() - 0.5) * 30, y: unit.pos.y + (Math.random() - 0.5) * 30 };
      }
    }
    unit.passengers = [];
  }

  if (engageable) {
    unit.attackTarget = engageable.id;
    // Vehicles maintain standoff — back up if too close
    const veh = unit.type === 'tank' || unit.type === 'apc';
    if (veh && engageableDist < unit.range * 0.55) {
      const dx = unit.pos.x - engageable.pos.x;
      const dy = unit.pos.y - engageable.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      const dest = { x: unit.pos.x + (dx / len) * unit.range * 0.4, y: unit.pos.y + (dy / len) * unit.range * 0.4 };
      setDestination(unit, state, dest);
      unit.order = 'attack_move';
      return;
    }
    if (unit.stance === 'defend' && unit.order !== 'patrol') {
      unit.targetPos = null; unit.path = []; unit.finalDest = null;
    }
    return;
  }

  // No engageable: patrol / hold / advance via flank
  if (unit.order === 'patrol' && unit.patrolPoints && unit.patrolPoints.length > 0) {
    if (!unit.targetPos && unit.path.length === 0) {
      const idx = (unit.patrolIndex ?? 0) % unit.patrolPoints.length;
      setDestination(unit, state, unit.patrolPoints[idx]);
      unit.patrolIndex = idx + 1;
    }
    return;
  }
  if (unit.order === 'hold_position') {
    // Stay home; if drifted, return
    const d = distance(unit.pos, unit.homePos);
    if (d > 60 && !unit.targetPos) setDestination(unit, state, unit.homePos);
    return;
  }

  if (closest) {
    // Flanking approach with cover preference, instead of straight-line charge
    if (!unit.targetPos || distance(unit.targetPos, closest.pos) > 100) {
      const dest = flankApproach(unit, closest, state);
      setDestination(unit, state, dest);
      unit.order = 'attack_move';
    }
  }
}
