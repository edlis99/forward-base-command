import { MissionDef, GameState, Unit, CapturePoint, Objective } from '../types';
import { createUnit, distance, setDestination } from '../units';
import { CELL_SIZE } from '../constants';

const tx = (gx: number) => gx * CELL_SIZE + CELL_SIZE / 2;
const ty = (gy: number) => gy * CELL_SIZE + CELL_SIZE / 2;

function placeGarrison(state: Partial<GameState>, gx: number, gy: number) {
  const units: Unit[] = state.units!;
  const inf1 = createUnit('infantry', 'enemy', tx(gx), ty(gy)); inf1.stance = 'defend'; inf1.order = 'hold_position'; inf1.homePos = { ...inf1.pos };
  const inf2 = createUnit('infantry', 'enemy', tx(gx + 1), ty(gy + 1)); inf2.stance = 'defend'; inf2.order = 'hold_position'; inf2.homePos = { ...inf2.pos };
  const inf3 = createUnit('infantry', 'enemy', tx(gx - 1), ty(gy)); inf3.stance = 'defend'; inf3.order = 'hold_position'; inf3.homePos = { ...inf3.pos };
  units.push(inf1, inf2, inf3);
}

export const assaultMission: MissionDef = {
  id: 'assault',
  name: 'Operation Iron Gate — Seize the Farmhouse',
  summary: 'Reduce the reinforced farmhouse held by an entrenched enemy platoon.',
  briefing: 'At first light, recon confirmed enemy forward observers operating from the Kovalenko farmstead — a stone-walled compound dominating the river ford. They have been calling artillery on our supply road for six days. Command wants the compound silenced before noon. You lead a depleted rifle section with one tank and an APC up the western approach. There are no reinforcements. Use the bocage and the creek line for cover, take the perimeter trench first, then breach the gate. Every soldier counts.',
  rewardKills: false,
  mapLayout: 'farmhouse_complex',
  mapSeed: 7,
  init: () => {
    const s: Partial<GameState> = { units: [], objectives: [], capturePoints: [], reinforcementBudget: 0, rewardCP: 0, detectionMultiplier: 1, script: {} };
    // Player force: 4 infantry, 1 tank, 1 APC at west
    s.units!.push(createUnit('infantry', 'player', tx(4), ty(18)));
    s.units!.push(createUnit('infantry', 'player', tx(4), ty(20)));
    s.units!.push(createUnit('infantry', 'player', tx(4), ty(22)));
    s.units!.push(createUnit('infantry', 'player', tx(5), ty(20)));
    s.units!.push(createUnit('tank', 'player', tx(3), ty(20)));
    s.units!.push(createUnit('apc', 'player', tx(3), ty(22)));

    // Enemy garrison at farmhouse (center urban cluster ~28..32, 18..22)
    placeGarrison(s, 28, 18);
    placeGarrison(s, 32, 18);
    placeGarrison(s, 30, 22);
    const tank = createUnit('tank', 'enemy', tx(30), ty(20)); tank.stance = 'defend'; tank.order = 'hold_position'; tank.homePos = { ...tank.pos };
    s.units!.push(tank);
    // Outer pickets patrol
    const patrolA = createUnit('infantry', 'enemy', tx(22), ty(15));
    patrolA.stance = 'defend'; patrolA.order = 'patrol';
    patrolA.patrolPoints = [{ x: tx(22), y: ty(15) }, { x: tx(22), y: ty(25) }];
    patrolA.patrolIndex = 1;
    s.units!.push(patrolA);

    s.objectives!.push({ id: 'destroy_garrison', description: 'Eliminate all enemy units in the farmhouse area', status: 'active' });
    s.objectives!.push({ id: 'preserve_tank', description: 'Keep the friendly tank alive', status: 'active', optional: true });

    return s;
  },
  update: (state: GameState) => {
    const enemiesAlive = state.units.some(u => u.alive && u.team === 'enemy');
    const destroy = state.objectives.find(o => o.id === 'destroy_garrison');
    if (destroy && destroy.status === 'active' && !enemiesAlive) {
      destroy.status = 'complete';
      state.gameOver = true; state.gameResult = 'win';
      state.eventLog.unshift({ message: 'Farmhouse secured. Victory.', time: state.time, type: 'objective' });
    }
    const tank = state.units.find(u => u.type === 'tank' && u.team === 'player');
    const tankObj = state.objectives.find(o => o.id === 'preserve_tank');
    if (tankObj && tankObj.status === 'active' && (!tank || !tank.alive)) tankObj.status = 'failed';
    const anyPlayer = state.units.some(u => u.alive && u.team === 'player');
    if (!anyPlayer) { state.gameOver = true; state.gameResult = 'lose'; }
  },
};

