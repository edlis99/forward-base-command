import { Unit, UnitType, Team, Position, GameState, Projectile } from './types';
import { UNIT_STATS, CELL_SIZE, VETERANCY_THRESHOLDS, VETERANCY_BONUSES, CP_VETERANCY_BONUS } from './constants';
import { getTerrainAt, hasLineOfSight } from './terrain';

let nextId = 1;

export function createUnit(type: UnitType, team: Team, x: number, y: number): Unit {
  const stats = UNIT_STATS[type];
  return {
    id: `unit_${nextId++}`,
    type,
    team,
    pos: { x, y },
    targetPos: null,
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
    suppression: 0,
    alive: true,
    selected: false,
    inCover: false,
    accuracy: stats.accuracy,
    critChance: stats.critChance,
    morale: 1.0,
    facing: team === 'player' ? 0 : Math.PI,
    kills: 0,
    veterancy: 0,
    droneActive: false,
    droneTarget: null,
  };
}

export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function angleBetween(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function getFlankingBonus(attacker: Unit, target: Unit): number {
  const attackAngle = angleBetween(attacker.pos, target.pos);
  const facingDiff = Math.abs(normalizeAngle(attackAngle - target.facing));
  if (facingDiff > Math.PI * 0.67) return 0.4;
  if (facingDiff > Math.PI * 0.33) return 0.2;
  return 0;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
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

export function moveUnit(unit: Unit, dt: number, state: GameState) {
  if (!unit.targetPos || !unit.alive) return;

  const dist = distance(unit.pos, unit.targetPos);
  if (dist < 3) {
    unit.targetPos = null;
    return;
  }

  const terrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  const moveCost = terrain ? terrain.movementCost : 1;
  const effectiveCost = unit.type === 'helicopter' ? 1 : moveCost;

  // Check if destination terrain blocks movement (not for helicopters)
  if (unit.type !== 'helicopter') {
    const destTerrain = getTerrainAt(state.terrain, unit.targetPos.x, unit.targetPos.y);
    if (destTerrain && destTerrain.blocksMovement) {
      unit.targetPos = null;
      return;
    }
    // Check next step for walls
    const dx = unit.targetPos.x - unit.pos.x;
    const dy = unit.targetPos.y - unit.pos.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nextX = unit.pos.x + (dx / len) * unit.speed * dt;
    const nextY = unit.pos.y + (dy / len) * unit.speed * dt;
    const nextTerrain = getTerrainAt(state.terrain, nextX, nextY);
    if (nextTerrain && nextTerrain.blocksMovement) {
      unit.targetPos = null;
      return;
    }
  }

  if (terrain && terrain.type === 'water' && unit.type !== 'helicopter') {
    unit.targetPos = null;
    return;
  }

  const suppressionPenalty = 1 - unit.suppression * 0.5;
  const moralePenalty = 0.7 + unit.morale * 0.3;
  const speed = (unit.speed / effectiveCost) * suppressionPenalty * moralePenalty;

  const dx = unit.targetPos.x - unit.pos.x;
  const dy = unit.targetPos.y - unit.pos.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  unit.facing = Math.atan2(dy, dx);

  unit.pos.x += (dx / len) * speed * dt;
  unit.pos.y += (dy / len) * speed * dt;

  const currentTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  unit.inCover = currentTerrain ? currentTerrain.coverBonus > 0 : false;
}

export function updateCombat(unit: Unit, dt: number, state: GameState): string | null {
  if (!unit.alive) return null;

  unit.attackTimer = Math.max(0, unit.attackTimer - dt);
  unit.suppression = Math.max(0, unit.suppression - dt * 0.2);
  unit.morale = Math.min(1, unit.morale + dt * 0.05);

  const enemies = state.units.filter(u => u.alive && u.team !== unit.team);

  let target: Unit | undefined;
  if (unit.attackTarget) {
    target = enemies.find(e => e.id === unit.attackTarget && distance(unit.pos, e.pos) <= unit.range);
    if (!target) unit.attackTarget = null;
  }

  if (!target) {
    let closest = Infinity;
    for (const enemy of enemies) {
      const dist = distance(unit.pos, enemy.pos);
      if (dist <= unit.range && dist < closest) {
        // Check LOS before considering as valid target
        if (hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, enemy.pos.x, enemy.pos.y, unit.type === 'helicopter')) {
          closest = dist;
          target = enemy;
        }
      }
    }
  }

  if (target) {
    unit.facing = angleBetween(unit.pos, target.pos);
  }

  if (!target || unit.attackTimer > 0) return null;

  // LOS check for explicit attack target too
  if (!hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, target.pos.x, target.pos.y, unit.type === 'helicopter')) {
    return null; // can't shoot through walls/buildings
  }

  // Smoke LOS check
  for (const effect of state.activeEffects) {
    if (effect.type === 'smoke_screen' && effect.delay <= 0) {
      const smokeToUnit = distance(effect.pos, unit.pos);
      const smokeToTarget = distance(effect.pos, target.pos);
      if (smokeToUnit < effect.radius || smokeToTarget < effect.radius) {
        return null;
      }
    }
  }

  // --- Combat calculations ---
  const vetBonus = VETERANCY_BONUSES[unit.veterancy];
  const suppressionAccPenalty = 1 - unit.suppression * 0.4;
  const moraleAccBonus = 0.8 + unit.morale * 0.2;
  const distancePenalty = 1 - (distance(unit.pos, target.pos) / unit.range) * 0.3;
  
  // Terrain accuracy modifiers
  const attackerTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  const targetTerrain = getTerrainAt(state.terrain, target.pos.x, target.pos.y);
  
  // Shooting from stable position (trench/sandbag) improves accuracy
  let positionBonus = 1.0;
  if (attackerTerrain) {
    if (attackerTerrain.type === 'trench') positionBonus = 1.15;
    else if (attackerTerrain.type === 'sandbag') positionBonus = 1.1;
  }
  
  // Target in cover is harder to hit
  let coverPenalty = 1.0;
  if (targetTerrain) {
    if (targetTerrain.type === 'trench') coverPenalty = 0.6; // very hard to hit in trench
    else if (targetTerrain.type === 'sandbag') coverPenalty = 0.7;
    else if (targetTerrain.type === 'urban') coverPenalty = 0.75;
    else if (targetTerrain.type === 'rubble') coverPenalty = 0.85;
    else if (targetTerrain.type === 'forest') coverPenalty = 0.8;
  }

  let hitChance = unit.accuracy * suppressionAccPenalty * moraleAccBonus * distancePenalty * vetBonus * positionBonus * coverPenalty;

  const flankBonus = getFlankingBonus(unit, target);
  hitChance = Math.min(0.95, hitChance + flankBonus * 0.1);

  // Create projectile visual
  const isHit = Math.random() <= hitChance;
  const isCrit = isHit && Math.random() < unit.critChance * (1 + flankBonus);
  
  // Add projectile tracer
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

  if (!isHit) return null;

  // Damage calculation
  let dmg = unit.damage * vetBonus;
  if (isCrit) dmg *= 1.8;
  dmg *= (1 + flankBonus);

  // Elevation advantage
  const elevDiff = (attackerTerrain?.elevation ?? 1) - (targetTerrain?.elevation ?? 1);
  if (elevDiff > 0) dmg *= 1.15;
  if (elevDiff < 0) dmg *= 0.9;

  // Armor + cover reduction
  const coverBonus = target.inCover ? targetTerrain?.coverBonus ?? 0 : 0;
  const effectiveArmor = target.armor * (1 + coverBonus);
  dmg = Math.max(dmg * (1 - effectiveArmor / (effectiveArmor + 50)), 1);

  // Type effectiveness
  if (unit.type === 'infantry' && target.type === 'infantry') dmg *= 1.2;
  if (unit.type === 'tank' && (target.type === 'tank' || target.type === 'apc')) dmg *= 1.3;
  if (unit.type === 'helicopter') dmg *= 1.1;
  if (target.type === 'helicopter' && unit.type === 'infantry') dmg *= 0.5;

  // Trench damage reduction
  if (targetTerrain?.type === 'trench') dmg *= 0.6;
  if (targetTerrain?.type === 'sandbag') dmg *= 0.75;

  target.health -= dmg;
  target.suppression = Math.min(1, target.suppression + 0.3);

  // Morale damage to nearby allies
  for (const ally of state.units) {
    if (ally.alive && ally.team === target.team && ally.id !== target.id) {
      const allyDist = distance(ally.pos, target.pos);
      if (allyDist < 100) {
        ally.morale = Math.max(0.2, ally.morale - 0.05);
      }
    }
  }

  if (target.health <= 0) {
    target.alive = false;
    unit.kills++;

    for (const ally of state.units) {
      if (ally.alive && ally.team === target.team) {
        const allyDist = distance(ally.pos, target.pos);
        if (allyDist < 150) {
          ally.morale = Math.max(0.1, ally.morale - 0.15);
        }
      }
    }

    const critText = isCrit ? ' (CRITICAL)' : '';
    return `${unit.team === 'player' ? 'Friendly' : 'Enemy'} ${unit.type} destroyed enemy ${target.type}${critText}`;
  }
  return null;
}

export function getUnitsInRect(units: Unit[], x1: number, y1: number, x2: number, y2: number, team: Team): Unit[] {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return units.filter(u => u.alive && u.team === team && u.pos.x >= minX && u.pos.x <= maxX && u.pos.y >= minY && u.pos.y <= maxY);
}
