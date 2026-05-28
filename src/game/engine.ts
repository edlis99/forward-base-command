import { GameState, InputState, MissionDef, Position } from './types';
import { generateTerrain } from './terrain';
import { setDestination, updateCombat, getUnitsInRect, checkVeterancy, moveUnit, distance } from './units';
import { updateAI } from './ai';
import { updateAwareness } from './awareness';
import { CELL_SIZE, MAP_COLS, MAP_ROWS, CP_PER_KILL, UNIT_STATS } from './constants';
import { getMission } from './missions';

export function createInitialState(mission: MissionDef): GameState {
  const terrain = generateTerrain();
  const initial = mission.init();

  const state: GameState = {
    units: [],
    terrain,
    mapWidth: MAP_COLS * CELL_SIZE,
    mapHeight: MAP_ROWS * CELL_SIZE,
    cellSize: CELL_SIZE,
    camera: { x: 200, y: 200 },
    zoom: 1,
    projectiles: [],
    wreckage: [],
    explosions: [],
    eventLog: [],
    ghostContacts: [],
    selectionBox: null,
    gameOver: false,
    gameResult: null,
    time: 0,
    paused: false,
    mission,
    objectives: initial.objectives ?? [],
    capturePoints: initial.capturePoints ?? [],
    reinforcementBudget: initial.reinforcementBudget ?? 0,
    rewardCP: initial.rewardCP ?? 0,
    script: initial.script ?? {},
    detectionMultiplier: initial.detectionMultiplier ?? 1,
  };
  state.units = initial.units ?? [];
  state.eventLog.unshift({ message: `Mission: ${mission.name}`, time: 0, type: 'objective' });
  return state;
}

export function createInputState(): InputState {
  return {
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseWorldPos: { x: 0, y: 0 },
    isDragging: false, isPanning: false, dragStart: null,
  };
}

export function update(state: GameState, input: InputState, dt: number) {
  if (state.gameOver) return;
  if (state.paused) return;

  state.time += dt;

  // Boarding intents
  for (const unit of state.units) {
    if (!unit.alive) continue;
    const intent = (unit as { _boardTarget?: string | null })._boardTarget;
    if (intent) {
      const apc = state.units.find(u => u.id === intent && u.alive && u.type === 'apc');
      if (!apc) { (unit as { _boardTarget?: string | null })._boardTarget = null; continue; }
      if (Math.hypot(apc.pos.x - unit.pos.x, apc.pos.y - unit.pos.y) < 25 && apc.passengers.length < 4) {
        unit.insideOf = apc.id;
        apc.passengers.push(unit.id);
        unit.targetPos = null; unit.path = []; unit.attackTarget = null;
        (unit as { _boardTarget?: string | null })._boardTarget = null;
        state.eventLog.unshift({ message: `${unit.type} boarded APC`, time: state.time, type: 'info' });
      }
    }
  }

  for (const unit of state.units) if (unit.alive) moveUnit(unit, dt, state);

  for (const unit of state.units) {
    if (!unit.alive || unit.order !== 'hold_position') continue;
    const d = Math.hypot(unit.pos.x - unit.homePos.x, unit.pos.y - unit.homePos.y);
    if (d > 60 && !unit.targetPos && unit.path.length === 0) setDestination(unit, state, unit.homePos);
  }

  // Awareness BEFORE combat so visibility gates engagement
  const awarenessMsgs = updateAwareness(state, dt);
  for (const m of awarenessMsgs) state.eventLog.unshift({ message: m, time: state.time, type: 'contact' });

  // Combat
  for (const unit of state.units) {
    const result = updateCombat(unit, dt, state);
    if (result.killMsg) {
      state.eventLog.unshift({ message: result.killMsg, time: state.time, type: 'kill' });
      if (result.killedTeam === 'enemy' && state.mission.rewardKills) {
        state.rewardCP += CP_PER_KILL;
      }
      const vetMsg = checkVeterancy(unit);
      if (vetMsg) state.eventLog.unshift({ message: vetMsg, time: state.time, type: 'reward' });
    }
  }

  if (state.eventLog.length > 30) state.eventLog.length = 30;

  // Remove fully dead
  state.units = state.units.filter(u => u.alive || u.health > -9999);

  // Tick projectiles, explosions, wreckage
  state.projectiles = state.projectiles.filter(p => { p.timer -= dt; return p.timer > 0; });
  state.explosions = state.explosions.filter(e => { e.timer -= dt; return e.timer > 0; });
  state.wreckage = state.wreckage.filter(w => { w.timer -= dt; return w.timer > 0; });

  // AI
  updateAI(state, dt);

  // Mission script
  state.mission.update(state, dt);
}

