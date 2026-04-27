import { GameState, InputState, AbilityType } from './types';
import { generateTerrain } from './terrain';
import { createUnit, moveUnit, updateCombat, getUnitsInRect, checkVeterancy } from './units';
import { createAbilities, activateAbility, updateEffects, updateFogOfWar } from './abilities';
import { updateAI, checkGameOver } from './ai';
import { render } from './renderer';
import {
  CELL_SIZE, MAP_COLS, MAP_ROWS, STARTING_CP, CP_RATE, CP_PER_KILL,
  PLAYER_SPAWN, ENEMY_SPAWN, ENEMY_SPAWN_INTERVAL, CP_STREAK_BONUS, CP_WAVE_CLEAR_BONUS,
} from './constants';

export function createInitialState(): GameState {
  const terrain = generateTerrain();
  const fogOfWar = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(true));
  const revealed = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(false));

  const state: GameState = {
    units: [],
    terrain,
    mapWidth: MAP_COLS * CELL_SIZE,
    mapHeight: MAP_ROWS * CELL_SIZE,
    cellSize: CELL_SIZE,
    camera: { x: PLAYER_SPAWN.x * CELL_SIZE - 400, y: PLAYER_SPAWN.y * CELL_SIZE - 300 },
    zoom: 1,
    commandPoints: STARTING_CP,
    commandPointRate: CP_RATE,
    abilities: createAbilities(),
    activeEffects: [],
    projectiles: [],
    wreckage: [],
    eventLog: [],
    fogOfWar,
    revealed,
    selectionBox: null,
    activeAbility: null,
    gameOver: false,
    gameResult: null,
    wave: 0,
    enemySpawnTimer: 5,
    time: 0,
    killStreak: 0,
    totalKills: 0,
    waveBonus: 0,
  };

  const px = PLAYER_SPAWN.x * CELL_SIZE;
  const py = PLAYER_SPAWN.y * CELL_SIZE;
  state.units.push(createUnit('infantry', 'player', px, py - 60));
  state.units.push(createUnit('infantry', 'player', px, py - 20));
  state.units.push(createUnit('infantry', 'player', px, py + 20));
  state.units.push(createUnit('tank', 'player', px + 40, py));
  state.units.push(createUnit('apc', 'player', px - 30, py + 40));

  return state;
}

export function createInputState(): InputState {
  return {
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseWorldPos: { x: 0, y: 0 },
    isDragging: false,
    isPanning: false,
    dragStart: null,
  };
}

