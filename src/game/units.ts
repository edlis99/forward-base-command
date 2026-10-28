import { availableSpeed, routeRemaining } from './movement';
import { Unit, UnitType, Team, Position, GameState, Stance } from './types';
import { random } from './rng';
import { isHumanTeam } from './controllers';
import {
  UNIT_STATS, CELL_SIZE, VETERANCY_THRESHOLDS, VETERANCY_BONUSES, MOVING_ACC_PENALTY, STATIONARY_ACC_BONUS,
  RETARGET_INTERVAL, RETARGET_HYSTERESIS, MAX_ENGAGE_TIME, DISENGAGE_GRACE, CHASE_STANDOFF, TARGET_LOST_TIMEOUT,
  TARGET_THREAT, SUPPRESSION_RESIST, HEAVY_WEAPON_DAMAGE, SMALL_ARMS_VS_VEHICLE,
} from './constants';
import { getTerrainAt, hasLineOfSight, losInfo, isPassable, isWorldFootprintPassable, findNearestPassableWorld } from './terrain';
import { findPath } from './pathfinding';
import { isVisibleTo } from './awareness';
import { getUnitGrid, queryNeighbors } from './spatialGrid';
import { spacingRadius, getSquad, cohesionSpeedFactor, ARRIVE_TOLERANCE } from './playerSquads';

let nextId = 1;
/** Id counter control: a match owns its counter (state.nextUnitId) so ids never depend on other matches in the process. */
export function resetUnitIds(next = 1) { nextId = next; }
export function peekUnitId() { return nextId; }

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
    engaging: false, aiming: false, engageTime: 0, disengageUntil: 0, retargetTimer: 0,
    lastFireTime: -999, chaseGoal: null, targetLostTimer: 0, chaseRepathTimer: 0,
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
  const attackAngle = angleBetween(target.pos, attacker.pos);
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

/** Cancel deferred actions as well as movement when replacing a player order. */
export function clearUnitOrders(unit: Unit) {
  unit.targetPos = null;
  unit.path = [];
  unit.waypoints = [];
  unit.finalDest = null;
  unit.attackTarget = null;
  unit.boardTarget = null;
  unit.digOnArrive = false;
  unit.holdOnArrive = false;
  unit.coverTarget = undefined; unit.arrivalFacing = undefined; unit.waiting = undefined;
  unit.groupSpeedCap = null;
  unit.moveGroupId = null;
  unit.squadId = null;
  unit.settled = false;
  unit.vel = { x: 0, y: 0 };
  unit.engaging = false; unit.aiming = false; unit.engageTime = 0;
  unit.chaseGoal = null; unit.targetLostTimer = 0;
  unit.order = 'idle';
}

/** Set destination using A* pathfinding. Stores `finalDest` for re-paths. */
export function setDestination(unit: Unit, state: GameState, dest: Position, repath = false) {
  // A recovery path must not reset formation progress and strand the leaders.
  const fractionLeft = repath ? Math.min(1, routeRemaining(unit) / Math.max(1, unit.routeLength ?? 1)) : 1;
  if (!repath) { unit.coverTarget = undefined; unit.holdOnArrive = false; }
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
    unit.moveGroupId = null; unit.squadId = null;
    return;
  }
  unit.inCover = false;
  unit.path = path;
  unit.targetPos = unit.path.shift() ?? null;
  unit.routeLength = routeRemaining(unit) / Math.max(.01, fractionLeft);
  unit.lastProgressDist = distance(unit.pos, unit.targetPos);
  unit.lastProgressTime = state.time;
}

