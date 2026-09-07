import { Unit, UnitType, Team, Position, GameState, Stance } from './types';
import { UNIT_STATS, CELL_SIZE, VETERANCY_THRESHOLDS, VETERANCY_BONUSES, MOVING_ACC_PENALTY, STATIONARY_ACC_BONUS } from './constants';
import { getTerrainAt, hasLineOfSight, losInfo, isPassable, isFootprintPassable, findNearestPassableWorld } from './terrain';
import { findPath } from './pathfinding';
import { isVisibleTo } from './awareness';
import { getUnitGrid, queryNeighbors } from './spatialGrid';
import { spacingRadius, getSquad, cohesionSpeedFactor, ARRIVE_TOLERANCE } from './playerSquads';

let nextId = 1;

export function createUnit(type: UnitType, team: Team, x: number, y: number): Unit {
  const stats = UNIT_STATS[type];
  return {
    id: `unit_${nextId++}`,
    type, team,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    targetPos: null,
    path: [],
    waypoints: [],
    attackTarget: null,
    health: stats.maxHealth, maxHealth: stats.maxHealth,
    speed: stats.speed, range: stats.range, damage: stats.damage, armor: stats.armor,
    sightRange: stats.sightRange,
    attackCooldown: stats.attackCooldown, attackTimer: 0,
    reloadTimer: 0, ammo: stats.ammo, maxAmmo: stats.ammo,
    suppression: 0, alive: true, selected: false, inCover: false,
    accuracy: stats.accuracy, critChance: stats.critChance,
    morale: 1.0,
    facing: team === 'player' ? 0 : Math.PI,
    turnRate: stats.turnRate,
    kills: 0, veterancy: 0,
    stance: 'defend', order: 'idle',
    homePos: { x, y },
    fatigue: 0, stuckTimer: 0, lastDamageTime: -999,
    passengers: [], insideOf: null,
    boardTarget: null, groupSpeedCap: null, moveGroupId: null,
    squadId: null, settled: false,
    finalDest: null, lastProgressDist: Infinity, lastProgressTime: 0,
    reactionDelay: 0, prone: false, ambushReady: false, rallyUntil: 0,
    digTimer: 0, coverSeekCooldown: 0, lastAllyDeathTime: -999,
    spottedByEnemy: false, detectionLevel: 0,
    lastKnownPos: null, lastKnownTime: -999,
  };
}

export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function angleBetween(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function getFlankingBonus(attacker: Unit, target: Unit): number {
  const attackAngle = angleBetween(attacker.pos, target.pos);
  const facingDiff = Math.abs(normalizeAngle(attackAngle - target.facing));
  if (facingDiff > Math.PI * 0.67) return 0.4;
  if (facingDiff > Math.PI * 0.33) return 0.2;
  return 0;
}

export function checkVeterancy(unit: Unit): string | null {
  const newLevel = VETERANCY_THRESHOLDS.findIndex((threshold, i) =>
    i === VETERANCY_THRESHOLDS.length - 1 || unit.kills < VETERANCY_THRESHOLDS[i + 1]
  );
  if (newLevel > unit.veterancy) {
    unit.veterancy = newLevel;
    const bonus = VETERANCY_BONUSES[newLevel];
    unit.accuracy = Math.min(0.95, UNIT_STATS[unit.type].accuracy * bonus);
    unit.damage = UNIT_STATS[unit.type].damage * bonus;
    if (unit.team === 'player') {
      return `${unit.type} promoted to ${['Rookie', 'Regular', 'Veteran', 'Elite'][newLevel]}`;
    }
  }
  return null;
}

function isVehicle(u: Unit) { return u.type === 'tank' || u.type === 'apc'; }

/** Set destination using A* pathfinding. Stores `finalDest` for re-paths. */
export function setDestination(unit: Unit, state: GameState, dest: Position) {
  const vehicle = isVehicle(unit);
  const helicopter = unit.type === 'helicopter';
  const reachableDest = findNearestPassableWorld(state.terrain, dest.x, dest.y, vehicle, helicopter, 12);
  unit.finalDest = { ...reachableDest };
  const path = findPath(state.terrain, unit.pos, reachableDest, unit.type);
  if (path.length === 0) {
    unit.targetPos = null;
    unit.path = [];
    unit.finalDest = null;
    unit.groupSpeedCap = null;
    unit.moveGroupId = null;
    return;
  }
  unit.path = path;
  unit.targetPos = path[0];
  unit.lastProgressDist = distance(unit.pos, unit.targetPos);
  unit.lastProgressTime = state.time;
}

/** Local avoidance via spatial grid: keeps per-type personal spacing. */
function separation(unit: Unit, state: GameState): { x: number; y: number } {
  let sx = 0, sy = 0;
  const radius = spacingRadius(unit) * 2;
  const grid = getUnitGrid(state);
  for (const o of queryNeighbors(grid, unit.pos.x, unit.pos.y, radius, unit)) {
    if (!o.alive || o.team !== unit.team || o.insideOf) continue;
    if ((o.type === 'helicopter') !== (unit.type === 'helicopter')) continue;
    const min = spacingRadius(unit) + spacingRadius(o);
    const dx = unit.pos.x - o.pos.x;
    const dy = unit.pos.y - o.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < min) {
      const w = (min - d) / min;
      sx += (dx / d) * w;
      sy += (dy / d) * w;
    }
  }
  const len = Math.hypot(sx, sy);
  if (len > 1.5) { sx = (sx / len) * 1.5; sy = (sy / len) * 1.5; }
  return { x: sx, y: sy };
}

