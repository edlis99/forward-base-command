import { GameState, Unit } from './types';
import { createUnit, distance } from './units';
import { ENEMY_SPAWN, CELL_SIZE, ENEMY_SPAWN_INTERVAL, MAX_WAVES } from './constants';

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
        state.units.push(createUnit(group.type, 'enemy', spawnX, spawnY));
        offset++;
      }
    }
    state.wave++;
    state.enemySpawnTimer = ENEMY_SPAWN_INTERVAL;
    messages.push(`Wave ${state.wave} incoming!`);
  }

  // AI unit behavior
  const enemyUnits = state.units.filter(u => u.alive && u.team === 'enemy');
  const playerUnits = state.units.filter(u => u.alive && u.team === 'player');

  for (const enemy of enemyUnits) {
    // Find closest player unit
    let closestDist = Infinity;
    let closestTarget: Unit | null = null;
    for (const player of playerUnits) {
      const dist = distance(enemy.pos, player.pos);
      if (dist < closestDist) {
        closestDist = dist;
        closestTarget = player;
      }
    }

    if (!closestTarget) continue;

    // If in range, attack; otherwise move toward target
    if (closestDist <= enemy.range) {
      enemy.attackTarget = closestTarget.id;
      enemy.targetPos = null;
    } else {
      enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
      enemy.attackTarget = null;
    }

    // Prioritize weakest target in range
    let weakestInRange: Unit | null = null;
    let lowestHp = Infinity;
    for (const player of playerUnits) {
      const dist = distance(enemy.pos, player.pos);
      if (dist <= enemy.range && player.health < lowestHp) {
        lowestHp = player.health;
        weakestInRange = player;
      }
    }
    if (weakestInRange) {
      enemy.attackTarget = weakestInRange.id;
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
