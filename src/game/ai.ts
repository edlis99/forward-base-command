import { GameState, Unit, TerrainCell } from './types';
import { createUnit, distance, angleBetween } from './units';
import { getTerrainAt, hasLineOfSight, isPassable } from './terrain';
import { ENEMY_SPAWN, CELL_SIZE, ENEMY_SPAWN_INTERVAL, MAX_WAVES, MAP_COLS, MAP_ROWS } from './constants';

const WAVE_COMPOSITIONS: { type: 'infantry' | 'tank' | 'apc' | 'helicopter'; count: number }[][] = [
  [{ type: 'infantry', count: 4 }],
  [{ type: 'infantry', count: 3 }, { type: 'apc', count: 1 }],
  [{ type: 'infantry', count: 4 }, { type: 'tank', count: 1 }],
  [{ type: 'infantry', count: 3 }, { type: 'apc', count: 2 }, { type: 'tank', count: 1 }],
  [{ type: 'infantry', count: 4 }, { type: 'tank', count: 2 }, { type: 'helicopter', count: 1 }],
  [{ type: 'infantry', count: 5 }, { type: 'tank', count: 2 }, { type: 'apc', count: 2 }],
  [{ type: 'infantry', count: 4 }, { type: 'tank', count: 3 }, { type: 'helicopter', count: 2 }],
  [{ type: 'infantry', count: 6 }, { type: 'tank', count: 2 }, { type: 'apc', count: 3 }, { type: 'helicopter', count: 1 }],
  [{ type: 'infantry', count: 5 }, { type: 'tank', count: 4 }, { type: 'helicopter', count: 3 }],
  [{ type: 'infantry', count: 8 }, { type: 'tank', count: 4 }, { type: 'apc', count: 3 }, { type: 'helicopter', count: 3 }],
];

type AIStrategy = 'rush' | 'flank' | 'focus_fire' | 'retreat' | 'seek_cover';

function chooseStrategy(state: GameState, enemyUnits: Unit[], playerUnits: Unit[]): AIStrategy {
  const enemyStrength = enemyUnits.reduce((s, u) => s + u.health, 0);
  const playerStrength = playerUnits.reduce((s, u) => s + u.health, 0);
  const ratio = enemyStrength / Math.max(playerStrength, 1);
  const suppressedCount = enemyUnits.filter(u => u.suppression > 0.5).length;
  const suppressedRatio = suppressedCount / Math.max(enemyUnits.length, 1);

  if (ratio < 0.3 && enemyUnits.length > 0) return 'retreat';
  if (suppressedRatio > 0.5) return 'seek_cover';
  if (ratio > 2.0) return 'rush';
  if (ratio > 0.7 && Math.random() < 0.4) return 'flank';
  return 'focus_fire';
}

function findNearestCover(state: GameState, unit: Unit): { x: number; y: number } | null {
  const gx = Math.floor(unit.pos.x / CELL_SIZE);
  const gy = Math.floor(unit.pos.y / CELL_SIZE);
  const veh = unit.type === 'tank' || unit.type === 'apc';
  const heli = unit.type === 'helicopter';
  let bestDist = Infinity;
  let bestPos: { x: number; y: number } | null = null;
  const searchR = 8;

  for (let dy = -searchR; dy <= searchR; dy++) {
    for (let dx = -searchR; dx <= searchR; dx++) {
      const tx = gx + dx, ty = gy + dy;
      if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) continue;
      const cell = state.terrain[ty][tx];
      if (!isPassable(cell, veh, heli)) continue;
      if (cell.coverBonus >= 0.25) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < bestDist) {
          bestDist = d;
          bestPos = { x: tx * CELL_SIZE + CELL_SIZE / 2, y: ty * CELL_SIZE + CELL_SIZE / 2 };
        }
      }
    }
  }
  return bestPos;
}

function canEngage(unit: Unit, target: Unit, state: GameState): boolean {
  if (distance(unit.pos, target.pos) > unit.range) return false;
  return hasLineOfSight(state.terrain, unit.pos.x, unit.pos.y, target.pos.x, target.pos.y, unit.type === 'helicopter');
}