export function moveUnit(unit: Unit, dt: number, state: GameState) {
  if (!unit.alive) return;
  if (unit.insideOf) return;

  // Refresh cover even while idle/holding. Previously this only happened at
  // the end of active movement, so a unit that finished digging never gained
  // the trench's armor benefit.
  const occupiedTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  unit.inCover = unit.type === 'infantry' && (occupiedTerrain?.coverBonus ?? 0) > 0;

  // Entrenching: stay still, accrue dig progress
  if (unit.order === 'entrench') {
    unit.vel.x *= 0.6; unit.vel.y *= 0.6;
    unit.targetPos = null; unit.path = []; unit.finalDest = null;
    return;
  }

  // Suppressed/pinned units don't move
  if (unit.prone && unit.suppression > 0.5) {
    unit.vel.x *= 0.7; unit.vel.y *= 0.7;
    return;
  }

  // Pop user waypoint when current target reached
  if (!unit.targetPos) {
    if (unit.path.length > 0) {
      const nextPathPoint = unit.path.shift();
      if (nextPathPoint) unit.targetPos = nextPathPoint;
      unit.lastProgressDist = distance(unit.pos, unit.targetPos);
      unit.lastProgressTime = state.time;
    } else if (unit.waypoints.length > 0) {
      const next = unit.waypoints.shift();
      if (next) setDestination(unit, state, next);
      if (!unit.targetPos) return;
    } else {
      unit.vel.x *= 0.85; unit.vel.y *= 0.85;
      unit.fatigue = Math.max(0, unit.fatigue - dt * 0.15);
      return;
    }
  }

  if (!unit.targetPos) return;

  const veh = isVehicle(unit);
  const heli = unit.type === 'helicopter';
  const popRadius = unit.path.length > 0
    ? (veh ? CELL_SIZE * 0.9 : CELL_SIZE * 0.6)
    : (veh ? 14 : 8);

  const distToTarget = distance(unit.pos, unit.targetPos);
  // Pop intermediate path waypoint
  if (distToTarget < popRadius) {
    if (unit.path.length > 0) {
      const nextPathPoint = unit.path.shift();
      if (nextPathPoint) unit.targetPos = nextPathPoint;
      unit.lastProgressDist = distance(unit.pos, unit.targetPos);
      unit.lastProgressTime = state.time;
    } else {
      unit.targetPos = null;
      unit.finalDest = null;
      if (unit.waypoints.length === 0 && unit.order !== 'hold_position' && unit.order !== 'patrol') {
        unit.order = 'idle';
        unit.groupSpeedCap = null;
        unit.moveGroupId = null;
      }
      unit.vel.x *= 0.4; unit.vel.y *= 0.4;
      return;
    }
  }

  const terrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);

  const dx = unit.targetPos.x - unit.pos.x;
  const dy = unit.targetPos.y - unit.pos.y;
  const dlen = Math.hypot(dx, dy) || 1;
  const dirX = dx / dlen, dirY = dy / dlen;

  // separation as small positional nudge, weaker close to final dest
  const sep = separation(unit, state);
  const finalDist = unit.finalDest ? distance(unit.pos, unit.finalDest) : 999;
  const sepWeight = finalDist < CELL_SIZE * 1.2 ? 0.05 : 0.25;

  const desiredAngle = Math.atan2(dirY + sep.y * sepWeight, dirX + sep.x * sepWeight);

  const facingDelta = normalizeAngle(desiredAngle - unit.facing);
  const maxTurn = unit.turnRate * dt;
  if (Math.abs(facingDelta) > maxTurn) unit.facing += Math.sign(facingDelta) * maxTurn;
  else unit.facing = desiredAngle;

  const alignment = Math.cos(facingDelta);
  const alignFactor = veh ? Math.max(0.15, alignment) : (alignment > 0 ? 1 : 0.6);

  const moveCost = terrain ? terrain.movementCost : 1;
  const traction = terrain ? terrain.traction : 1;
  const effectiveCost = heli ? 1 : moveCost;
  const suppressionPenalty = 1 - unit.suppression * 0.5;
  const moralePenalty = 0.7 + unit.morale * 0.3;
  const fatiguePenalty = 1 - unit.fatigue * 0.4;
  const baseSpeed = unit.groupSpeedCap != null ? Math.min(unit.speed, unit.groupSpeedCap) : unit.speed;
  const squad = getSquad(state, unit);
  const cohesionFactor = squad ? cohesionSpeedFactor(unit, squad) : 1;
  // Arrival easing: ramp down over the last stretch so units settle in slot
  // instead of overshooting and circling.
  const remaining = unit.finalDest ? distance(unit.pos, unit.finalDest) : 999;
  const arrivalFactor = unit.path.length === 0 && remaining < ARRIVE_TOLERANCE * 3
    ? Math.max(0.35, remaining / (ARRIVE_TOLERANCE * 3))
    : 1;
  const speed = (baseSpeed / effectiveCost) * suppressionPenalty * moralePenalty * fatiguePenalty * traction * alignFactor * cohesionFactor * arrivalFactor;


  // Infantry can sidestep and should track the route directly. Driving them by
  // facing caused wide arcs that clipped obstacles and repeatedly rebuilt A*.
  const travelX = veh ? Math.cos(unit.facing) : dirX;
  const travelY = veh ? Math.sin(unit.facing) : dirY;
  const targetVx = travelX * speed;
  const targetVy = travelY * speed;
  const accel = veh ? 5 : 11;
  unit.vel.x += (targetVx - unit.vel.x) * Math.min(1, accel * dt);
  unit.vel.y += (targetVy - unit.vel.y) * Math.min(1, accel * dt);

  const nextX = unit.pos.x + unit.vel.x * dt;
  const nextY = unit.pos.y + unit.vel.y * dt;
  const nextT = getTerrainAt(state.terrain, nextX, nextY);
  const ngx = Math.floor(nextX / CELL_SIZE), ngy = Math.floor(nextY / CELL_SIZE);
  const stepOk = heli || (veh
    ? isFootprintPassable(state.terrain, ngx, ngy, true, false, 1)
    : isPassable(nextT, false, false));
  if (stepOk) {
    unit.pos.x = nextX; unit.pos.y = nextY;
    unit.stuckTimer = 0;
    if (!heli && nextT && (nextT.type === 'tall_grass' || (nextT.type === 'forest' && veh))) {
      nextT.trampled = true;
    }
  } else {
    // Try a lateral slide before giving up: walking along a wall/hedge edge is
    // what a real squad does instead of stalling and rebuilding the whole route.
    const perpX = -unit.vel.y, perpY = unit.vel.x;
    const plen = Math.hypot(perpX, perpY) || 1;
    let slid = false;
    for (const sign of [1, -1]) {
      const sx = unit.pos.x + (perpX / plen) * speed * dt * sign;
      const sy = unit.pos.y + (perpY / plen) * speed * dt * sign;
      const sgx = Math.floor(sx / CELL_SIZE), sgy = Math.floor(sy / CELL_SIZE);
      const ok = veh
        ? isFootprintPassable(state.terrain, sgx, sgy, true, false, 1)
        : isPassable(getTerrainAt(state.terrain, sx, sy), false, false);
      if (ok) {
        unit.pos.x = sx; unit.pos.y = sy;
        unit.vel.x = (perpX / plen) * speed * sign * 0.6;
        unit.vel.y = (perpY / plen) * speed * sign * 0.6;
        slid = true;
        break;
      }
    }
    if (!slid) { unit.vel.x = 0; unit.vel.y = 0; }
    unit.stuckTimer += dt;
    if (unit.stuckTimer > 0.45) {
      // Recover from terrain changes or an invalid edge before rebuilding.
      const recovered = findNearestPassableWorld(state.terrain, unit.pos.x, unit.pos.y, veh, heli, 4);
      unit.pos.x = recovered.x; unit.pos.y = recovered.y;
      const dest = unit.finalDest ?? unit.targetPos;
      if (dest) setDestination(unit, state, dest);
      unit.stuckTimer = 0;
    }
  }


  // No-progress detector: if dist to target hasn't shrunk in ~0.7s, re-path to final dest.
  if (state.time - unit.lastProgressTime > 0.7) {
    const newDist = distance(unit.pos, unit.targetPos);
    if (newDist + 2 >= unit.lastProgressDist) {
      const dest = unit.finalDest ?? unit.targetPos;
      if (dest) setDestination(unit, state, dest);
    } else {
      unit.lastProgressDist = newDist;
      unit.lastProgressTime = state.time;
    }
  }

  const fatigueGain = (terrain ? terrain.fatigueRate : 1) * (heli ? 0.05 : veh ? 0.08 : 0.12) * dt;
  unit.fatigue = Math.min(1, unit.fatigue + fatigueGain);

  const cur = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  unit.inCover = cur ? cur.coverBonus > 0 : false;
}