/** Local avoidance via spatial grid: keeps per-type personal spacing. */
function separation(unit: Unit, state: GameState): { x: number; y: number } {
  let sx = 0, sy = 0;
  const radius = Math.max(32, spacingRadius(unit) * 2);
  const grid = getUnitGrid(state);
  const to = unit.targetPos ?? unit.pos;
  const routeLength = Math.hypot(to.x - unit.pos.x, to.y - unit.pos.y) || 1;
  const forwardX = (to.x - unit.pos.x) / routeLength, forwardY = (to.y - unit.pos.y) / routeLength;
  for (const o of queryNeighbors(grid, unit.pos.x, unit.pos.y, radius, unit)) {
    if (!o.alive || o.team !== unit.team || o.insideOf || unit.boardTarget === o.id) continue;
    if ((o.type === 'helicopter') !== (unit.type === 'helicopter')) continue;
    const min = spacingRadius(unit) + spacingRadius(o);
    const dx = unit.pos.x - o.pos.x;
    const dy = unit.pos.y - o.pos.y;
    const d = Math.hypot(dx, dy);
    // Anticipate traffic before touching. Pass on the right when directly
    // opposed; otherwise choose the open side of the nearby friendly.
    const along = -dx * forwardX - dy * forwardY;
    const lateral = dx * forwardY - dy * forwardX;
    if (along > 0 && along < min + 18 && Math.abs(lateral) < min && d < min + 18) {
      const side = lateral > 2 ? -1 : 1;
      const strength = 1.6 * (1 - Math.abs(lateral) / min);
      sx += -forwardY * side * strength; sy += forwardX * side * strength;
    }
    if (d === 0) { const side = unit.id < o.id ? 1 : -1; sx += side; sy += side * .5; }
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
  unit.waiting = undefined;
  const occupiedTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  unit.inCover = unit.type === 'infantry' && (!unit.targetPos || unit.engaging) && (occupiedTerrain?.coverBonus ?? 0) > 0;

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

  // Attack-move: stand and fight instead of walking through the contact. The
  // destination and queued legs are kept, so the advance resumes by itself.
  if (unit.engaging && unit.targetPos) {
    unit.vel.x *= 0.5; unit.vel.y *= 0.5;
    unit.lastProgressTime = state.time;
    unit.stuckTimer = 0;
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
      if (getSquad(state, unit)?.coordinated) { unit.vel = { x: 0, y: 0 }; unit.waiting = 'formation'; return; }
      const next = unit.waypoints.shift();
      if (next) {
        setDestination(unit, state, next);
        unit.arrivalFacing = next.facing;
        unit.order = next.attackMove ? 'attack_move' : 'move';
        const sq = getSquad(state, unit);
        if (sq) { sq.slots[unit.id] = next; sq.state = 'moving'; }
      }
      if (!unit.targetPos) return;
    } else {
      unit.vel.x *= 0.85; unit.vel.y *= 0.85;
      unit.fatigue = Math.max(0, unit.fatigue - dt * 0.15);
      if (unit.arrivalFacing != null) {
        const turn = normalizeAngle(unit.arrivalFacing - unit.facing);
        unit.facing += Math.sign(turn) * Math.min(Math.abs(turn), unit.turnRate * dt);
      }
      return;
    }
  }

  if (!unit.targetPos) return;

  const veh = isVehicle(unit);
  const heli = unit.type === 'helicopter';
  const popRadius = unit.path.length > 0
    ? (veh ? 6 : 4)
    : (unit.holdOnArrive ? 2 : veh ? 14 : 8);

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
      unit.homePos = { ...unit.pos };
      if (unit.waypoints.length === 0 && unit.order !== 'hold_position' && unit.order !== 'patrol' && unit.order !== 'attack') {
        unit.order = unit.holdOnArrive ? 'hold_position' : 'idle';
        unit.holdOnArrive = false;
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
  const sepWeight = finalDist < CELL_SIZE * 1.2 ? 0.12 : 0.8;

  const desiredAngle = Math.atan2(dirY + sep.y * sepWeight, dirX + sep.x * sepWeight);

  const facingDelta = normalizeAngle(desiredAngle - unit.facing);
  const maxTurn = unit.turnRate * dt;
  // A soldier (or helicopter) with a target keeps facing it; only hulls must steer by heading.
  if (!(unit.aiming && !veh)) {
    if (Math.abs(facingDelta) > maxTurn) unit.facing += Math.sign(facingDelta) * maxTurn;
    else unit.facing = desiredAngle;
  }

  const alignment = Math.cos(facingDelta);
  const alignFactor = veh ? Math.max(0, alignment) ** 2 : (alignment > 0 ? 1 : 0.6);

  const squad = getSquad(state, unit);
  const cohesionFactor = squad ? cohesionSpeedFactor(unit, squad) : 1;
  const attainable = availableSpeed(unit, state);
  const pacedSpeed = unit.groupSpeedCap == null ? attainable : Math.min(attainable, unit.groupSpeedCap);
  if (cohesionFactor === 0 || (squad?.coordinated && pacedSpeed < .01)) {
    unit.waiting = 'formation'; unit.vel = { x: 0, y: 0 };
    unit.lastProgressTime = state.time; return;
  }
  // Arrival easing: ramp down over the last stretch so units settle in slot
  // instead of overshooting and circling.
  const remaining = unit.finalDest ? distance(unit.pos, unit.finalDest) : 999;
  const arrivalFactor = unit.path.length === 0 && remaining < ARRIVE_TOLERANCE * 3
    ? Math.max(0.35, remaining / (ARRIVE_TOLERANCE * 3))
    : 1;
  const speed = pacedSpeed * alignFactor * cohesionFactor * arrivalFactor;


  // Infantry can sidestep and should track the route directly. Driving them by
  // facing caused wide arcs that clipped obstacles and repeatedly rebuilt A*.
  const steerX = dirX + sep.x * sepWeight, steerY = dirY + sep.y * sepWeight;
  const steerLength = Math.hypot(steerX, steerY) || 1;
  const travelX = veh ? Math.cos(unit.facing) : steerX / steerLength;
  const travelY = veh ? Math.sin(unit.facing) : steerY / steerLength;
  const targetVx = travelX * speed;
  const targetVy = travelY * speed;
  const accel = veh ? 5 : 11;
  unit.vel.x += (targetVx - unit.vel.x) * Math.min(1, accel * dt);
  unit.vel.y += (targetVy - unit.vel.y) * Math.min(1, accel * dt);

  const nextX = unit.pos.x + unit.vel.x * dt;
  const nextY = unit.pos.y + unit.vel.y * dt;
  const nextT = getTerrainAt(state.terrain, nextX, nextY);
  const stepOk = heli || (veh
    ? isWorldFootprintPassable(state.terrain, nextX, nextY, true)
    : isPassable(nextT, false, false));
  const neighbors = heli ? [] : queryNeighbors(getUnitGrid(state), nextX, nextY, 32, unit)
    .filter(other => other.alive && !other.insideOf && other.team === unit.team && other.type !== 'helicopter' && unit.boardTarget !== other.id);
  const trafficAt = (x: number, y: number) => neighbors.some(other => {
    const limit = (spacingRadius(unit) + spacingRadius(other)) * .6;
    const before = distance(unit.pos, other.pos), after = Math.hypot(x - other.pos.x, y - other.pos.y);
    return after < limit && after < before - .001;
  });
  if (trafficAt(nextX, nextY)) {
    // Sidestep / reverse out of a bottleneck while keeping the same route.
    // Vehicles use a slow reverse; infantry may sidestep freely. This is a
    // continuous step, never a teleport or permission to cross another hull.
    const step = speed * dt * (veh ? .35 : .7);
    const offsets = veh ? [Math.PI, .35, -.35] : [Math.PI / 2, -Math.PI / 2, 2.1, -2.1, Math.PI];
    for (const offset of offsets) {
      const angle = unit.facing + offset;
      const x = unit.pos.x + Math.cos(angle) * step, y = unit.pos.y + Math.sin(angle) * step;
      if (!trafficAt(x, y) && isWorldFootprintPassable(state.terrain, x, y, veh)) {
        unit.pos = { x, y }; break;
      }
    }
    unit.vel = { x: 0, y: 0 }; unit.waiting = 'traffic';
    unit.lastProgressTime = state.time;
    // A friendly has settled beside the slot: close enough is arrived, instead
    // of yielding forever one step short of a crowded square.
    unit.trafficWait = (unit.trafficWait ?? 0) + dt;
    if (unit.path.length === 0 && unit.finalDest && distance(unit.pos, unit.finalDest) < CELL_SIZE * 1.5 && unit.trafficWait > 2.5) {
      unit.trafficWait = 0; unit.waiting = undefined;
      unit.targetPos = null; unit.finalDest = null; unit.homePos = { ...unit.pos };
      if (unit.waypoints.length === 0 && unit.order !== 'hold_position' && unit.order !== 'patrol' && unit.order !== 'attack') {
        unit.order = unit.holdOnArrive ? 'hold_position' : 'idle';
        unit.holdOnArrive = false; unit.groupSpeedCap = null; unit.moveGroupId = null;
      }
    }
    return;
  }
  unit.trafficWait = 0;
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
      const ok = veh
        ? isWorldFootprintPassable(state.terrain, sx, sy, true)
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
      if (dest) setDestination(unit, state, dest, true);
      unit.stuckTimer = 0;
    }
  }


  // No-progress detector: if dist to target hasn't shrunk in ~0.7s, re-path to final dest.
  if (state.time - unit.lastProgressTime > 0.7) {
    const newDist = distance(unit.pos, unit.targetPos);
    if (newDist + 2 >= unit.lastProgressDist) {
      const dest = unit.finalDest ?? unit.targetPos;
      if (dest) setDestination(unit, state, dest, true);
    } else {
      unit.lastProgressDist = newDist;
      unit.lastProgressTime = state.time;
    }
  }

  const fatigueGain = (terrain ? terrain.fatigueRate : 1) * (heli ? 0.05 : veh ? 0.08 : 0.12) * dt;
  unit.fatigue = Math.min(1, unit.fatigue + fatigueGain);

  const cur = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  unit.inCover = unit.type === 'infantry' && (!unit.targetPos || unit.engaging) && (cur?.coverBonus ?? 0) > 0;
}

