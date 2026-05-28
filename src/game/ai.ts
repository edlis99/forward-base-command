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

function findNearestCover(state: GameState, unit: Unit, near?: Position): Position | null {
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
      if (cell.coverBonus >= 0.25) {
        const pos = { x: tx * CELL_SIZE + CELL_SIZE / 2, y: ty * CELL_SIZE + CELL_SIZE / 2 };
        let d = Math.abs(dx) + Math.abs(dy);
        if (near) d += distance(pos, near) * 0.01;
        if (!best || d < best.d) best = { d, pos };
      }
    }
  }
  return best?.pos ?? null;
}

/**
 * Per-unit AI for enemy and idle friendly units (friendlies still respect player orders).
 * Per-unit behavior is driven by stance + orders set by mission script.
 */
export function updateAI(state: GameState, dt: number) {
  for (const u of state.units) {
    if (!u.alive || u.insideOf) continue;
    // Friendlies follow player orders; AI only nudges idle/holding ones to acquire targets via combat code.
    if (u.team === 'player') continue;

    runEnemyBehavior(u, state, dt);
  }
}

function runEnemyBehavior(unit: Unit, state: GameState, dt: number) {
  const enemies = state.units.filter(u => u.alive && u.team !== unit.team && !u.insideOf);
  if (enemies.length === 0) return;

  // Find nearest visible
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

  // Retreat at low morale/health
  if ((unit.health / unit.maxHealth < 0.25 || unit.morale < 0.3) && unit.order !== 'retreat') {
    const cover = findNearestCover(state, unit);
    if (cover) { setDestination(unit, state, cover); unit.order = 'retreat'; unit.attackTarget = null; return; }
  }

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
    if (unit.stance === 'defend' && unit.order !== 'patrol') {
      unit.targetPos = null; unit.path = [];
    }
    return;
  }

  // No engageable: move toward closest threat or stay on patrol/hold
  if (unit.order === 'patrol' && unit.patrolPoints && unit.patrolPoints.length > 0) {
    if (!unit.targetPos && unit.path.length === 0) {
      const idx = (unit.patrolIndex ?? 0) % unit.patrolPoints.length;
      setDestination(unit, state, unit.patrolPoints[idx]);
      unit.patrolIndex = idx + 1;
    }
    return;
  }
  if (unit.order === 'hold_position') return;

  if (closest && (!unit.targetPos || distance(unit.targetPos, closest.pos) > 80)) {
    // Move with some cover-seeking bias
    const cover = findNearestCover(state, unit, closest.pos);
    const dest = cover && distance(cover, closest.pos) < unit.range * 1.1 ? cover : closest.pos;
    setDestination(unit, state, { x: dest.x, y: dest.y });
    unit.order = 'attack_move';
  }
}