export function handleLeftClickWorld(worldX: number, worldY: number, state: GameState, shiftKey: boolean) {
  if (!shiftKey) state.units.forEach(u => u.selected = false);
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== 'player') continue;
    const dx = unit.pos.x - worldX, dy = unit.pos.y - worldY;
    if (Math.sqrt(dx * dx + dy * dy) < 22) {
      unit.selected = !unit.selected || !shiftKey;
      return true;
    }
  }
  return false;
}

export function handleRightClickWorld(worldX: number, worldY: number, state: GameState, shiftKey = false, ctrlKey = false) {
  const selected = state.units.filter(u => u.alive && u.selected && u.team === 'player');
  if (selected.length === 0) return;

  // Click on enemy unit
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== 'player') {
      const dx = unit.pos.x - worldX, dy = unit.pos.y - worldY;
      if (unit.alive && unit.team !== 'player' && Math.sqrt(dx * dx + dy * dy) < 22) {
        selected.forEach(u => {
          u.attackTarget = unit.id;
          setDestination(u, state, { x: worldX, y: worldY });
          u.waypoints = [];
          u.order = 'attack';
        });
        return;
      }
    }
  }

  // Friendly APC = board
  for (const unit of state.units) {
    if (!unit.alive || unit.team !== 'player' || unit.type !== 'apc') continue;
    const dx = unit.pos.x - worldX, dy = unit.pos.y - worldY;
    if (Math.sqrt(dx * dx + dy * dy) < 24) {
      selected.forEach(u => {
        if (u.type === 'infantry' && u.id !== unit.id && unit.passengers.length < 4) {
          setDestination(u, state, { x: unit.pos.x, y: unit.pos.y });
          u.attackTarget = null;
          u.order = 'move';
          (u as { _boardTarget?: string | null })._boardTarget = unit.id;
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
    const dest: Position = { x: worldX + offsetX, y: worldY + offsetY };
    if (shiftKey) {
      u.waypoints.push(dest);
      if (!u.targetPos && u.path.length === 0) setDestination(u, state, u.waypoints.shift()!);
    } else {
      u.waypoints = [];
      setDestination(u, state, dest);
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

export function setStanceForSelected(state: GameState, stance: import('./types').Stance) {
  state.units.filter(u => u.alive && u.selected && u.team === 'player').forEach(u => u.stance = stance);
}

export function holdPositionForSelected(state: GameState) {
  state.units.filter(u => u.alive && u.selected && u.team === 'player').forEach(u => {
    u.targetPos = null; u.path = []; u.waypoints = [];
    u.order = 'hold_position'; u.homePos = { ...u.pos };
  });
}

export function spawnReinforcement(type: import('./types').UnitType, state: GameState) {
  const cost = UNIT_STATS[type].cost;
  const pool = state.reinforcementBudget + (state.mission.rewardKills ? state.rewardCP : 0);
  if (pool < cost) return false;
  // Deduct
  if (state.reinforcementBudget >= cost) state.reinforcementBudget -= cost;
  else {
    const rem = cost - state.reinforcementBudget;
    state.reinforcementBudget = 0;
    state.rewardCP -= rem;
  }
  // Spawn at edge nearest first surviving friendly
  const friendly = state.units.find(u => u.alive && u.team === 'player');
  const spawn = friendly ? { x: friendly.pos.x - 80, y: friendly.pos.y } : { x: 60, y: 600 };
  // import lazily to avoid cycle
  const { createUnit } = require('./units') as typeof import('./units');
  const u = createUnit(type, 'player', spawn.x, spawn.y);
  state.units.push(u);
  state.eventLog.unshift({ message: `Reinforcement: ${type}`, time: state.time, type: 'spawn' });
  return true;
}

export function togglePause(state: GameState) {
  state.paused = !state.paused;
  state.eventLog.unshift({ message: state.paused ? 'PAUSED — issue orders' : 'Resumed', time: state.time, type: 'info' });
}