export const defendMission: MissionDef = {
  id: 'defend',
  name: 'Hold the Settlement',
  summary: 'Defend two capture points against scripted enemy advances.',
  briefing: 'Enemy forces are pushing west toward the village. Hold both objective points until command lifts the order. Kill rewards are authorized — call in reinforcements as needed.',
  rewardKills: true,
  mapLayout: 'village_crossroads',
  mapSeed: 11,
  init: () => {
    const s: Partial<GameState> = { units: [], objectives: [], capturePoints: [], reinforcementBudget: 200, rewardCP: 100, detectionMultiplier: 1, script: { wave: 0, waveTimer: 8, totalWaves: 4 } };
    // Player force at center
    s.units!.push(createUnit('infantry', 'player', tx(27), ty(20)));
    s.units!.push(createUnit('infantry', 'player', tx(29), ty(18)));
    s.units!.push(createUnit('infantry', 'player', tx(31), ty(18)));
    s.units!.push(createUnit('infantry', 'player', tx(33), ty(20)));
    s.units!.push(createUnit('tank', 'player', tx(30), ty(22)));
    s.units!.push(createUnit('apc', 'player', tx(28), ty(22)));

    const cp1: CapturePoint = { id: 'cp_north', pos: { x: tx(30), y: ty(15) }, radius: 80, owner: 'player', progress: 1, label: 'North Plaza' };
    const cp2: CapturePoint = { id: 'cp_south', pos: { x: tx(30), y: ty(25) }, radius: 80, owner: 'player', progress: 1, label: 'South Plaza' };
    s.capturePoints!.push(cp1, cp2);

    s.objectives!.push({ id: 'survive', description: 'Hold both capture points until 4 waves are repelled', status: 'active' });
    s.objectives!.push({ id: 'no_loss', description: 'Do not lose either capture point', status: 'active' });

    return s;
  },
  update: (state: GameState, dt: number) => {
    const script = state.script as { wave: number; waveTimer: number; totalWaves: number };
    // Capture progression
    for (const cp of state.capturePoints) {
      const here = state.units.filter(u => u.alive && distance(u.pos, cp.pos) < cp.radius);
      const playerCount = here.filter(u => u.team === 'player').length;
      const enemyCount = here.filter(u => u.team === 'enemy').length;
      if (playerCount > enemyCount) cp.progress = Math.min(1, cp.progress + dt * 0.15);
      else if (enemyCount > playerCount) cp.progress = Math.max(-1, cp.progress - dt * 0.15);
      const prevOwner = cp.owner;
      if (cp.progress >= 0.9) cp.owner = 'player';
      else if (cp.progress <= -0.9) cp.owner = 'enemy';
      if (prevOwner !== cp.owner && cp.owner === 'enemy') {
        state.eventLog.unshift({ message: `${cp.label} LOST!`, time: state.time, type: 'objective' });
        const noLoss = state.objectives.find(o => o.id === 'no_loss');
        if (noLoss) noLoss.status = 'failed';
        state.gameOver = true; state.gameResult = 'lose';
      }
    }

    // Wave spawner
    if (script.wave < script.totalWaves) {
      script.waveTimer -= dt;
      if (script.waveTimer <= 0) {
        script.wave++;
        script.waveTimer = 35;
        const fromX = tx(58);
        const yBase = 18 + (script.wave % 2 === 0 ? 4 : 0);
        const composition: Array<'infantry' | 'tank' | 'apc'> = ['infantry', 'infantry', 'infantry'];
        if (script.wave >= 2) composition.push('apc');
        if (script.wave >= 3) composition.push('tank');
        if (script.wave >= 4) composition.push('tank', 'infantry');
        let off = -composition.length * 20;
        for (const t of composition) {
          const u = createUnit(t, 'enemy', fromX, ty(yBase) + off);
          u.stance = 'aggressive'; u.order = 'attack_move';
          setDestination(u, state, { x: tx(30), y: ty(20) });
          state.units.push(u);
          off += 40;
        }
        state.eventLog.unshift({ message: `Wave ${script.wave}/${script.totalWaves} incoming from the east`, time: state.time, type: 'spawn' });
      }
    } else {
      // All waves done — survive remaining enemies
      const enemiesAlive = state.units.some(u => u.alive && u.team === 'enemy');
      if (!enemiesAlive) {
        const survive = state.objectives.find(o => o.id === 'survive');
        if (survive && survive.status === 'active') {
          survive.status = 'complete';
          state.gameOver = true; state.gameResult = 'win';
          state.eventLog.unshift({ message: 'Settlement held. Victory.', time: state.time, type: 'objective' });
        }
      }
    }

    const anyPlayer = state.units.some(u => u.alive && u.team === 'player');
    if (!anyPlayer) { state.gameOver = true; state.gameResult = 'lose'; }
  },
};

