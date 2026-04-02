import { Ability, ActiveEffect, AbilityType, Position, GameState } from './types';
import { distance } from './units';

export function createAbilities(): Ability[] {
  return [
    {
      type: 'recon_drone',
      name: 'Recon Drone',
      cooldown: 30,
      currentCooldown: 0,
      duration: 10,
      radius: 200,
      description: 'Reveals fog of war in target area (Q)',
      key: 'q',
    },
    {
      type: 'airstrike',
      name: 'Airstrike',
      cooldown: 60,
      currentCooldown: 0,
      duration: 1,
      radius: 80,
      description: 'Heavy damage in target zone after 3s delay (W)',
      key: 'w',
    },
    {
      type: 'smoke_screen',
      name: 'Smoke Screen',
      cooldown: 25,
      currentCooldown: 0,
      duration: 12,
      radius: 100,
      description: 'Blocks line of sight in area (E)',
      key: 'e',
    },
  ];
}

export function activateAbility(type: AbilityType, pos: Position, abilities: Ability[]): ActiveEffect | null {
  const ability = abilities.find(a => a.type === type);
  if (!ability || ability.currentCooldown > 0) return null;

  ability.currentCooldown = ability.cooldown;

  return {
    type,
    pos: { ...pos },
    radius: ability.radius,
    timeLeft: ability.duration + (type === 'airstrike' ? 3 : 0),
    delay: type === 'airstrike' ? 3 : 0,
  };
}

export function updateEffects(state: GameState, dt: number): string[] {
  const messages: string[] = [];

  for (const ability of state.abilities) {
    ability.currentCooldown = Math.max(0, ability.currentCooldown - dt);
  }

  for (let i = state.activeEffects.length - 1; i >= 0; i--) {
    const effect = state.activeEffects[i];
    effect.timeLeft -= dt;

    if (effect.type === 'airstrike' && effect.delay > 0) {
      effect.delay -= dt;
      if (effect.delay <= 0) {
        // Deal damage to all units in radius
        for (const unit of state.units) {
          if (!unit.alive) continue;
          const dist = distance(unit.pos, effect.pos);
          if (dist <= effect.radius) {
            const dmg = 120 * (1 - dist / effect.radius);
            unit.health -= dmg;
            if (unit.health <= 0) {
              unit.alive = false;
              messages.push(`Airstrike destroyed ${unit.team} ${unit.type}`);
            }
          }
        }
      }
    }

    if (effect.timeLeft <= 0) {
      state.activeEffects.splice(i, 1);
    }
  }

  return messages;
}

export function updateFogOfWar(state: GameState) {
  const { fogOfWar, units, terrain, activeEffects } = state;
  const cols = terrain[0].length;
  const rows = terrain.length;
  const cs = state.cellSize;

  // Reset fog (keep revealed for already-seen areas)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      fogOfWar[y][x] = true; // fog on by default
    }
  }

  // Player units reveal fog
  for (const unit of units) {
    if (!unit.alive || unit.team !== 'player') continue;
    const sight = unit.sightRange;
    const cx = Math.floor(unit.pos.x / cs);
    const cy = Math.floor(unit.pos.y / cs);
    const r = Math.ceil(sight / cs);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
        const dist = Math.sqrt(dx * dx + dy * dy) * cs;
        if (dist <= sight) {
          fogOfWar[gy][gx] = false;
          state.revealed[gy][gx] = true;
        }
      }
    }
  }

  // Recon drone reveals fog
  for (const effect of activeEffects) {
    if (effect.type === 'recon_drone') {
      const cx = Math.floor(effect.pos.x / cs);
      const cy = Math.floor(effect.pos.y / cs);
      const r = Math.ceil(effect.radius / cs);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
          const dist = Math.sqrt(dx * dx + dy * dy) * cs;
          if (dist <= effect.radius) {
            fogOfWar[gy][gx] = false;
            state.revealed[gy][gx] = true;
          }
        }
      }
    }
  }
}