function speedMagnitude(unit: Unit) { return Math.hypot(unit.vel.x, unit.vel.y); }

/**
 * How strongly `attacker`'s fire shakes `target`. Rifle fire pins infantry but
 * barely rattles armour; main guns and rockets shake everything a little.
 */
export function suppressionScale(attacker: Unit, target: Unit): number {
  let scale = SUPPRESSION_RESIST[target.type];
  if (isVehicle(target) || target.type === 'helicopter') {
    if (attacker.damage < HEAVY_WEAPON_DAMAGE) scale *= SMALL_ARMS_VS_VEHICLE;
  }
  return scale;
}

/** Higher = more worth shooting right now. Combines proximity, threat, effectiveness and urgency. */
export function scoreTarget(unit: Unit, enemy: Unit, dist: number, state: GameState): number {
  const proximity = 1 - Math.min(1, dist / Math.max(1, unit.range));
  const smallArms = unit.damage < HEAVY_WEAPON_DAMAGE;
  const effectiveness = 1 - enemy.armor / (enemy.armor + 50) * (smallArms ? 1.4 : 0.6);
  const shootingMe = enemy.attackTarget === unit.id && state.time - enemy.lastFireTime < 3 ? 0.5 : 0;
  const wounded = 1 - enemy.health / enemy.maxHealth;
  return proximity * 0.9 + TARGET_THREAT[enemy.type] * 0.6 + Math.max(0, effectiveness) * (smallArms ? 0.9 : 0.5) + wounded * 0.3 + shootingMe;
}

