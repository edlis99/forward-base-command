import { random } from './rng';
import { GameState, Unit, Position } from './types';
import { distance, setDestination } from './units';
import { hasLineOfSight, getTerrainAt } from './terrain';
import { isVisibleTo } from './awareness';
import { CELL_SIZE } from './constants';
import { findBestTacticalCell, cellTacticalScore } from './tactical';

function canEngage(unit: Unit, target: Unit, state: GameState): boolean {
  if (distance(unit.pos, target.pos) > unit.range) return false;
  if (!isVisibleTo(target, unit.team)) return false;
  return hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, target.pos.x, target.pos.y, unit.type === 'helicopter');
}

function findNearestCover(state: GameState, unit: Unit, near?: Position, minScore = 0.25): Position | null {
  const veh = unit.type === 'tank' || unit.type === 'apc';
  const heli = unit.type === 'helicopter';
  return findBestTacticalCell(state, unit.pos, {
    radius: 10, isVehicle: veh, isHelicopter: heli,
    losTo: near ?? null, minScore,
  });
}

/** Cover cell within `radius` that retains LOS to target and is in range. */
function pickCoverFiringPosition(state: GameState, unit: Unit, target: Unit, radius = 5): Position | null {
  const veh = unit.type === 'tank' || unit.type === 'apc';
  const heli = unit.type === 'helicopter';
  const candidate = findBestTacticalCell(state, unit.pos, {
    radius, isVehicle: veh, isHelicopter: heli,
    losTo: target.pos, minScore: 0.2,
  });
  if (!candidate) return null;
  if (Math.hypot(candidate.x - target.pos.x, candidate.y - target.pos.y) > unit.range) return null;
  return candidate;
}

/** Flanking approach: perpendicular offset toward better cover near target. */
function flankApproach(unit: Unit, target: Unit, state: GameState): Position {
  const dx = target.pos.x - unit.pos.x;
  const dy = target.pos.y - unit.pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const sign = (unit.id.charCodeAt(unit.id.length - 1) % 2) === 0 ? 1 : -1;
  const px = -dy / len * sign;
  const py = dx / len * sign;
  const veh = unit.type === 'tank' || unit.type === 'apc';
  const standoff = veh ? unit.range * 0.8 : unit.range * 0.85;
  const baseX = target.pos.x - (dx / len) * standoff;
  const baseY = target.pos.y - (dy / len) * standoff;
  const flankAmt = CELL_SIZE * 3 + random(state) * CELL_SIZE * 2;
  const candidate = { x: baseX + px * flankAmt, y: baseY + py * flankAmt };
  // Snap to best tactical cell near the candidate that still sees the target.
  const cover = findBestTacticalCell(state, candidate, {
    radius: 4, isVehicle: veh, isHelicopter: unit.type === 'helicopter',
    losTo: target.pos, minScore: 0.18,
  });
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
    if (u.coverSeekCooldown > 0) u.coverSeekCooldown = Math.max(0, u.coverSeekCooldown - dt);
    // prone if suppressed; recover when calm
    // Only foot soldiers dive for the dirt; armour and aircraft stay mobile under small-arms fire.
    if (u.suppression > 0.55) u.prone = u.type === 'infantry';
    else if (u.suppression < 0.2) {
      const terrain = getTerrainAt(state.terrain, u.pos.x, u.pos.y);
      // Keep infantry in a low firing posture while they occupy a trench.
      u.prone = u.type === 'infantry' && terrain?.type === 'trench';
    }
  }

  // Enemy ambushes may open fire together. Player hold-fire orders stay in force.
  for (const u of state.units) {
    if (!u.alive || u.insideOf || u.team === 'player' || u.stance !== 'hold_fire' || u.ambushReady) continue;
    const enemies = state.units.filter(e => e.alive && e.team !== u.team && !e.insideOf);
    for (const e of enemies) {
      if (!isVisibleTo(e, u.team)) continue;
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
  if (unit.reactionTarget !== (closest?.id ?? null)) {
    unit.reactionTarget = closest?.id ?? null;
    unit.reactionDelay = closest ? 0.3 + random(state) * 0.5 : 0;
  }
  if (unit.reactionDelay > 0) return;

  // APC dismount if engaging close
  if (unit.type === 'apc' && unit.passengers.length > 0 && closest && closestDist < 250) {
    for (const pid of [...unit.passengers]) {
      const p = state.units.find(u => u.id === pid);
      if (p) {
        p.insideOf = null;
        p.pos = { x: unit.pos.x + (random(state) - 0.5) * 30, y: unit.pos.y + (random(state) - 0.5) * 30 };
      }
    }
    unit.passengers = [];
  }

  if (engageable) {
    // Leave target choice to combat (scored, with hysteresis); only seed one if none is held.
    if (!unit.attackTarget) unit.attackTarget = engageable.id;
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
    // Infantry cover-seek: if standing in poor cover, slide to nearby better cell that still has LOS.
    if (!veh && unit.coverSeekCooldown <= 0) {
      unit.coverSeekCooldown = 1.5 + random(state);
      const curCell = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
      const curScore = curCell ? cellTacticalScore(curCell) : 0;
      const tag = unit as Unit & { _squadRole?: string };
      // Support role: higher threshold (always seek strongest cover)
      const threshold = tag._squadRole === 'support' ? 0.45 : 0.25;
      if (curScore < threshold) {
        const spot = pickCoverFiringPosition(state, unit, engageable, tag._squadRole === 'support' ? 7 : 5);
        if (spot) {
          setDestination(unit, state, spot);
          unit.order = 'attack_move';
          return;
        }
      }
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
    // Squad-coordinated approach: prefer squad rally / focus over solo flank
    const tag = unit as Unit & { _squadRally?: Position | null; _squadFocus?: string | null; _squadRole?: string };
    const focus = tag._squadFocus ? state.units.find(u => u.id === tag._squadFocus && u.alive) ?? closest : closest;
    if (tag._squadRally && tag._squadRole === 'regroup') return; // squad controller already issued retreat move
    if (!unit.targetPos || distance(unit.targetPos, focus.pos) > 120) {
      const dest = tag._squadRally ?? flankApproach(unit, focus, state);
      setDestination(unit, state, dest);
      unit.order = 'attack_move';
    }
  }
}
