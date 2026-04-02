import { Unit, UnitType, Team, Position, GameState } from './types';
import { UNIT_STATS, CELL_SIZE } from './constants';
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
  };
}

export function distance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
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

  // Helicopters ignore terrain cost
  const effectiveCost = unit.type === 'helicopter' ? 1 : moveCost;
  
  // Water blocks non-helicopter units
  if (terrain && terrain.type === 'water' && unit.type !== 'helicopter') {
    unit.targetPos = null;
    return;
  }

  const suppressionPenalty = 1 - unit.suppression * 0.5;
  const speed = (unit.speed / effectiveCost) * suppressionPenalty;

  const dx = unit.targetPos.x - unit.pos.x;
  const dy = unit.targetPos.y - unit.pos.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  unit.pos.x += (dx / len) * speed * dt;
  unit.pos.y += (dy / len) * speed * dt;

  // Update cover status
  const currentTerrain = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  unit.inCover = currentTerrain ? currentTerrain.coverBonus > 0 : false;
}

export function updateCombat(unit: Unit, dt: number, state: GameState): string | null {
  if (!unit.alive) return null;

  unit.attackTimer = Math.max(0, unit.attackTimer - dt);
  unit.suppression = Math.max(0, unit.suppression - dt * 0.2);

  // Find targets
  const enemies = state.units.filter(u => u.alive && u.team !== unit.team);
  
  // If we have a specific attack target, try that first
  let target: Unit | undefined;
  if (unit.attackTarget) {
    target = enemies.find(e => e.id === unit.attackTarget && distance(unit.pos, e.pos) <= unit.range);
    if (!target) unit.attackTarget = null;
  }

  // Auto-acquire closest enemy in range
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

  if (!target || unit.attackTimer > 0) return null;

  // Check line of sight blocked by smoke
  for (const effect of state.activeEffects) {
    if (effect.type === 'smoke_screen' && effect.delay <= 0) {
      const smokeToUnit = distance(effect.pos, unit.pos);
      const smokeToTarget = distance(effect.pos, target.pos);
      if (smokeToUnit < effect.radius || smokeToTarget < effect.radius) {
        return null; // Blocked by smoke
      }
    }
  }

  // Fire!
  const suppressionPenalty = 1 - unit.suppression * 0.3;
  let dmg = unit.damage * suppressionPenalty;

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
  unit.attackTimer = unit.attackCooldown;

  if (target.health <= 0) {
    target.alive = false;
    return `${unit.team === 'player' ? 'Friendly' : 'Enemy'} ${unit.type} destroyed enemy ${target.type}`;
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
