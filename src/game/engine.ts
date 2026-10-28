import { shuffled } from './rng';
import { applyCommand, pushMarker } from './commands';
import { defaultControllers, isHumanTeam } from './controllers';
import { selectUnits } from './selection';
import { GameState, InputState, MissionDef, Position, FormationType, Unit, CommandMarker, CommandMarkerType, DebugFlags } from './types';
import { generateTerrain, getTerrainAt, canDigHere, digTrench, findNearestPassableWorld, isFootprintPassable } from './terrain';
import { createUnit, resetUnitIds, peekUnitId, clearUnitOrders, setDestination, updateCombat, updateOrders, getUnitsInRect, checkVeterancy, moveUnit, distance } from './units';
import { updateAI } from './ai';
import { updateAwareness, isVisibleTo } from './awareness';
import { updateThreatMap } from './threatMap';
import { updateSquads } from './squads';
import { CELL_SIZE, MAP_COLS, MAP_ROWS, CP_PER_KILL, UNIT_STATS } from './constants';
import { getMission } from './missions';
import { issueSquadMove, updatePlayerSquads, planSquadMove, planToSlots } from './playerSquads';
import { refreshUnitGrid } from './spatialGrid';
import { occupyCover, coverLabel } from './cover';

export interface StateOptions {
  /** Seeds the deterministic RNG. Same seed + same commands = same match. */
  seed?: number;
  /** Who controls each side (default: human player vs AI enemy). */
  controllers?: Record<import('./types').Team, import('./types').Controller>;
}

export function createInitialState(mission: MissionDef, deployment?: import('./types').DeploymentContext, options: StateOptions = {}): GameState {
  const terrain = generateTerrain(mission.mapLayout, mission.mapSeed);
  resetUnitIds(1); // ids are per match: same setup => same ids
  const initial = mission.init(deployment);
  const nextUnitId = peekUnitId();

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
    selectionRoster: [], coordinatedMovement: true,
    previewSelected: new Set(),
    commandMarkers: [],
    commandPreview: null,
    gameOver: false,
    gameResult: null,
    time: 0,
    paused: false,
    timeScale: 1,
    mission,
    deployment,
    objectives: initial.objectives ?? [],
    capturePoints: initial.capturePoints ?? [],
    reinforcementBudget: initial.reinforcementBudget ?? 0,
    rewardCP: initial.rewardCP ?? 0,
    script: initial.script ?? {},
    detectionMultiplier: initial.detectionMultiplier ?? 1,
    debug: { showCover: false, showConcealment: false, showTactical: false, showMovement: false },
    fireSupport: { heTokens: 3, smokeTokens: 2, cooldown: 0, armed: null, counterCooldown: 75 },
    fireMissions: [],
    smokeZones: [],
    nextMoveGroupId: 1,
    playerSquads: [],
    rngState: (options.seed ?? mission.mapSeed ?? 1) | 0,
    controllers: options.controllers ?? defaultControllers(),
    winner: null,
    nextUnitId,
    duel: initial.duel,
    raas: initial.raas,
  };
  state.units = initial.units ?? [];
  // Snap any unit that spawned on impassable terrain to the nearest passable cell.
  for (const u of state.units) {
    const veh = u.type === 'tank' || u.type === 'apc';
    const heli = u.type === 'helicopter';
    const snapped = findNearestPassableWorld(terrain, u.pos.x, u.pos.y, veh, heli, 10);
    u.pos.x = snapped.x; u.pos.y = snapped.y;
    u.homePos = { x: snapped.x, y: snapped.y };
  }
  state.eventLog.unshift({ message: `Mission: ${mission.name}`, time: 0, type: 'objective' });
  return state;
}

export function createInputState(): InputState {
  return {
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseWorldPos: { x: 0, y: 0 },
    isDragging: false, isPanning: false, dragStart: null,
    dragStartScreen: null, dragPromoted: false, rightMouseDown: false,
  };
}