export const reconMission: MissionDef = {
  id: 'recon',
  name: 'Recon & Extract',
  summary: 'Photograph 3 enemy positions and reach the extraction point. Avoid contact.',
  briefing: 'A small recon team must observe three enemy positions and exfil. Detection raises an alarm and brings hunters down on you. Use hold-fire stance and concealment.',
  rewardKills: false,
  mapLayout: 'forest_outpost',
  mapSeed: 23,
  init: () => {
    const s: Partial<GameState> = { units: [], objectives: [], capturePoints: [], reinforcementBudget: 0, rewardCP: 0, detectionMultiplier: 0.7, script: { alarmed: false, recons: [false, false, false] } };
    // Recon team: 3 infantry, hold-fire
    for (let i = 0; i < 3; i++) {
      const u = createUnit('infantry', 'player', tx(4), ty(18 + i * 2));
      u.stance = 'hold_fire';
      s.units!.push(u);
    }
    // Recon points + extraction shown via capturePoints (reused as map markers)
    s.capturePoints!.push({ id: 'recon_1', pos: { x: tx(20), y: ty(10) }, radius: 60, owner: 'neutral', progress: 0, label: 'Recon 1' });
    s.capturePoints!.push({ id: 'recon_2', pos: { x: tx(35), y: ty(28) }, radius: 60, owner: 'neutral', progress: 0, label: 'Recon 2' });
    s.capturePoints!.push({ id: 'recon_3', pos: { x: tx(48), y: ty(14) }, radius: 60, owner: 'neutral', progress: 0, label: 'Recon 3' });
    s.capturePoints!.push({ id: 'extract', pos: { x: tx(56), y: ty(36) }, radius: 60, owner: 'player', progress: 1, label: 'Extract' });

    // Enemy patrols + garrison
    const placePatrol = (x1: number, y1: number, x2: number, y2: number) => {
      const u = createUnit('infantry', 'enemy', tx(x1), ty(y1));
      u.stance = 'defend'; u.order = 'patrol';
      u.patrolPoints = [{ x: tx(x1), y: ty(y1) }, { x: tx(x2), y: ty(y2) }];
      u.patrolIndex = 1;
      s.units!.push(u);
    };
    placePatrol(18, 8, 24, 8);
    placePatrol(33, 26, 38, 26);
    placePatrol(46, 12, 50, 16);
    const apc = createUnit('apc', 'enemy', tx(48), ty(20)); apc.stance = 'defend'; apc.order = 'hold_position'; apc.homePos = { ...apc.pos };
    s.units!.push(apc);

    s.objectives!.push({ id: 'recon_all', description: 'Observe all 3 recon points (move within range)', status: 'active' });
    s.objectives!.push({ id: 'extract', description: 'Reach the extraction point', status: 'active' });
    s.objectives!.push({ id: 'undetected', description: 'Remain undetected', status: 'active', optional: true });

    return s;
  },
  update: (state: GameState, dt: number) => {
    const script = state.script as { alarmed: boolean; recons: boolean[] };
    const playerUnits = state.units.filter(u => u.alive && u.team === 'player');

    // Recon checks
    const reconIds = ['recon_1', 'recon_2', 'recon_3'];
    reconIds.forEach((id, i) => {
      if (script.recons[i]) return;
      const pt = state.capturePoints.find(c => c.id === id);
      if (!pt) return;
      if (playerUnits.some(u => distance(u.pos, pt.pos) < pt.radius)) {
        script.recons[i] = true;
        pt.owner = 'player'; pt.progress = 1;
        state.eventLog.unshift({ message: `${pt.label} observed`, time: state.time, type: 'objective' });
      }
    });
    if (script.recons.every(Boolean)) {
      const o = state.objectives.find(o => o.id === 'recon_all');
      if (o) o.status = 'complete';
    }

    // Detection alarm
    if (!script.alarmed && playerUnits.some(u => u.spottedByEnemy)) {
      script.alarmed = true;
      const undetected = state.objectives.find(o => o.id === 'undetected');
      if (undetected) undetected.status = 'failed';
      // Spawn hunters
      const t1 = createUnit('apc', 'enemy', tx(58), ty(20)); t1.stance = 'aggressive'; t1.order = 'attack_move';
      const t2 = createUnit('infantry', 'enemy', tx(58), ty(22)); t2.stance = 'aggressive'; t2.order = 'attack_move';
      const t3 = createUnit('infantry', 'enemy', tx(58), ty(18)); t3.stance = 'aggressive'; t3.order = 'attack_move';
      const t4 = createUnit('infantry', 'enemy', tx(58), ty(24)); t4.stance = 'aggressive'; t4.order = 'attack_move';
      for (const u of [t1, t2, t3, t4]) {
        const tgt = playerUnits[0];
        if (tgt) setDestination(u, state, tgt.pos);
        state.units.push(u);
      }
      state.eventLog.unshift({ message: 'ALARM! Enemy QRF inbound', time: state.time, type: 'contact' });
    }

    // Extraction
    const extract = state.capturePoints.find(c => c.id === 'extract');
    const reconComplete = state.objectives.find(o => o.id === 'recon_all')?.status === 'complete';
    if (extract && reconComplete) {
      const atExtract = playerUnits.filter(u => distance(u.pos, extract.pos) < extract.radius);
      if (atExtract.length === playerUnits.length && atExtract.length > 0) {
        const exObj = state.objectives.find(o => o.id === 'extract');
        if (exObj) exObj.status = 'complete';
        state.gameOver = true; state.gameResult = 'win';
        state.eventLog.unshift({ message: 'Extracted. Mission complete.', time: state.time, type: 'objective' });
      }
    }
    if (playerUnits.length === 0) { state.gameOver = true; state.gameResult = 'lose'; }
  },
};

