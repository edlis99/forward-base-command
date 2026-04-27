import { Unit, UnitType, Team, Position, GameState, Projectile, Stance, OrderType } from './types';
import { UNIT_STATS, CELL_SIZE, VETERANCY_THRESHOLDS, VETERANCY_BONUSES, CP_VETERANCY_BONUS, MOVING_ACC_PENALTY, STATIONARY_ACC_BONUS } from './constants';
import { getTerrainAt, hasLineOfSight, losInfo, isPassable } from './terrain';

let nextId = 1;

export function createUnit(type: UnitType, team: Team, x: number, y: number): Unit {
  const stats = UNIT_STATS[type];
  return {
    id: `unit_${nextId++}`,
    type,
    team,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    targetPos: null,
    waypoints: [],
    attackTarget: null,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    speed: stats.speed,
    range: stats.range,
    damage: stats.damage,
    armor: stats.armor,
    sightRange: stats.sightRange,
    attackCooldown: stats.attackCooldown,
    attackTimer: 0,
    reloadTimer: 0,
    ammo: stats.ammo,
    maxAmmo: stats.ammo,
    suppression: 0,
    alive: true,
    selected: false,
    inCover: false,
    accuracy: stats.accuracy,
    critChance: stats.critChance,
    morale: 1.0,
    facing: team === 'player' ? 0 : Math.PI,
    turnRate: stats.turnRate,
    kills: 0,
    veterancy: 0,
    droneActive: false,
    droneTarget: null,
    stance: 'defend',
    order: 'idle',
    homePos: { x, y },
    fatigue: 0,
    stuckTimer: 0,
    lastDamageTime: -999,
    passengers: [],
    insideOf: null,
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

export function checkVeterancy(unit: Unit, state: GameState): string | null {
  const newLevel = VETERANCY_THRESHOLDS.findIndex((threshold, i) =>
    i === VETERANCY_THRESHOLDS.length - 1 || unit.kills < VETERANCY_THRESHOLDS[i + 1]
  );
  if (newLevel > unit.veterancy) {
    unit.veterancy = newLevel;
    const bonus = VETERANCY_BONUSES[newLevel];
    unit.accuracy = Math.min(0.95, UNIT_STATS[unit.type].accuracy * bonus);
    unit.damage = UNIT_STATS[unit.type].damage * bonus;
    if (unit.team === 'player') {
      state.commandPoints += CP_VETERANCY_BONUS;
      return `${unit.type} promoted to ${['Rookie', 'Regular', 'Veteran', 'Elite'][newLevel]}! +${CP_VETERANCY_BONUS} CP`;
    }
  }
  return null;
}

function isVehicle(u: Unit) { return u.type === 'tank' || u.type === 'apc'; }

/** Steer around blocked terrain by sampling perpendicular offsets. */
function chooseSteer(unit: Unit, dx: number, dy: number, state: GameState): { x: number; y: number } {
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;
  const heli = unit.type === 'helicopter';
  const veh = isVehicle(unit);
  // Try forward, +30°, -30°, +60°, -60°
  const offsets = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
  const probeDist = CELL_SIZE * 1.2;
  for (const off of offsets) {
    const a = Math.atan2(ny, nx) + off;
    const px = unit.pos.x + Math.cos(a) * probeDist;
    const py = unit.pos.y + Math.sin(a) * probeDist;
    const t = getTerrainAt(state.terrain, px, py);
    if (isPassable(t, veh, heli)) {
      return { x: Math.cos(a), y: Math.sin(a) };
    }
  }
  return { x: nx, y: ny };
}

/** Simple separation force from nearby allies to prevent stacking. */
function separation(unit: Unit, state: GameState): { x: number; y: number } {
  let sx = 0, sy = 0;
  const radius = unit.type === 'tank' ? 30 : unit.type === 'apc' ? 28 : 18;
  for (const o of state.units) {
    if (!o.alive || o === unit) continue;
    if (o.type === 'helicopter' !== (unit.type === 'helicopter')) continue; // air vs ground separate layers
    const dx = unit.pos.x - o.pos.x;
    const dy = unit.pos.y - o.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < radius) {
      const w = (radius - d) / radius;
      sx += (dx / d) * w;
      sy += (dy / d) * w;
    }
  }
  return { x: sx, y: sy };
}

export function moveUnit(unit: Unit, dt: number, state: GameState) {
  if (!unit.alive) return;
  if (unit.insideOf) return; // passenger doesn't move on its own

  // Pop waypoint when current target reached
  if (!unit.targetPos && unit.waypoints.length > 0) {
    unit.targetPos = unit.waypoints.shift()!;
    if (unit.order === 'idle') unit.order = 'move';
  }

  if (!unit.targetPos) {
    // Decelerate
    unit.vel.x *= 0.85;
    unit.vel.y *= 0.85;
    // Recover fatigue
    unit.fatigue = Math.max(0, unit.fatigue - dt * 0.15);
    return;
  }

  const distToTarget = distance(unit.pos, unit.targetPos);
  if (distToTarget < 6) {
    unit.targetPos = null;
    if (unit.waypoints.length === 0) unit.order = unit.order === 'attack_move' ? 'idle' : 'idle';
    unit.vel.x *= 0.5;
    unit.vel.y *= 0.5;
    return;
  }

  const heli = unit.type === 'helicopter';
  const veh = isVehicle(unit);
  const terrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);

  // Block if destination terrain is impassable
  if (!heli) {
    const destT = getTerrainAt(state.terrain, unit.targetPos.x, unit.targetPos.y);
    if (!isPassable(destT, veh, false)) {
      unit.targetPos = null;
      return;
    }
  }

  // Compute desired direction (with steering around obstacles)
  const dx = unit.targetPos.x - unit.pos.x;
  const dy = unit.targetPos.y - unit.pos.y;
  const steer = heli ? { x: dx / Math.hypot(dx, dy || 1), y: dy / Math.hypot(dx, dy || 1) } : chooseSteer(unit, dx, dy, state);

  // Add separation
  const sep = separation(unit, state);
  const desiredAngle = Math.atan2(steer.y + sep.y * 0.7, steer.x + sep.x * 0.7);

  // Turn-rate limit
  const facingDelta = normalizeAngle(desiredAngle - unit.facing);
  const maxTurn = unit.turnRate * dt;
  if (Math.abs(facingDelta) > maxTurn) {
    unit.facing += Math.sign(facingDelta) * maxTurn;
  } else {
    unit.facing = desiredAngle;
  }

  // Tanks slow drastically when not aligned with travel
  const alignment = Math.cos(facingDelta);
  const alignFactor = veh ? Math.max(0.15, alignment) : (alignment > 0 ? 1 : 0.6);

  // Speed modifiers
  const moveCost = terrain ? terrain.movementCost : 1;
  const traction = terrain ? terrain.traction : 1;
  const effectiveCost = heli ? 1 : moveCost;
  const suppressionPenalty = 1 - unit.suppression * 0.5;
  const moralePenalty = 0.7 + unit.morale * 0.3;
  const fatiguePenalty = 1 - unit.fatigue * 0.4;
  const speed = (unit.speed / effectiveCost) * suppressionPenalty * moralePenalty * fatiguePenalty * traction * alignFactor;

  // Acceleration toward facing direction
  const targetVx = Math.cos(unit.facing) * speed;
  const targetVy = Math.sin(unit.facing) * speed;
  const accel = veh ? 3 : 8;
  unit.vel.x += (targetVx - unit.vel.x) * Math.min(1, accel * dt);
  unit.vel.y += (targetVy - unit.vel.y) * Math.min(1, accel * dt);

  const nextX = unit.pos.x + unit.vel.x * dt;
  const nextY = unit.pos.y + unit.vel.y * dt;

  // Collision check at next position
  const nextT = getTerrainAt(state.terrain, nextX, nextY);
  if (heli || isPassable(nextT, veh, false)) {
    unit.pos.x = nextX;
    unit.pos.y = nextY;
    unit.stuckTimer = 0;

    // Trample tall grass when vehicles or many units pass
    if (!heli && nextT && (nextT.type === 'tall_grass' || (nextT.type === 'forest' && veh))) {
      // not destructive — just mark trampled briefly
      nextT.trampled = true;
    }
  } else {
    // Stuck: drain velocity, increment timer, abort if persistent
    unit.vel.x *= 0.3;
    unit.vel.y *= 0.3;
    unit.stuckTimer += dt;
    if (unit.stuckTimer > 1.5) {
      unit.targetPos = null;
      unit.stuckTimer = 0;
    }
  }

  // Fatigue accrues when moving
  const fatigueGain = (terrain ? terrain.fatigueRate : 1) * (heli ? 0.05 : veh ? 0.08 : 0.12) * dt;
  unit.fatigue = Math.min(1, unit.fatigue + fatigueGain);

  // Update cover state
  const currentTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  unit.inCover = currentTerrain ? currentTerrain.coverBonus > 0 : false;
}