export function updateAI(state: GameState, dt: number): string[] {
  const messages: string[] = [];

  // Spawn waves
  state.enemySpawnTimer -= dt;
  if (state.enemySpawnTimer <= 0 && state.wave < MAX_WAVES) {
    const comp = WAVE_COMPOSITIONS[Math.min(state.wave, WAVE_COMPOSITIONS.length - 1)];
    let offset = 0;
    for (const group of comp) {
      for (let i = 0; i < group.count; i++) {
        const spawnX = ENEMY_SPAWN.x * CELL_SIZE + (Math.random() - 0.5) * 100;
        const spawnY = ENEMY_SPAWN.y * CELL_SIZE + offset * 40 + (Math.random() - 0.5) * 60;
        const unit = createUnit(group.type, 'enemy', spawnX, spawnY);
        unit.stance = 'aggressive';
        if (state.wave >= 5) {
          unit.veterancy = 1;
          unit.damage *= 1.1;
          unit.accuracy = Math.min(0.9, unit.accuracy * 1.1);
        }
        if (state.wave >= 8) {
          unit.veterancy = 2;
          unit.damage *= 1.1;
          unit.accuracy = Math.min(0.9, unit.accuracy * 1.1);
        }
        state.units.push(unit);
        offset++;
      }
    }
    state.wave++;
    state.enemySpawnTimer = ENEMY_SPAWN_INTERVAL;
    messages.push(`Wave ${state.wave} incoming!`);
  }

  const enemyUnits = state.units.filter(u => u.alive && u.team === 'enemy' && !u.insideOf);
  const playerUnits = state.units.filter(u => u.alive && u.team === 'player' && !u.insideOf);

  if (enemyUnits.length === 0 || playerUnits.length === 0) return messages;

  const strategy = chooseStrategy(state, enemyUnits, playerUnits);

  for (const enemy of enemyUnits) {
    // Recently hit but no target acquired → suppression-fire toward last damage source bias
    let closestDist = Infinity;
    let closestTarget: Unit | null = null;
    let closestEngageable: Unit | null = null;
    let closestEngageableDist = Infinity;

    for (const player of playerUnits) {
      const dist = distance(enemy.pos, player.pos);
      if (dist < closestDist) {
        closestDist = dist;
        closestTarget = player;
      }
      if (canEngage(enemy, player, state) && dist < closestEngageableDist) {
        closestEngageableDist = dist;
        closestEngageable = player;
      }
    }
    if (!closestTarget) continue;

    // APC carrying infantry: when near enemy, dismount
    if (enemy.type === 'apc' && enemy.passengers.length > 0 && closestDist < 250) {
      for (const pid of [...enemy.passengers]) {
        const p = state.units.find(u => u.id === pid);
        if (p) {
          p.insideOf = null;
          p.pos = { x: enemy.pos.x + (Math.random() - 0.5) * 30, y: enemy.pos.y + (Math.random() - 0.5) * 30 };
          p.stance = 'aggressive';
        }
      }
      enemy.passengers = [];
    }

    switch (strategy) {
      case 'seek_cover': {
        if (closestEngageable) {
          enemy.attackTarget = closestEngageable.id;
          enemy.targetPos = null;
        } else {
          const coverPos = findNearestCover(state, enemy);
          enemy.targetPos = coverPos ?? { x: closestTarget.pos.x, y: closestTarget.pos.y };
          enemy.attackTarget = null;
        }
        break;
      }
      case 'retreat': {
        if (enemy.health / enemy.maxHealth < 0.3 || enemy.morale < 0.3) {
          const coverPos = findNearestCover(state, enemy);
          if (coverPos) enemy.targetPos = coverPos;
          else {
            const retreatX = enemy.pos.x + (enemy.pos.x - closestTarget.pos.x) * 0.5;
            const retreatY = enemy.pos.y + (enemy.pos.y - closestTarget.pos.y) * 0.5;
            enemy.targetPos = { x: retreatX, y: retreatY };
          }
          enemy.attackTarget = null;
        } else if (closestEngageable) {
          enemy.attackTarget = closestEngageable.id;
          enemy.targetPos = null;
        } else {
          enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
        }
        break;
      }
      case 'flank': {
        if (closestEngageable) {
          enemy.attackTarget = closestEngageable.id;
          enemy.targetPos = null;
        } else {
          const angle = angleBetween(enemy.pos, closestTarget.pos);
          const flankAngle = angle + (Math.random() > 0.5 ? Math.PI / 3 : -Math.PI / 3);
          const flankDist = Math.min(closestDist, enemy.range * 0.8);
          const flankX = closestTarget.pos.x - Math.cos(flankAngle) * flankDist;
          const flankY = closestTarget.pos.y - Math.sin(flankAngle) * flankDist;
          const veh = enemy.type === 'tank' || enemy.type === 'apc';
          const heli = enemy.type === 'helicopter';
          const flankTerrain = getTerrainAt(state.terrain, flankX, flankY);
          if (isPassable(flankTerrain, veh, heli)) enemy.targetPos = { x: flankX, y: flankY };
          else enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          enemy.attackTarget = null;
        }
        break;
      }
      case 'rush': {
        if (closestEngageable) {
          enemy.attackTarget = closestEngageable.id;
          enemy.targetPos = null;
        } else {
          enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          enemy.attackTarget = null;
        }
        break;
      }
      case 'focus_fire':
      default: {
        if (closestEngageable) {
          enemy.attackTarget = closestEngageable.id;
          enemy.targetPos = null;
        } else {
          const coverPos = findNearestCover(state, enemy);
          const coverToTarget = coverPos ? distance(coverPos, closestTarget.pos) : Infinity;
          if (coverPos && coverToTarget < closestDist) enemy.targetPos = coverPos;
          else enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          enemy.attackTarget = null;
        }

        // Focus weakest visible
        let weakestInRange: Unit | null = null;
        let lowestHp = Infinity;
        for (const player of playerUnits) {
          if (canEngage(enemy, player, state) && player.health < lowestHp) {
            lowestHp = player.health;
            weakestInRange = player;
          }
        }
        if (weakestInRange) enemy.attackTarget = weakestInRange.id;
        break;
      }
    }

    // Type-specific overrides
    if (enemy.type === 'tank') {
      const vehicleTarget = playerUnits.find(p =>
        (p.type === 'tank' || p.type === 'apc') && canEngage(enemy, p, state)
      );
      if (vehicleTarget) enemy.attackTarget = vehicleTarget.id;
    }
    if (enemy.type === 'helicopter') {
      // Strafe behavior: orbit a bit if engaged
      let mostIsolated: Unit | null = null;
      let maxIsolation = 0;
      for (const player of playerUnits) {
        if (!canEngage(enemy, player, state)) continue;
        const nearbyAllies = playerUnits.filter(p => p.id !== player.id && distance(p.pos, player.pos) < 100).length;
        const isolation = 1 / (nearbyAllies + 1);
        if (isolation > maxIsolation) {
          maxIsolation = isolation;
          mostIsolated = player;
        }
      }
      if (mostIsolated) {
        enemy.attackTarget = mostIsolated.id;
        // Orbit
        const a = angleBetween(enemy.pos, mostIsolated.pos) + Math.PI / 2;
        enemy.targetPos = {
          x: mostIsolated.pos.x + Math.cos(a) * (enemy.range * 0.8),
          y: mostIsolated.pos.y + Math.sin(a) * (enemy.range * 0.8),
        };
      }
    }

    if (enemy.type === 'infantry' && !enemy.inCover && !closestEngageable) {
      const coverPos = findNearestCover(state, enemy);
      if (coverPos && distance(coverPos, closestTarget.pos) < enemy.range * 1.2) {
        enemy.targetPos = coverPos;
      }
    }
  }

  return messages;
}

export function checkGameOver(state: GameState): { over: boolean; result: 'win' | 'lose' | null } {
  const playerAlive = state.units.some(u => u.alive && u.team === 'player');
  const enemyAlive = state.units.some(u => u.alive && u.team === 'enemy');
  if (!playerAlive) return { over: true, result: 'lose' };
  if (!enemyAlive && state.wave >= MAX_WAVES) return { over: true, result: 'win' };
  return { over: false, result: null };
}