export function update(state: GameState, input: InputState, dt: number) {
  if (state.gameOver) return;

  state.time += dt;

  // Camera movement
  const camSpeed = 400 * dt;
  if (input.keys.has('w') || input.keys.has('arrowup')) state.camera.y -= camSpeed;
  if (input.keys.has('s') || input.keys.has('arrowdown')) state.camera.y += camSpeed;
  if (input.keys.has('a') || input.keys.has('arrowleft')) state.camera.x -= camSpeed;
  if (input.keys.has('d') || input.keys.has('arrowright')) state.camera.x += camSpeed;

  state.camera.x = Math.max(0, Math.min(state.mapWidth - 800, state.camera.x));
  state.camera.y = Math.max(0, Math.min(state.mapHeight - 600, state.camera.y));

  // Command points
  state.commandPoints += state.commandPointRate * dt;

  // Process boarding intents (infantry → APC)
  for (const unit of state.units) {
    if (!unit.alive) continue;
    const intent = (unit as any)._boardTarget;
    if (intent) {
      const apc = state.units.find(u => u.id === intent && u.alive && u.type === 'apc');
      if (!apc) { (unit as any)._boardTarget = null; continue; }
      if (Math.hypot(apc.pos.x - unit.pos.x, apc.pos.y - unit.pos.y) < 25 && apc.passengers.length < 4) {
        unit.insideOf = apc.id;
        apc.passengers.push(unit.id);
        unit.targetPos = null;
        unit.attackTarget = null;
        (unit as any)._boardTarget = null;
        state.eventLog.unshift({ message: `${unit.type} boarded APC`, time: state.time, type: 'info' });
      } else {
        // Keep moving toward APC
        unit.targetPos = { x: apc.pos.x, y: apc.pos.y };
      }
    }
  }

  // Move units (skip passengers — handled implicitly: moveUnit returns early)
  for (const unit of state.units) {
    if (unit.alive) moveUnit(unit, dt, state);
  }

  // Hold position: drift back if pushed off
  for (const unit of state.units) {
    if (!unit.alive || unit.order !== 'hold_position') continue;
    const d = Math.hypot(unit.pos.x - unit.homePos.x, unit.pos.y - unit.homePos.y);
    if (d > 40 && !unit.targetPos) unit.targetPos = { ...unit.homePos };
  }

  const prevEnemyCount = state.units.filter(u => u.alive && u.team === 'enemy').length;

  // Combat
  for (const unit of state.units) {
    const msg = updateCombat(unit, dt, state);
    if (msg) {
      state.eventLog.unshift({ message: msg, time: state.time, type: 'kill' });
      if (state.eventLog.length > 20) state.eventLog.pop();

      const killedUnit = state.units.find(u => !u.alive && u.health <= 0);
      if (killedUnit) {
        if (killedUnit.team === 'enemy') {
          state.totalKills++;
          state.killStreak++;

          const streakBonus = Math.min(state.killStreak * CP_STREAK_BONUS, 50);
          const totalReward = CP_PER_KILL + streakBonus;
          state.commandPoints += totalReward;

          if (state.killStreak >= 3) {
            state.eventLog.unshift({
              message: `Kill streak x${state.killStreak}! +${totalReward} CP`,
              time: state.time,
              type: 'reward',
            });
          }

          const vetMsg = checkVeterancy(unit, state);
          if (vetMsg) {
            state.eventLog.unshift({ message: vetMsg, time: state.time, type: 'reward' });
          }
        } else {
          state.killStreak = 0;
        }
        state.wreckage.push({ pos: { ...killedUnit.pos }, type: killedUnit.type, timer: 60 });
      }
    }
  }

  // Wave clear bonus
  const currentEnemyCount = state.units.filter(u => u.alive && u.team === 'enemy').length;
  if (prevEnemyCount > 0 && currentEnemyCount === 0 && state.wave > 0) {
    state.commandPoints += CP_WAVE_CLEAR_BONUS;
    state.eventLog.unshift({
      message: `Wave cleared! +${CP_WAVE_CLEAR_BONUS} CP bonus`,
      time: state.time,
      type: 'reward',
    });
  }

  // Remove dead units
  state.units = state.units.filter(u => u.alive || u.health > -9999);

  // Update projectile timers
  state.projectiles = state.projectiles.filter(p => {
    p.timer -= dt;
    return p.timer > 0;
  });

  // Effects
  const effectMsgs = updateEffects(state, dt);
  for (const msg of effectMsgs) {
    state.eventLog.unshift({ message: msg, time: state.time, type: 'ability' });
  }

  // AI
  const aiMsgs = updateAI(state, dt);
  for (const msg of aiMsgs) {
    state.eventLog.unshift({ message: msg, time: state.time, type: 'spawn' });
  }

  // Fog of war
  updateFogOfWar(state);

  // Wreckage timer
  state.wreckage = state.wreckage.filter(w => { w.timer -= dt; return w.timer > 0; });

  // Game over check
  const result = checkGameOver(state);
  if (result.over) {
    state.gameOver = true;
    state.gameResult = result.result;
  }
}

export function screenToWorld(screenX: number, screenY: number, state: GameState): { x: number; y: number } {
  return {
    x: screenX / state.zoom + state.camera.x,
    y: screenY / state.zoom + state.camera.y,
  };
}

export function handleLeftClick(worldX: number, worldY: number, state: GameState, shiftKey: boolean) {
  if (state.activeAbility) {
    const effect = activateAbility(state.activeAbility, { x: worldX, y: worldY }, state.abilities, state);
    if (effect) {
      state.activeEffects.push(effect);
      state.eventLog.unshift({
        message: `${state.activeAbility.replace('_', ' ')} deployed`,
        time: state.time,
        type: 'ability',
      });
    }
    state.activeAbility = null;
    return;
  }

  if (!shiftKey) {
    state.units.forEach(u => u.selected = false);
  }

  for (const unit of state.units) {
    if (!unit.alive || unit.team !== 'player') continue;
    const dx = unit.pos.x - worldX;
    const dy = unit.pos.y - worldY;
    if (Math.sqrt(dx * dx + dy * dy) < 18) {
      unit.selected = !unit.selected || !shiftKey;
      return;
    }
  }
}