/** Speed magnitude (for "moving" accuracy penalty). */
function speedMagnitude(unit: Unit) {
  return Math.hypot(unit.vel.x, unit.vel.y);
}

export function updateCombat(unit: Unit, dt: number, state: GameState): string | null {
  if (!unit.alive) return null;
  if (unit.insideOf) return null;

  unit.attackTimer = Math.max(0, unit.attackTimer - dt);
  unit.reloadTimer = Math.max(0, unit.reloadTimer - dt);
  unit.suppression = Math.max(0, unit.suppression - dt * 0.18);
  unit.morale = Math.min(1, unit.morale + dt * 0.05);

  // Reload completes
  if (unit.ammo <= 0 && unit.reloadTimer <= 0) {
    unit.ammo = unit.maxAmmo;
  }

  // Hold-fire stance: don't pick targets unless ordered
  const canAcquire = unit.stance !== 'hold_fire';

  const enemies = state.units.filter(u => u.alive && u.team !== unit.team && !u.insideOf);

  let target: Unit | undefined;
  if (unit.attackTarget) {
    target = enemies.find(e => e.id === unit.attackTarget);
    if (!target || distance(unit.pos, target.pos) > unit.range) {
      // keep target if attack-moving, else drop
      if (!target) unit.attackTarget = null;
    }
  }

  if (!target && canAcquire) {
    let closest = Infinity;
    for (const enemy of enemies) {
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
    // Always face target when about to shoot
    const desired = angleBetween(unit.pos, target.pos);
    const delta = normalizeAngle(desired - unit.facing);
    const maxTurn = unit.turnRate * dt;
    if (Math.abs(delta) > maxTurn) unit.facing += Math.sign(delta) * maxTurn;
    else unit.facing = desired;

    // Defensive stance: stop moving when engaging
    if (unit.stance === 'defend' && unit.order !== 'attack_move' && unit.order !== 'move') {
      unit.targetPos = null;
    }
  }

  if (!target || unit.attackTimer > 0 || unit.reloadTimer > 0 || unit.ammo <= 0) {
    if (target && unit.ammo <= 0 && unit.reloadTimer <= 0) {
      unit.reloadTimer = UNIT_STATS[unit.type].reloadTime;
    }
    return null;
  }

  // LOS check
  const losData = losInfo(state.terrain, unit.pos.x, unit.pos.y, target.pos.x, target.pos.y, unit.type === 'helicopter');
  if (!losData.clear) return null;

  // Smoke check
  for (const effect of state.activeEffects) {
    if (effect.type === 'smoke_screen' && effect.delay <= 0) {
      const stu = distance(effect.pos, unit.pos);
      const stt = distance(effect.pos, target.pos);
      if (stu < effect.radius || stt < effect.radius) return null;
    }
  }

  // Facing check — must be roughly aimed (within ~25° for vehicles, ~45° for infantry)
  const aimDiff = Math.abs(normalizeAngle(angleBetween(unit.pos, target.pos) - unit.facing));
  const aimCone = isVehicle(unit) ? 0.45 : 0.8;
  if (aimDiff > aimCone) return null;

  // --- Combat calculations ---
  const vetBonus = VETERANCY_BONUSES[unit.veterancy];
  const suppressionAccPenalty = 1 - unit.suppression * 0.4;
  const moraleAccBonus = 0.8 + unit.morale * 0.2;
  const distancePenalty = 1 - (distance(unit.pos, target.pos) / unit.range) * 0.3;

  // Movement penalty: shooting on the move is worse
  const speedMag = speedMagnitude(unit);
  const movingFactor = speedMag > 5 ? MOVING_ACC_PENALTY + (1 - MOVING_ACC_PENALTY) * Math.max(0, 1 - speedMag / unit.speed) : STATIONARY_ACC_BONUS;

  // Concealment along sight line reduces hit chance even with clear LOS
  const concealmentPenalty = 1 / (1 + losData.concealmentSum * 0.6);

  // Terrain accuracy modifiers
  const attackerTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  const targetTerrain = getTerrainAt(state.terrain, target.pos.x, target.pos.y);

  let positionBonus = 1.0;
  if (attackerTerrain) {
    if (attackerTerrain.type === 'trench') positionBonus = 1.15;
    else if (attackerTerrain.type === 'sandbag') positionBonus = 1.1;
    else if (attackerTerrain.type === 'urban') positionBonus = 1.05;
  }

  let coverPenalty = 1.0;
  if (targetTerrain) {
    if (targetTerrain.type === 'trench') coverPenalty = 0.55;
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

  // Burst fire / shot — uses one ammo
  unit.ammo -= 1;
  const isHit = Math.random() <= hitChance;
  const isCrit = isHit && Math.random() < unit.critChance * (1 + flankBonus);

  const projTarget = isHit
    ? { ...target.pos }
    : { x: target.pos.x + (Math.random() - 0.5) * 30, y: target.pos.y + (Math.random() - 0.5) * 30 };

  state.projectiles.push({
    from: { ...unit.pos },
    to: projTarget,
    timer: unit.type === 'tank' ? 0.4 : 0.2,
    hit: isHit,
    crit: isCrit,
    team: unit.team,
  });

  unit.attackTimer = unit.attackCooldown;

  // Trigger reload if mag empty
  if (unit.ammo <= 0) {
    unit.reloadTimer = UNIT_STATS[unit.type].reloadTime;
  }

  if (!isHit) {
    // Near-miss still suppresses
    target.suppression = Math.min(1, target.suppression + 0.08);
    return null;
  }

  let dmg = unit.damage * vetBonus;
  if (isCrit) dmg *= 1.8;
  dmg *= (1 + flankBonus);

  const elevDiff = (attackerTerrain?.elevation ?? 1) - (targetTerrain?.elevation ?? 1);
  if (elevDiff > 0) dmg *= 1.15;
  if (elevDiff < 0) dmg *= 0.9;

  const coverBonus = target.inCover ? targetTerrain?.coverBonus ?? 0 : 0;
  const effectiveArmor = target.armor * (1 + coverBonus);
  dmg = Math.max(dmg * (1 - effectiveArmor / (effectiveArmor + 50)), 1);

  // Type effectiveness
  if (unit.type === 'infantry' && target.type === 'infantry') dmg *= 1.2;
  if (unit.type === 'tank' && (target.type === 'tank' || target.type === 'apc')) dmg *= 1.3;
  if (unit.type === 'helicopter') dmg *= 1.1;
  if (target.type === 'helicopter' && unit.type === 'infantry') dmg *= 0.5;

  if (targetTerrain?.type === 'trench') dmg *= 0.55;
  if (targetTerrain?.type === 'sandbag') dmg *= 0.75;
  if (targetTerrain?.type === 'crater') dmg *= 0.7;

  target.health -= dmg;
  target.lastDamageTime = state.time;
  target.suppression = Math.min(1, target.suppression + 0.3);

  // Morale shock to nearby allies
  for (const ally of state.units) {
    if (ally.alive && ally.team === target.team && ally.id !== target.id) {
      const allyDist = distance(ally.pos, target.pos);
      if (allyDist < 100) ally.morale = Math.max(0.2, ally.morale - 0.05);
    }
  }

  // Reactive return-fire: if a defending unit is hit and not yet engaged, snap target
  if (target.alive && !target.attackTarget && target.stance !== 'hold_fire') {
    target.attackTarget = unit.id;
  }

  if (target.health <= 0) {
    target.alive = false;
    unit.kills++;

    // Killed APC dumps passengers
    if (target.passengers.length > 0) {
      for (const pid of target.passengers) {
        const p = state.units.find(u => u.id === pid);
        if (p) {
          p.insideOf = null;
          p.pos = { x: target.pos.x + (Math.random() - 0.5) * 20, y: target.pos.y + (Math.random() - 0.5) * 20 };
          p.health *= 0.6; // injured by destruction
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

    const critText = isCrit ? ' (CRITICAL)' : '';
    return `${unit.team === 'player' ? 'Friendly' : 'Enemy'} ${unit.type} destroyed enemy ${target.type}${critText}`;
  }
  return null;
}

export function getUnitsInRect(units: Unit[], x1: number, y1: number, x2: number, y2: number, team: Team): Unit[] {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  return units.filter(u => u.alive && u.team === team && u.pos.x >= minX && u.pos.x <= maxX && u.pos.y >= minY && u.pos.y <= maxY);
}
