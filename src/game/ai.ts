import { GameState, Unit, TerrainCell } from './types';
import { createUnit, distance, angleBetween } from './units';
import { getTerrainAt, hasLineOfSight } from './terrain';
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

  // Check if many units are suppressed
  const suppressedCount = enemyUnits.filter(u => u.suppression > 0.5).length;
  const suppressedRatio = suppressedCount / Math.max(enemyUnits.length, 1);

  if (ratio < 0.3 && enemyUnits.length > 0) return 'retreat';
  if (suppressedRatio > 0.5) return 'seek_cover'; // under heavy fire, find cover
  if (ratio > 2.0) return 'rush';
  if (ratio > 0.7 && Math.random() < 0.4) return 'flank';
  return 'focus_fire';
}

/** Find nearest cell with cover that isn't blocked */
function findNearestCover(state: GameState, unit: Unit): { x: number; y: number } | null {
  const gx = Math.floor(unit.pos.x / CELL_SIZE);
  const gy = Math.floor(unit.pos.y / CELL_SIZE);
  let bestDist = Infinity;
  let bestPos: { x: number; y: number } | null = null;
  const searchR = 8;

  for (let dy = -searchR; dy <= searchR; dy++) {
    for (let dx = -searchR; dx <= searchR; dx++) {
      const tx = gx + dx;
      const ty = gy + dy;
      if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) continue;
      const cell = state.terrain[ty][tx];
      if (cell.blocksMovement) continue;
      if (cell.coverBonus >= 0.25) { // meaningful cover
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

/** Check if unit can fire at target (range + LOS) */
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

  const enemyUnits = state.units.filter(u => u.alive && u.team === 'enemy');
  const playerUnits = state.units.filter(u => u.alive && u.team === 'player');

  if (enemyUnits.length === 0 || playerUnits.length === 0) return messages;

  const strategy = chooseStrategy(state, enemyUnits, playerUnits);

  for (const enemy of enemyUnits) {
    // Find closest VISIBLE player unit
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

    switch (strategy) {
      case 'seek_cover': {
        // If can shoot, stay and shoot. Otherwise find cover.
        if (closestEngageable) {
          enemy.attackTarget = closestEngageable.id;
          enemy.targetPos = null;
        } else {
          const coverPos = findNearestCover(state, enemy);
          if (coverPos) {
            enemy.targetPos = coverPos;
          } else {
            enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          }
          enemy.attackTarget = null;
        }
        break;
      }
      case 'retreat': {
        if (enemy.health / enemy.maxHealth < 0.3 || enemy.morale < 0.3) {
          // Retreat toward cover, not just backward
          const coverPos = findNearestCover(state, enemy);
          if (coverPos) {
            enemy.targetPos = coverPos;
          } else {
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
          // Avoid moving into walls
          const flankTerrain = getTerrainAt(state.terrain, flankX, flankY);
          if (flankTerrain && !flankTerrain.blocksMovement) {
            enemy.targetPos = { x: flankX, y: flankY };
          } else {
            enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          }
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
          // Move toward target, preferring cover along the way
          const coverPos = findNearestCover(state, enemy);
          const coverToTarget = coverPos ? distance(coverPos, closestTarget.pos) : Infinity;
          if (coverPos && coverToTarget < closestDist) {
            enemy.targetPos = coverPos;
          } else {
            enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          }
          enemy.attackTarget = null;
        }

        // Override: focus weakest visible target in range
        let weakestInRange: Unit | null = null;
        let lowestHp = Infinity;
        for (const player of playerUnits) {
          if (canEngage(enemy, player, state) && player.health < lowestHp) {
            lowestHp = player.health;
            weakestInRange = player;
          }
        }
        if (weakestInRange) {
          enemy.attackTarget = weakestInRange.id;
        }
        break;
      }
    }

    // Type-specific targeting overrides with LOS check
    if (enemy.type === 'tank') {
      const vehicleTarget = playerUnits.find(p => 
        (p.type === 'tank' || p.type === 'apc') && canEngage(enemy, p, state)
      );
      if (vehicleTarget) enemy.attackTarget = vehicleTarget.id;
    }

    if (enemy.type === 'helicopter') {
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
      if (mostIsolated) enemy.attackTarget = mostIsolated.id;
    }

    // Infantry: prefer to fight from cover
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