export function handleRightClick(worldX: number, worldY: number, state: GameState, shiftKey: boolean = false, ctrlKey: boolean = false) {
  const selected = state.units.filter(u => u.alive && u.selected && u.team === 'player');
  if (selected.length === 0) return;

  // Right-click on enemy = attack order
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== 'enemy') continue;
    const dx = unit.pos.x - worldX;
    const dy = unit.pos.y - worldY;
    if (Math.sqrt(dx * dx + dy * dy) < 18) {
      selected.forEach(u => {
        u.attackTarget = unit.id;
        u.targetPos = { x: worldX, y: worldY };
        u.waypoints = [];
        u.order = 'attack';
      });
      return;
    }
  }

  // Right-click on friendly APC = enter as passenger (infantry only)
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== 'player' || unit.type !== 'apc') continue;
    const dx = unit.pos.x - worldX;
    const dy = unit.pos.y - worldY;
    if (Math.sqrt(dx * dx + dy * dy) < 22) {
      selected.forEach(u => {
        if (u.type === 'infantry' && u.id !== unit.id && unit.passengers.length < 4) {
          u.targetPos = { x: unit.pos.x, y: unit.pos.y };
          u.attackTarget = null;
          u.order = 'move';
          // mark intent — actual board occurs in engine update on proximity
          (u as any)._boardTarget = unit.id;
        }
      });
      return;
    }
  }

  // Move / attack-move / formation
  const centerX = selected.reduce((s, u) => s + u.pos.x, 0) / selected.length;
  const centerY = selected.reduce((s, u) => s + u.pos.y, 0) / selected.length;

  selected.forEach(u => {
    const offsetX = u.pos.x - centerX;
    const offsetY = u.pos.y - centerY;
    const dest = { x: worldX + offsetX, y: worldY + offsetY };
    if (shiftKey) {
      // Queue waypoint
      u.waypoints.push(dest);
      if (!u.targetPos) u.targetPos = u.waypoints.shift()!;
    } else {
      u.waypoints = [];
      u.targetPos = dest;
      u.attackTarget = null;
      u.order = ctrlKey ? 'attack_move' : 'move';
    }
  });
}

export function handleBoxSelect(x1: number, y1: number, x2: number, y2: number, state: GameState, shiftKey: boolean) {
  if (!shiftKey) state.units.forEach(u => u.selected = false);
  const units = getUnitsInRect(state.units, x1, y1, x2, y2, 'player');
  units.forEach(u => u.selected = true);
}

export function setStanceForSelected(state: GameState, stance: 'hold_fire' | 'defend' | 'aggressive') {
  state.units.filter(u => u.alive && u.selected && u.team === 'player').forEach(u => u.stance = stance);
}

export function holdPositionForSelected(state: GameState) {
  state.units.filter(u => u.alive && u.selected && u.team === 'player').forEach(u => {
    u.targetPos = null;
    u.waypoints = [];
    u.order = 'hold_position';
    u.homePos = { ...u.pos };
  });
}

export function retreatSelected(state: GameState) {
  // Retreat = move back toward player spawn
  const sel = state.units.filter(u => u.alive && u.selected && u.team === 'player');
  for (const u of sel) {
    u.targetPos = { x: PLAYER_SPAWN.x * CELL_SIZE, y: PLAYER_SPAWN.y * CELL_SIZE };
    u.waypoints = [];
    u.attackTarget = null;
    u.order = 'retreat';
  }
}

export function spawnUnit(type: 'infantry' | 'tank' | 'apc' | 'helicopter', state: GameState) {
  const { cost } = { infantry: { cost: 50 }, tank: { cost: 150 }, apc: { cost: 100 }, helicopter: { cost: 200 } }[type];
  if (state.commandPoints < cost) return;

  state.commandPoints -= cost;
  const px = PLAYER_SPAWN.x * CELL_SIZE + (Math.random() - 0.5) * 60;
  const py = PLAYER_SPAWN.y * CELL_SIZE + (Math.random() - 0.5) * 60;
  const unit = createUnit(type, 'player', px, py);
  state.units.push(unit);
  state.eventLog.unshift({ message: `${type} deployed`, time: state.time, type: 'spawn' });
}

export { render };