function speedMagnitude(unit: Unit) { return Math.hypot(unit.vel.x, unit.vel.y); }

export function updateCombat(unit: Unit, dt: number, state: GameState): { killMsg: string | null; killedTeam: Team | null } {
  if (!unit.alive || unit.insideOf) return { killMsg: null, killedTeam: null };

  unit.attackTimer = Math.max(0, unit.attackTimer - dt);
  unit.reloadTimer = Math.max(0, unit.reloadTimer - dt);
  unit.suppression = Math.max(0, unit.suppression - dt * 0.18);
  unit.morale = Math.min(1, unit.morale + dt * 0.05);
  if (unit.ammo <= 0 && unit.reloadTimer <= 0) unit.ammo = unit.maxAmmo;

  // Engagement rules
  // hold_fire: never shoots
  // tight: only return fire (must have been damaged recently and ordered attack)
  // defend/aggressive: auto-acquire
  const canAcquire =
    unit.stance === 'aggressive' || unit.stance === 'defend' ||
    (unit.stance === 'tight' && state.time - unit.lastDamageTime < 5);
  if (unit.stance === 'hold_fire') return { killMsg: null, killedTeam: null };

  const enemies = state.units.filter(u => u.alive && u.team !== unit.team && !u.insideOf);

  let target: Unit | undefined;
  if (unit.attackTarget) {
    target = enemies.find(e => e.id === unit.attackTarget);
    if (!target) unit.attackTarget = null;
  }

  if (!target && canAcquire) {
    let closest = Infinity;
    for (const enemy of enemies) {
      // Engagement requires the enemy to be visible to our team (awareness gate)
      if (!isVisibleTo(enemy, unit.team)) continue;
      const dist = distance(unit.pos, enemy.pos);
      if (dist <= unit.range && dist <= unit.sightRange && dist < closest) {
        if (hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, enemy.pos.x, enemy.pos.y, unit.type === 'helicopter')) {
          closest = dist;
          target = enemy;
        }
      }
    }
  }

  if (target) {
    const desired = angleBetween(unit.pos, target.pos);
    const delta = normalizeAngle(desired - unit.facing);
    const maxTurn = unit.turnRate * dt;
    const activelyMoving = unit.targetPos != null && (unit.order === 'move' || unit.order === 'attack_move' || unit.order === 'retreat');
    if (!activelyMoving) {
      if (Math.abs(delta) > maxTurn) unit.facing += Math.sign(delta) * maxTurn;
      else unit.facing = desired;
    }

    // Only abandon current path if unit was idle/holding/patrolling — never override a player order.
    if ((unit.order === 'hold_position' || unit.order === 'idle' || unit.order === 'patrol')
        && (unit.stance === 'defend' || unit.stance === 'aggressive')) {
      unit.targetPos = null; unit.path = []; unit.finalDest = null;
    }
  }

  if (!target || unit.attackTimer > 0 || unit.reloadTimer > 0 || unit.ammo <= 0) {
    if (target && unit.ammo <= 0 && unit.reloadTimer <= 0) {
      unit.reloadTimer = UNIT_STATS[unit.type].reloadTime;
    }
    return { killMsg: null, killedTeam: null };
  }

  const targDist = distance(unit.pos, target.pos);
  if (targDist > unit.range) return { killMsg: null, killedTeam: null };

  const losData = losInfo(state.terrain, unit.pos.x, unit.pos.y, target.pos.x, target.pos.y, unit.type === 'helicopter');
  if (!losData.clear) return { killMsg: null, killedTeam: null };

  const aimDiff = Math.abs(normalizeAngle(angleBetween(unit.pos, target.pos) - unit.facing));
  const aimCone = isVehicle(unit) ? 0.45 : 0.8;
  if (aimDiff > aimCone) return { killMsg: null, killedTeam: null };

  const vetBonus = VETERANCY_BONUSES[unit.veterancy];
  const suppressionAccPenalty = 1 - unit.suppression * 0.4;
  const moraleAccBonus = 0.8 + unit.morale * 0.2;
  const distancePenalty = 1 - (targDist / unit.range) * 0.3;
  const speedMag = speedMagnitude(unit);
  const movingFactor = speedMag > 5
    ? MOVING_ACC_PENALTY + (1 - MOVING_ACC_PENALTY) * Math.max(0, 1 - speedMag / unit.speed)
    : STATIONARY_ACC_BONUS;
  const concealmentPenalty = 1 / (1 + losData.concealmentSum * 0.6);

  const attackerTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  const targetTerrain = getTerrainAt(state.terrain, target.pos.x, target.pos.y);
  const targetEntrenched = target.type === 'infantry' && targetTerrain?.type === 'trench';
  let positionBonus = 1.0;
  if (attackerTerrain) {
    if (attackerTerrain.type === 'trench' && unit.type === 'infantry') positionBonus = 1.18;
    else if (attackerTerrain.type === 'sandbag') positionBonus = 1.1;
    else if (attackerTerrain.type === 'urban') positionBonus = 1.05;
  }
  let coverPenalty = 1.0;
  if (targetTerrain) {
    if (targetEntrenched) coverPenalty = 0.42;
    else if (targetTerrain.type === 'sandbag') coverPenalty = 0.7;
    else if (targetTerrain.type === 'urban') coverPenalty = 0.7;
    else if (targetTerrain.type === 'rubble' || targetTerrain.type === 'crater') coverPenalty = 0.78;
    else if (targetTerrain.type === 'forest' || targetTerrain.type === 'hedgerow') coverPenalty = 0.7;
    else if (targetTerrain.type === 'tall_grass' && target.type === 'infantry') coverPenalty = 0.85;
  }
  let hitChance = unit.accuracy * suppressionAccPenalty * moraleAccBonus * distancePenalty * vetBonus *
                  positionBonus * coverPenalty * movingFactor * concealmentPenalty;
  const flankBonus = getFlankingBonus(unit, target);
  hitChance = Math.min(0.95, hitChance + flankBonus * 0.1);

  unit.ammo -= 1;
  const isHit = Math.random() <= hitChance;
  const isCrit = isHit && Math.random() < unit.critChance * (1 + flankBonus);
  const projTarget = isHit
    ? { ...target.pos }
    : { x: target.pos.x + (Math.random() - 0.5) * 30, y: target.pos.y + (Math.random() - 0.5) * 30 };

  state.projectiles.push({
    from: { ...unit.pos }, to: projTarget,
    timer: unit.type === 'tank' ? 0.4 : 0.2,
    hit: isHit, crit: isCrit, team: unit.team,
  });
  unit.attackTimer = unit.attackCooldown;
  if (unit.ammo <= 0) unit.reloadTimer = UNIT_STATS[unit.type].reloadTime;

  if (!isHit) {
    const suppressionGain = targetEntrenched ? 0.025 : 0.08;
    target.suppression = Math.min(1, target.suppression + suppressionGain);
    return { killMsg: null, killedTeam: null };
  }

  let dmg = unit.damage * vetBonus;
  if (isCrit) dmg *= 1.8;
  dmg *= 1 + flankBonus;
  const elevDiff = (attackerTerrain?.elevation ?? 1) - (targetTerrain?.elevation ?? 1);
  if (elevDiff > 0) dmg *= 1.15;
  if (elevDiff < 0) dmg *= 0.9;
  const coverBonus = target.inCover ? targetTerrain?.coverBonus ?? 0 : 0;
  const effectiveArmor = target.armor * (1 + coverBonus);
  dmg = Math.max(dmg * (1 - effectiveArmor / (effectiveArmor + 50)), 1);
  if (unit.type === 'infantry' && target.type === 'infantry') dmg *= 1.2;
  if (unit.type === 'tank' && (target.type === 'tank' || target.type === 'apc')) dmg *= 1.3;
  if (unit.type === 'helicopter') dmg *= 1.1;
  if (target.type === 'helicopter' && unit.type === 'infantry') dmg *= 0.5;
  if (targetEntrenched) dmg *= 0.42;
  if (targetTerrain?.type === 'sandbag') dmg *= 0.75;
  if (targetTerrain?.type === 'crater') dmg *= 0.7;

  target.health -= dmg;
  target.lastDamageTime = state.time;
  target.suppression = Math.min(1, target.suppression + (targetEntrenched ? 0.1 : 0.3));
  for (const ally of state.units) {
    if (ally.alive && ally.team === target.team && ally.id !== target.id) {
      const allyDist = distance(ally.pos, target.pos);
      if (allyDist < 100) ally.morale = Math.max(0.2, ally.morale - 0.05);
    }
  }
  if (target.alive && !target.attackTarget && target.stance !== 'hold_fire') {
    target.attackTarget = unit.id;
  }

  if (target.health <= 0) {
    target.alive = false;
    unit.kills++;
    if (target.passengers.length > 0) {
      for (const pid of target.passengers) {
        const p = state.units.find(u => u.id === pid);
        if (p) {
          p.insideOf = null;
          p.pos = { x: target.pos.x + (Math.random() - 0.5) * 20, y: target.pos.y + (Math.random() - 0.5) * 20 };
          p.health *= 0.6;
        }
      }
      target.passengers = [];
    }
    for (const ally of state.units) {
      if (ally.alive && ally.team === target.team) {
        const allyDist = distance(ally.pos, target.pos);
        if (allyDist < 150) ally.morale = Math.max(0.1, ally.morale - 0.15);
      }
    }
    state.explosions.push({ pos: { ...target.pos }, radius: 24, timer: 0.6, maxTimer: 0.6 });
    state.wreckage.push({ pos: { ...target.pos }, type: target.type, timer: 90, team: target.team });
    const critText = isCrit ? ' (CRIT)' : '';
    return {
      killMsg: `${unit.team === 'player' ? 'Friendly' : 'Enemy'} ${unit.type} killed ${target.team} ${target.type}${critText}`,
      killedTeam: target.team,
    };
  }
  return { killMsg: null, killedTeam: null };
}

export function getUnitsInRect(units: Unit[], x1: number, y1: number, x2: number, y2: number, team: Team): Unit[] {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return units.filter(u => u.alive && u.team === team && u.pos.x >= minX && u.pos.x <= maxX && u.pos.y >= minY && u.pos.y <= maxY);
}
