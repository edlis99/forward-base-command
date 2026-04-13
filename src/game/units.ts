import { Unit, UnitType, Team, Position, GameState } from './types';
import { UNIT_STATS, CELL_SIZE, VETERANCY_THRESHOLDS, VETERANCY_BONUSES, CP_VETERANCY_BONUS } from './constants';
import { getTerrainAt } from './terrain';

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
    facing: team === 'player' ? 0 : Math.PI, // player faces right, enemy faces left
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

// Check if target is being flanked (attacked from behind)
export function getFlankingBonus(attacker: Unit, target: Unit): number {
  const attackAngle = angleBetween(attacker.pos, target.pos);
  const facingDiff = Math.abs(normalizeAngle(attackAngle - target.facing));
  // If attacking from behind (within 60° of rear), 40% bonus
  if (facingDiff > Math.PI * 0.67) return 0.4;
  // If attacking from side (within 60° of flank), 20% bonus
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
    // Veterancy boosts
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

  if (terrain && terrain.type === 'water' && unit.type !== 'helicopter') {
    unit.targetPos = null;
    return;
  }

  const suppressionPenalty = 1 - unit.suppression * 0.5;
  const moralePenalty = 0.7 + unit.morale * 0.3; // low morale slows units
  const speed = (unit.speed / effectiveCost) * suppressionPenalty * moralePenalty;

  const dx = unit.targetPos.x - unit.pos.x;
  const dy = unit.targetPos.y - unit.pos.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Update facing toward movement direction
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
  
  // Morale recovery (slow)
  unit.morale = Math.min(1, unit.morale + dt * 0.05);

  // Find targets
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
        closest = dist;
        target = enemy;
      }
    }
  }

  // Update facing toward target
  if (target) {
    unit.facing = angleBetween(unit.pos, target.pos);
  }

  if (!target || unit.attackTimer > 0) return null;

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

  // --- Realistic combat calculations ---
  
  // Accuracy check (miss chance)
  const vetBonus = VETERANCY_BONUSES[unit.veterancy];
  const suppressionAccPenalty = 1 - unit.suppression * 0.4;
  const moraleAccBonus = 0.8 + unit.morale * 0.2;
  const distancePenalty = 1 - (distance(unit.pos, target.pos) / unit.range) * 0.3;
  let hitChance = unit.accuracy * suppressionAccPenalty * moraleAccBonus * distancePenalty * vetBonus;
  
  // Flanking makes target easier to hit
  const flankBonus = getFlankingBonus(unit, target);
  hitChance = Math.min(0.95, hitChance + flankBonus * 0.1);

  if (Math.random() > hitChance) {
    // Miss!
    unit.attackTimer = unit.attackCooldown;
    return null;
  }

  // Damage calculation
  let dmg = unit.damage * vetBonus;

  // Critical hit
  const isCrit = Math.random() < unit.critChance * (1 + flankBonus);
  if (isCrit) dmg *= 1.8;

  // Flanking damage bonus
  dmg *= (1 + flankBonus);

  // Elevation advantage
  const attackerTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  const targetTerrain = getTerrainAt(state.terrain, target.pos.x, target.pos.y);
  const elevDiff = (attackerTerrain?.elevation ?? 1) - (targetTerrain?.elevation ?? 1);
  if (elevDiff > 0) dmg *= 1.15; // high ground bonus
  if (elevDiff < 0) dmg *= 0.9; // low ground penalty

  // Armor reduction
  const coverBonus = target.inCover ? 0.3 : 0;
  const effectiveArmor = target.armor * (1 + coverBonus);
  dmg = Math.max(dmg * (1 - effectiveArmor / (effectiveArmor + 50)), 1);

  // Type effectiveness
  if (unit.type === 'infantry' && target.type === 'infantry') dmg *= 1.2;
  if (unit.type === 'tank' && (target.type === 'tank' || target.type === 'apc')) dmg *= 1.3;
  if (unit.type === 'helicopter') dmg *= 1.1;
  if (target.type === 'helicopter' && unit.type === 'infantry') dmg *= 0.5;

  target.health -= dmg;
  target.suppression = Math.min(1, target.suppression + 0.3);
  
  // Morale damage to nearby allies of target
  for (const ally of state.units) {
    if (ally.alive && ally.team === target.team && ally.id !== target.id) {
      const allyDist = distance(ally.pos, target.pos);
      if (allyDist < 100) {
        ally.morale = Math.max(0.2, ally.morale - 0.05);
      }
    }
  }

  unit.attackTimer = unit.attackCooldown;

  if (target.health <= 0) {
    target.alive = false;
    unit.kills++;
    
    // Morale shock on nearby enemies when ally dies
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