export function update(state: GameState, input: InputState, dt: number) {
  if (state.gameOver) return;
  if (state.paused) return;

  // Apply tactical time-scale (0.25 / 0.5 / 1 / 2).
  dt = dt * (state.timeScale ?? 1);
  state.time += dt;

  // Boarding intents
  for (const unit of state.units) {
    if (!unit.alive) continue;
    const intent = unit.boardTarget;
    if (intent) {
      const apc = state.units.find(u => u.id === intent && u.alive && u.type === 'apc' && u.team === unit.team);
      if (!apc || apc.passengers.length >= 4) { clearUnitOrders(unit); continue; }
      if (Math.hypot(apc.pos.x - unit.pos.x, apc.pos.y - unit.pos.y) < 25 && apc.passengers.length < 4) {
        clearUnitOrders(unit);
        unit.insideOf = apc.id;
        unit.selected = false;
        unit.pos = { ...apc.pos };
        apc.passengers.push(unit.id);
        state.eventLog.unshift({ message: `${unit.type} boarded APC`, time: state.time, type: 'info' });
      } else if (!unit.finalDest || distance(unit.finalDest, apc.pos) > CELL_SIZE) {
        setDestination(unit, state, apc.pos);
      }
    }
  }

  refreshUnitGrid(state);
  updatePlayerSquads(state, dt);
  for (const unit of state.units) if (unit.alive) updateOrders(unit, dt, state);
  for (const unit of state.units) if (unit.alive) moveUnit(unit, dt, state);
  for (const unit of state.units) {
    if (!unit.alive || !unit.insideOf) continue;
    const carrier = state.units.find(u => u.id === unit.insideOf && u.alive);
    if (carrier) unit.pos = { ...carrier.pos };
  }

  // Dig-on-arrive: units flagged by digTrenchLineForSelected start entrenching at destination
  for (const unit of state.units) {
    if (!unit.alive) continue;
    if (!unit.digOnArrive) continue;
    if (unit.targetPos || unit.path.length > 0 || unit.waypoints.length > 0) continue;
    const cell = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
    if (cell && cell.type !== 'trench' && canDigHere(cell)) {
      unit.order = 'entrench';
      unit.digTimer = 0;
    }
    unit.digOnArrive = false;
  }

  // Dig progress
  for (const unit of state.units) {
    if (!unit.alive || unit.order !== 'entrench' || unit.type !== 'infantry') continue;
    if (unit.suppression > 0.4) continue;
    const cell = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
    if (!canDigHere(cell)) { unit.order = 'idle'; unit.digTimer = 0; continue; }
    unit.digTimer += dt * (1 - unit.fatigue * 0.4);
    if (unit.digTimer >= 6) {
      digTrench(state.terrain, unit.pos.x, unit.pos.y);
      unit.digTimer = 0;
      unit.order = 'hold_position';
      unit.homePos = { ...unit.pos };
      unit.prone = true;
      state.eventLog.unshift({ message: `${unit.team} ${unit.type} entrenched`, time: state.time, type: 'info' });
    }
  }

  for (const unit of state.units) {
    if (!unit.alive || unit.order !== 'hold_position') continue;
    const d = Math.hypot(unit.pos.x - unit.homePos.x, unit.pos.y - unit.homePos.y);
    if (d > 60 && !unit.targetPos && unit.path.length === 0) setDestination(unit, state, unit.homePos);
  }

  const awarenessMsgs = updateAwareness(state, dt);
  for (const m of awarenessMsgs) state.eventLog.unshift({ message: m, time: state.time, type: 'contact' });

  updateThreatMap(state, dt);


  // Randomised order each tick so neither side systematically shoots first.
  for (const unit of shuffled(state.units, state)) {
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

  state.units = state.units.filter(u => u.alive || u.health > -9999);

  state.projectiles = state.projectiles.filter(p => { p.timer -= dt; return p.timer > 0; });
  state.explosions = state.explosions.filter(e => { e.timer -= dt; return e.timer > 0; });
  state.wreckage = state.wreckage.filter(w => { w.timer -= dt; return w.timer > 0; });

  // Tick command markers
  for (const m of state.commandMarkers) m.timer -= dt;
  state.commandMarkers = state.commandMarkers.filter(m => m.timer > 0);

  // The built-in AI only plays a side nobody is commanding.
  if (!isHumanTeam(state, 'enemy')) {
    if (!state.raas) updateSquads(state, dt); // in RAAS the objective commander owns movement
    updateAI(state, dt);
  }

  state.mission.update(state, dt);
}

// ============ SELECTION HELPERS ============

/** True if the click landed on a friendly unit (and selected it). */
export function handleLeftClickWorld(worldX: number, worldY: number, state: GameState, shiftKey: boolean) {
  const nearest = state.units
    .filter(u => u.alive && u.team === 'player' && !u.insideOf)
    .map(unit => ({ unit, d: Math.hypot(unit.pos.x - worldX, unit.pos.y - worldY) }))
    .filter(hit => hit.d < 22)
    .sort((a, b) => a.d - b.d || a.unit.id.localeCompare(b.unit.id))[0];
  if (nearest) {
    selectUnits(state, [nearest.unit.id], shiftKey ? 'toggle' : 'replace');
    return true;
  }
  if (!shiftKey) selectUnits(state, []);
  return false;
}

/** Recompute which player units are inside the live drag rectangle. */
export function updatePreviewSelection(state: GameState) {
  state.previewSelected.clear();
  const sb = state.selectionBox;
  if (!sb) return;
  const units = getUnitsInRect(state.units, sb.start.x, sb.start.y, sb.end.x, sb.end.y, 'player');
  for (const u of units) state.previewSelected.add(u.id);
}

/**
 * Recompute the formation placement preview. `facing`/`widthScale` come from the
 * press-and-drag gesture (press = destination, drag = arrival facing + frontage).
 */
export function updateCommandPreview(
  state: GameState, worldX: number, worldY: number, facing?: number, widthScale?: number,
) {
  const selected = state.units.filter(u => u.alive && u.selected && u.team === 'player' && !u.insideOf);
  if (selected.length === 0) { state.commandPreview = null; return; }
  const dest: Position = { x: worldX, y: worldY };
  const cx = selected.reduce((s, u) => s + u.pos.x, 0) / selected.length;
  const cy = selected.reduce((s, u) => s + u.pos.y, 0) / selected.length;
  const face = facing ?? Math.atan2(worldY - cy, worldX - cx);
  const plan = planSquadMove(state, selected, dest, { facing, widthScale });
  state.commandPreview = { slots: planToSlots(plan), dest, facing: face };
}

export function clearCommandPreview(state: GameState) { state.commandPreview = null; }

/**
 * Local-player gesture -> command. Resolves what was clicked (enemy, friendly
 * transport, ground) against the current selection and issues one command.
 * Everything that changes the match goes through applyCommand.
 */
export function handleRightClickWorld(
  worldX: number, worldY: number, state: GameState, shiftKey = false, ctrlKey = false,
  facing?: number, widthScale?: number,
) {
  const selected = state.units.filter(u => u.alive && u.selected && u.team === 'player' && !u.insideOf);
  if (selected.length === 0 || state.gameOver) return;
  const unitIds = selected.map(u => u.id);

  // Click on a detected enemy unit
  const enemy = state.units.find(u => u.alive && !u.insideOf && u.team !== 'player' && isVisibleTo(u, 'player') &&
    Math.hypot(u.pos.x - worldX, u.pos.y - worldY) < 22);
  if (enemy) { applyCommand(state, 'player', { type: 'attack', unitIds, targetId: enemy.id }); return; }

  // Friendly APC = board
  if (!shiftKey && !ctrlKey && selected.some(u => u.type === 'infantry')) {
    const apc = state.units.find(u => u.alive && !u.selected && u.team === 'player' && u.type === 'apc' &&
      Math.hypot(u.pos.x - worldX, u.pos.y - worldY) < 24);
    if (apc) { applyCommand(state, 'player', { type: 'board', unitIds, apcId: apc.id }); return; }
  }

  applyCommand(state, 'player', {
    type: 'move', unitIds, x: worldX, y: worldY, queue: shiftKey, attackMove: ctrlKey,
    facing, widthScale, formation: state.preferredFormation ?? null,
  });
}

export function setFormation(state: GameState, type: FormationType | null) {
  state.preferredFormation = type ?? undefined;
}

export function digInForSelected(state: GameState) {
  applyCommand(state, 'player', { type: 'dig', unitIds: state.units.filter(u => u.selected && u.team === 'player').map(u => u.id) });
}

/**
 * Dig a connected trench LINE through the selected infantry.
 * Endpoints are the two infantry farthest apart; intermediate cells along the
 * Bresenham line between them become dig targets. Each selected unit is
 * greedy-assigned to its nearest cell, then moves there and entrenches.
 * Existing trench cells along the path are skipped (so segments auto-connect).
 */
export function digTrenchLineForSelected(state: GameState) {
  if (state.gameOver) return;
  const cs = state.cellSize;
  const sel = state.units.filter(u => u.alive && !u.insideOf && u.selected && u.team === 'player' && u.type === 'infantry');
  if (sel.length < 2) { digInForSelected(state); return; }

  // Find the two farthest-apart units to use as endpoints
  let a = sel[0], b = sel[1], best = 0;
  for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) {
    const d = Math.hypot(sel[i].pos.x - sel[j].pos.x, sel[i].pos.y - sel[j].pos.y);
    if (d > best) { best = d; a = sel[i]; b = sel[j]; }
  }

  // Bresenham line in cell coords
  const x0 = Math.floor(a.pos.x / cs), y0 = Math.floor(a.pos.y / cs);
  const x1 = Math.floor(b.pos.x / cs), y1 = Math.floor(b.pos.y / cs);
  const cells: { gx: number; gy: number; wx: number; wy: number }[] = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, cx = x0, cy = y0;
  // safety cap to avoid runaway loops
  for (let n = 0; n < 256; n++) {
    cells.push({ gx: cx, gy: cy, wx: cx * cs + cs / 2, wy: cy * cs + cs / 2 });
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }

  // Filter to diggable empty cells (skip existing trenches — they're already connected)
  const targets = cells.filter(c => {
    const cell = state.terrain[c.gy]?.[c.gx];
    if (!cell) return false;
    if (cell.type === 'trench') return false;
    return canDigHere(cell);
  });

  if (targets.length === 0) {
    state.eventLog.unshift({ message: 'No diggable ground along trench line', time: state.time, type: 'info' });
    return;
  }

  // Greedy assign: each unit takes its nearest unused target
  const free = new Set(targets.map((_, i) => i));
  const assignments: Array<{ unit: Unit; tgt: typeof targets[number] }> = [];
  const queue = [...sel];
  while (queue.length && free.size) {
    let bestU = -1, bestT = -1, bestD = Infinity;
    queue.forEach((u, ui) => {
      free.forEach(ti => {
        const d = Math.hypot(targets[ti].wx - u.pos.x, targets[ti].wy - u.pos.y);
        if (d < bestD) { bestD = d; bestU = ui; bestT = ti; }
      });
    });
    if (bestU < 0) break;
    assignments.push({ unit: queue[bestU], tgt: targets[bestT] });
    queue.splice(bestU, 1);
    free.delete(bestT);
  }

  for (const { unit, tgt } of assignments) {
    clearUnitOrders(unit);
    unit.waypoints = [];
    unit.attackTarget = null;
    unit.order = 'move';
    setDestination(unit, state, { x: tgt.wx, y: tgt.wy });
    // Tag so engine.update flips the unit into 'entrench' when it arrives
    unit.digOnArrive = unit.targetPos !== null;
    pushMarker(state, 'move', { x: tgt.wx, y: tgt.wy });
  }

  state.eventLog.unshift({
    message: `Trench line designated: ${assignments.length} segments`,
    time: state.time, type: 'info',
  });
}