/** Best visible, in-range enemy with a clear line of fire; the current target keeps its place unless clearly outscored. */
function pickTarget(unit: Unit, enemies: Unit[], state: GameState, current?: Unit): Unit | undefined {
  const heli = unit.type === 'helicopter';
  let best: Unit | undefined, bestScore = -Infinity, currentScore = -Infinity;
  for (const enemy of enemies) {
    if (!isVisibleTo(enemy, unit.team)) continue;
    const dist = distance(unit.pos, enemy.pos);
    if (dist > unit.range || dist > unit.sightRange) continue;
    if (!hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, enemy.pos.x, enemy.pos.y, heli)) continue;
    const score = scoreTarget(unit, enemy, dist, state);
    if (enemy === current) currentScore = score;
    if (score > bestScore) { bestScore = score; best = enemy; }
  }
  if (current && currentScore > -Infinity && bestScore < currentScore + RETARGET_HYSTERESIS) return current;
  return best;
}

export function updateCombat(unit: Unit, dt: number, state: GameState): { killMsg: string | null; killedTeam: Team | null } {
  if (!unit.alive || unit.insideOf) return { killMsg: null, killedTeam: null };

  unit.engaging = false; unit.aiming = false;
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

  // A player-ordered target is followed (see updateOrders); anything else is a
  // soft, automatically chosen target that must stay in range and in sight.
  const ordered = unit.order === 'attack' && !!unit.attackTarget;
  let target: Unit | undefined;
  if (unit.attackTarget) {
    const current = enemies.find(e => e.id === unit.attackTarget && isVisibleTo(e, unit.team));
    if (current && (ordered || distance(unit.pos, current.pos) <= unit.range * 1.05)) target = current;
    else if (!ordered) unit.attackTarget = null;
  }

  unit.retargetTimer = Math.max(0, unit.retargetTimer - dt);
  if (canAcquire && !ordered && (!target || unit.retargetTimer <= 0)) {
    unit.retargetTimer = RETARGET_INTERVAL;
    const best = pickTarget(unit, enemies, state, target);
    if (best !== target) { target = best; unit.attackTarget = best?.id ?? null; }
  }

  // Attack-move fights where it stands. After MAX_ENGAGE_TIME of stalemate the
  // unit pushes on for a short grace period so a stand-off cannot freeze an advance.
  if (target && isHumanTeam(state, unit.team) && unit.order === 'attack_move' && state.time >= unit.disengageUntil) {
    unit.engageTime += dt;
    if (unit.engageTime > MAX_ENGAGE_TIME) {
      unit.engageTime = 0; unit.disengageUntil = state.time + DISENGAGE_GRACE;
    } else unit.engaging = true;
  } else {
    unit.engageTime = Math.max(0, unit.engageTime - dt * 2);
  }
  unit.aiming = !!target && !isVehicle(unit) && !(unit.order === 'retreat' && unit.targetPos != null);

  if (target) {
    const desired = angleBetween(unit.pos, target.pos);
    const delta = normalizeAngle(desired - unit.facing);
    const maxTurn = unit.turnRate * dt;
    // Hulls steer by heading while driving; soldiers and halted vehicles can turn to fire.
    const hullDriving = isVehicle(unit) && !unit.engaging && unit.targetPos != null &&
      (unit.order === 'move' || unit.order === 'attack_move' || unit.order === 'retreat');
    const running = unit.order === 'retreat' && unit.targetPos != null;
    if (!hullDriving && !running) {
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
    else if (targetTerrain.prop && target.type === 'infantry') coverPenalty = 1 - targetTerrain.coverBonus * 0.65;
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
  const isHit = random(state) <= hitChance;
  const isCrit = isHit && random(state) < unit.critChance * (1 + flankBonus);
  const projTarget = isHit
    ? { ...target.pos }
    : { x: target.pos.x + (random(state) - 0.5) * 30, y: target.pos.y + (random(state) - 0.5) * 30 };

  state.projectiles.push({
    from: { ...unit.pos }, to: projTarget,
    timer: unit.type === 'tank' ? 0.4 : 0.2,
    hit: isHit, crit: isCrit, team: unit.team,
  });
  unit.attackTimer = unit.attackCooldown;
  unit.lastFireTime = state.time;
  if (unit.ammo <= 0) unit.reloadTimer = UNIT_STATS[unit.type].reloadTime;
  const suppressScale = suppressionScale(unit, target);

  if (!isHit) {
    const suppressionGain = (targetEntrenched ? 0.025 : 0.08) * suppressScale;
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
  if (targetTerrain?.type === 'sandbag' && !targetTerrain.prop) dmg *= 0.75;
  if (targetTerrain?.prop && target.inCover) dmg *= 1 - targetTerrain.coverBonus * .5;
  if (targetTerrain?.type === 'crater') dmg *= 0.7;

  target.health -= dmg;
  target.lastDamageTime = state.time;
  target.suppression = Math.min(1, target.suppression + (targetEntrenched ? 0.1 : 0.3) * suppressScale);
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
          p.pos = { x: target.pos.x + (random(state) - 0.5) * 20, y: target.pos.y + (random(state) - 0.5) * 20 };
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


// ============ ORDERS THAT REACT TO THE BATTLE ============

function endAttackOrder(unit: Unit) {
  unit.attackTarget = null;
  unit.order = 'idle';
  unit.targetPos = null; unit.path = []; unit.finalDest = null;
  unit.chaseGoal = null; unit.targetLostTimer = 0;
}

/**
 * Explicit attack order: close to firing range with a clear line of fire,
 * stop and shoot, follow the target if it moves, search its last known
 * position if it disappears, and stand down when it dies or stays lost.
 */
function pursueOrderedTarget(unit: Unit, dt: number, state: GameState) {
  const target = state.units.find(u => u.id === unit.attackTarget);
  if (!target || !target.alive) { endAttackOrder(unit); return; }
  const visible = !target.insideOf && isVisibleTo(target, unit.team);
  if (visible) { unit.chaseGoal = { ...target.pos }; unit.targetLostTimer = 0; }
  else unit.targetLostTimer += dt;
  if (unit.targetLostTimer > TARGET_LOST_TIMEOUT) { endAttackOrder(unit); return; }

  const dist = distance(unit.pos, target.pos);
  const heli = unit.type === 'helicopter';
  const inPosition = visible && dist <= unit.range * 0.95 &&
    hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, target.pos.x, target.pos.y, heli);
  if (inPosition) {
    // Stand and fire; combat handles aiming. Do not keep walking into the target.
    if (unit.targetPos || unit.path.length) { unit.targetPos = null; unit.path = []; unit.finalDest = null; }
    return;
  }

  let goal: Position | null = null;
  if (visible) {
    const len = dist || 1;
    // Out of range: close to the standoff distance. In range but blocked: get right up to it.
    const standoff = dist > unit.range * 0.95 ? unit.range * CHASE_STANDOFF : unit.range * 0.35;
    goal = { x: target.pos.x - ((target.pos.x - unit.pos.x) / len) * standoff, y: target.pos.y - ((target.pos.y - unit.pos.y) / len) * standoff };
  } else if (unit.chaseGoal && distance(unit.pos, unit.chaseGoal) > CELL_SIZE) {
    goal = unit.chaseGoal;
  }
  if (!goal) return;
  const moving = !!unit.targetPos || unit.path.length > 0;
  const drifted = !unit.finalDest || distance(unit.finalDest, goal) > CELL_SIZE * 1.5;
  if (unit.chaseRepathTimer <= 0 && (!moving || drifted)) {
    unit.chaseRepathTimer = 0.6;
    setDestination(unit, state, goal);
  }
}

/** Per-frame order upkeep that has to look at the battlefield. Runs before movement. */
export function updateOrders(unit: Unit, dt: number, state: GameState) {
  if (!unit.alive || unit.insideOf) return;
  unit.chaseRepathTimer = Math.max(0, unit.chaseRepathTimer - dt);
  if (unit.order === 'attack' && unit.attackTarget) pursueOrderedTarget(unit, dt, state);
}

export function getUnitsInRect(units: Unit[], x1: number, y1: number, x2: number, y2: number, team: Team): Unit[] {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return units.filter(u => u.alive && u.team === team && u.pos.x >= minX && u.pos.x <= maxX && u.pos.y >= minY && u.pos.y <= maxY);
}