export const ambushMission: MissionDef = {
  id: 'ambush',
  name: 'Convoy Ambush',
  summary: 'Set up positions and destroy an enemy convoy before it exits the map.',
  briefing: 'An enemy supply convoy will travel west-to-east along the central road. Pre-position your forces in concealment. Detection multiplier is reduced — your units are hard to spot until you fire. Destroy the entire convoy.',
  rewardKills: false,
  mapLayout: 'desert_road',
  mapSeed: 31,
  init: () => {
    const s: Partial<GameState> = { units: [], objectives: [], capturePoints: [], reinforcementBudget: 0, rewardCP: 0, detectionMultiplier: 0.4, script: { spawned: false, convoyTimer: 12 } };
    // Player force around the road
    s.units!.push(createUnit('infantry', 'player', tx(28), ty(15)));
    s.units!.push(createUnit('infantry', 'player', tx(32), ty(15)));
    s.units!.push(createUnit('infantry', 'player', tx(36), ty(24)));
    s.units!.push(createUnit('tank', 'player', tx(40), ty(14)));
    s.units!.push(createUnit('tank', 'player', tx(40), ty(26)));
    s.units!.push(createUnit('apc', 'player', tx(36), ty(15)));
    for (const u of s.units!) u.stance = 'hold_fire';

    s.objectives!.push({ id: 'destroy_convoy', description: 'Destroy all convoy vehicles', status: 'active' });
    s.objectives!.push({ id: 'no_escape', description: 'Do not let any vehicle reach the east exit', status: 'active' });

    return s;
  },
  update: (state: GameState, dt: number) => {
    const script = state.script as { spawned: boolean; convoyTimer: number };
    if (!script.spawned) {
      script.convoyTimer -= dt;
      if (script.convoyTimer <= 0) {
        script.spawned = true;
        const convoyTypes: Array<'apc' | 'tank' | 'apc'> = ['apc', 'tank', 'apc'];
        let off = 0;
        for (const t of convoyTypes) {
          const u = createUnit(t, 'enemy', tx(2) + off, ty(20));
          u.stance = 'defend'; u.order = 'move';
          setDestination(u, state, { x: tx(58), y: ty(20) });
          (u as Unit & { _convoy?: boolean })._convoy = true;
          state.units.push(u);
          off -= 50;
        }
        state.eventLog.unshift({ message: 'Convoy spotted approaching from the west', time: state.time, type: 'contact' });
      }
    }

    // Check escape
    for (const u of state.units) {
      if (u.alive && u.team === 'enemy' && (u as Unit & { _convoy?: boolean })._convoy && u.pos.x > tx(57)) {
        const noEscape = state.objectives.find(o => o.id === 'no_escape');
        if (noEscape) noEscape.status = 'failed';
        state.gameOver = true; state.gameResult = 'lose';
        state.eventLog.unshift({ message: 'A convoy vehicle escaped. Mission failed.', time: state.time, type: 'objective' });
        return;
      }
    }

    if (script.spawned) {
      const convoyAlive = state.units.some(u => u.alive && u.team === 'enemy' && (u as Unit & { _convoy?: boolean })._convoy);
      if (!convoyAlive) {
        const o = state.objectives.find(o => o.id === 'destroy_convoy');
        if (o) o.status = 'complete';
        state.gameOver = true; state.gameResult = 'win';
        state.eventLog.unshift({ message: 'Convoy destroyed. Victory.', time: state.time, type: 'objective' });
      }
    }

    const anyPlayer = state.units.some(u => u.alive && u.team === 'player');
    if (!anyPlayer) { state.gameOver = true; state.gameResult = 'lose'; }
  },
};

export const MISSIONS: MissionDef[] = [assaultMission, defendMission, reconMission, ambushMission];
export function getMission(id: string): MissionDef {
  return MISSIONS.find(m => m.id === id) ?? assaultMission;
}
