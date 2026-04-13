import { GameState, Unit } from './types';
import { createUnit, distance, angleBetween } from './units';
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

// AI strategy types
type AIStrategy = 'rush' | 'flank' | 'focus_fire' | 'retreat';

function chooseStrategy(state: GameState, enemyUnits: Unit[], playerUnits: Unit[]): AIStrategy {
  const enemyStrength = enemyUnits.reduce((s, u) => s + u.health, 0);
  const playerStrength = playerUnits.reduce((s, u) => s + u.health, 0);
  const ratio = enemyStrength / Math.max(playerStrength, 1);

  // Retreat if heavily outmatched
  if (ratio < 0.3 && enemyUnits.length > 0) return 'retreat';
  // Rush if overwhelming advantage
  if (ratio > 2.0) return 'rush';
  // Flank if roughly even
  if (ratio > 0.7 && Math.random() < 0.4) return 'flank';
  // Default: focus fire
  return 'focus_fire';
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
        // Later waves get veterancy boost
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

  // AI unit behavior with strategy
  const enemyUnits = state.units.filter(u => u.alive && u.team === 'enemy');
  const playerUnits = state.units.filter(u => u.alive && u.team === 'player');

  if (enemyUnits.length === 0 || playerUnits.length === 0) return messages;

  const strategy = chooseStrategy(state, enemyUnits, playerUnits);

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

    switch (strategy) {
      case 'retreat': {
        // Move away from player units if low morale/health
        if (enemy.health / enemy.maxHealth < 0.3 || enemy.morale < 0.3) {
          const retreatX = enemy.pos.x + (enemy.pos.x - closestTarget.pos.x) * 0.5;
          const retreatY = enemy.pos.y + (enemy.pos.y - closestTarget.pos.y) * 0.5;
          enemy.targetPos = { x: retreatX, y: retreatY };
          enemy.attackTarget = null;
        } else {
          // Others still fight
          if (closestDist <= enemy.range) {
            enemy.attackTarget = closestTarget.id;
            enemy.targetPos = null;
          } else {
            enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          }
        }
        break;
      }
      case 'flank': {
        // Try to approach from the side
        if (closestDist <= enemy.range) {
          enemy.attackTarget = closestTarget.id;
          enemy.targetPos = null;
        } else {
          const angle = angleBetween(enemy.pos, closestTarget.pos);
          const flankAngle = angle + (Math.random() > 0.5 ? Math.PI / 3 : -Math.PI / 3);
          const flankDist = Math.min(closestDist, enemy.range * 0.8);
          enemy.targetPos = {
            x: closestTarget.pos.x - Math.cos(flankAngle) * flankDist,
            y: closestTarget.pos.y - Math.sin(flankAngle) * flankDist,
          };
          enemy.attackTarget = null;
        }
        break;
      }
      case 'rush': {
        // Aggressive: charge straight at closest target
        if (closestDist <= enemy.range) {
          enemy.attackTarget = closestTarget.id;
          enemy.targetPos = null;
        } else {
          enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          enemy.attackTarget = null;
        }
        break;
      }
      case 'focus_fire':
      default: {
        // Focus weakest target in range, otherwise move toward closest
        if (closestDist <= enemy.range) {
          enemy.attackTarget = closestTarget.id;
          enemy.targetPos = null;
        } else {
          enemy.targetPos = { x: closestTarget.pos.x, y: closestTarget.pos.y };
          enemy.attackTarget = null;
        }

        // Override: focus weakest in range
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
        break;
      }
    }

    // Coordinated targeting: tanks should prioritize vehicles
    if (enemy.type === 'tank') {
      const vehicleTarget = playerUnits.find(p => 
        (p.type === 'tank' || p.type === 'apc') && distance(enemy.pos, p.pos) <= enemy.range
      );
      if (vehicleTarget) enemy.attackTarget = vehicleTarget.id;
    }

    // Helicopters prioritize isolated units
    if (enemy.type === 'helicopter') {
      let mostIsolated: Unit | null = null;
      let maxIsolation = 0;
      for (const player of playerUnits) {
        if (distance(enemy.pos, player.pos) > enemy.range) continue;
        const nearbyAllies = playerUnits.filter(p => p.id !== player.id && distance(p.pos, player.pos) < 100).length;
        const isolation = 1 / (nearbyAllies + 1);
        if (isolation > maxIsolation) {
          maxIsolation = isolation;
          mostIsolated = player;
        }
      }
      if (mostIsolated) enemy.attackTarget = mostIsolated.id;
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