export function handleBoxSelect(x1: number, y1: number, x2: number, y2: number, state: GameState, shiftKey: boolean) {
  const units = getUnitsInRect(state.units, x1, y1, x2, y2, 'player').filter(u => !u.insideOf);
  selectUnits(state, units.map(u => u.id), shiftKey ? 'add' : 'replace');
  state.previewSelected.clear();
}

const selectedIds = (state: GameState) => state.units.filter(u => u.alive && u.selected && u.team === 'player').map(u => u.id);

export function setStanceForSelected(state: GameState, stance: import('./types').Stance) {
  applyCommand(state, 'player', { type: 'stance', unitIds: selectedIds(state), stance });
}

export function holdPositionForSelected(state: GameState) {
  applyCommand(state, 'player', { type: 'hold', unitIds: selectedIds(state) });
}

/** Unload selected APCs into separate, passable cells near the carrier. */
export function disembarkSelected(state: GameState) {
  applyCommand(state, 'player', { type: 'disembark', unitIds: selectedIds(state) });
}

export function spawnReinforcement(type: import('./types').UnitType, state: GameState) {
  if (state.gameOver) return false;
  const cost = UNIT_STATS[type].cost;
  const pool = state.reinforcementBudget + (state.mission.rewardKills ? state.rewardCP : 0);
  if (pool < cost) return false;
  if (state.reinforcementBudget >= cost) state.reinforcementBudget -= cost;
  else {
    const rem = cost - state.reinforcementBudget;
    state.reinforcementBudget = 0;
    state.rewardCP -= rem;
  }
  const friendly = state.units.find(u => u.alive && u.team === 'player');
  const rawSpawn = friendly ? { x: friendly.pos.x - 80, y: friendly.pos.y } : { x: 60, y: 600 };
  const veh = type === 'tank' || type === 'apc';
  const heli = type === 'helicopter';
  const spawn = findNearestPassableWorld(state.terrain, rawSpawn.x, rawSpawn.y, veh, heli, 12);
  resetUnitIds(state.nextUnitId ?? peekUnitId());
  const u = createUnit(type, 'player', spawn.x, spawn.y);
  state.nextUnitId = peekUnitId();
  u.homePos = { x: spawn.x, y: spawn.y };
  state.units.push(u);
  state.eventLog.unshift({ message: `Reinforcement: ${type}`, time: state.time, type: 'spawn' });
  return true;
}

export function togglePause(state: GameState) {
  state.paused = !state.paused;
  state.eventLog.unshift({ message: state.paused ? 'PAUSED — issue orders' : 'Resumed', time: state.time, type: 'info' });
}

/** Toggle a single debug layer; turning one on turns others off (mutually exclusive). */
export function toggleDebugLayer(state: GameState, layer: keyof DebugFlags) {
  const wasOn = state.debug[layer];
  state.debug.showCover = false;
  state.debug.showConcealment = false;
  state.debug.showTactical = false;
  state.debug.showMovement = false;
  state.debug[layer] = !wasOn;
}

/** Set tactical time scale. Clamped 0..2. 0 = effectively paused. */
export function setTimeScale(state: GameState, scale: number) {
  state.timeScale = Math.max(0, Math.min(2, scale));
}
