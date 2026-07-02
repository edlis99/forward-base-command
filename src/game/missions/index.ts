import { MissionDef, GameState, Unit, DeploymentContext, DeploymentTown, Position } from '../types';
import { createUnit, distance, setDestination } from '../units';
import { CELL_SIZE } from '../constants';
import { LEIPALINGIS_ANCHORS } from '../terrain';

const tx = (gx: number) => gx * CELL_SIZE + CELL_SIZE / 2;
const ty = (gy: number) => gy * CELL_SIZE + CELL_SIZE / 2;

const DEPLOYMENT_TOWNS: DeploymentTown[] = [
  {
    id: 'jovaisiai', name: 'Jovaišiai',
    pos: { x: tx(LEIPALINGIS_ANCHORS.jovaisiai.x), y: ty(LEIPALINGIS_ANCHORS.jovaisiai.y) },
    approach: 'North-west axis · road corridor to Leipalingis',
    distanceKm: 4.2, risk: 'med',
    terrainNote: 'Paved road descent through hedgerow fields; exposed final 800m.',
    advantage: 'Fastest paved approach for armour; forest flank left.',
  },
  {
    id: 'didziasalis', name: 'Didžiasalis',
    pos: { x: tx(LEIPALINGIS_ANCHORS.didziasalis.x), y: ty(LEIPALINGIS_ANCHORS.didziasalis.y) },
    approach: 'North-east axis · long open field',
    distanceKm: 5.1, risk: 'high',
    terrainNote: 'Wide agricultural belt with hedgerow lanes; ideal armour ground but exposed.',
    advantage: 'Best sightlines for tanks; risky for infantry alone.',
  },
  {
    id: 'versiai', name: 'Veršiai',
    pos: { x: tx(LEIPALINGIS_ANCHORS.versiai.x), y: ty(LEIPALINGIS_ANCHORS.versiai.y) },
    approach: 'South-east axis · must cross the stream',
    distanceKm: 5.4, risk: 'med',
    terrainNote: 'Rolling forests and one bridge crossing; excellent concealment for infantry.',
    advantage: 'Concealed infantry approach; harder for armour (single bridge).',
  },
  {
    id: 'straciunai', name: 'Stračiūnai',
    pos: { x: tx(LEIPALINGIS_ANCHORS.straciunai.x), y: ty(LEIPALINGIS_ANCHORS.straciunai.y) },
    approach: 'South-west axis · mixed dirt tracks',
    distanceKm: 4.6, risk: 'low',
    terrainNote: 'Short farm tracks through orchards and low ground.',
    advantage: 'Quiet approach; enemy pickets sparse this side.',
  },
  {
    id: 'seirijai', name: 'Seirijai',
    pos: { x: tx(LEIPALINGIS_ANCHORS.seirijai.x), y: ty(LEIPALINGIS_ANCHORS.seirijai.y) },
    approach: 'Western reserve axis · longest march',
    distanceKm: 8.7, risk: 'low',
    terrainNote: 'Must cross river bridge, then long road through forest belts.',
    advantage: 'Safest staging; flexible — flank north or south. Slowest to contact.',
  },
];

/** Spawn a mixed enemy garrison inside/around Leipalingis + outer strongpoints. */
function garrisonLeipalingis(units: Unit[]) {
  const L = LEIPALINGIS_ANCHORS.leipalingis;
  // Inner defenders: infantry in trenches around town
  const inner: Array<[number, number]> = [
    [L.x - 6, L.y - 14], [L.x, L.y - 14], [L.x + 6, L.y - 14],
    [L.x - 6, L.y + 14], [L.x, L.y + 14], [L.x + 6, L.y + 14],
    [L.x - 14, L.y - 4], [L.x - 14, L.y + 4],
    [L.x + 14, L.y - 4], [L.x + 14, L.y + 4],
    [L.x - 2, L.y - 8], [L.x + 2, L.y + 8], [L.x, L.y],
  ];
  for (const [gx, gy] of inner) {
    const u = createUnit('infantry', 'enemy', tx(gx), ty(gy));
    u.stance = 'defend'; u.order = 'hold_position'; u.homePos = { ...u.pos };
    units.push(u);
  }
  // Armour reserve inside town
  const t1 = createUnit('tank', 'enemy', tx(L.x - 4), ty(L.y + 2));
  t1.stance = 'defend'; t1.order = 'hold_position'; t1.homePos = { ...t1.pos };
  const t2 = createUnit('tank', 'enemy', tx(L.x + 4), ty(L.y - 2));
  t2.stance = 'defend'; t2.order = 'hold_position'; t2.homePos = { ...t2.pos };
  const apc = createUnit('apc', 'enemy', tx(L.x), ty(L.y + 6));
  apc.stance = 'defend'; apc.order = 'hold_position'; apc.homePos = { ...apc.pos };
  units.push(t1, t2, apc);

  // Forward outposts / pickets along each approach
  const outposts: Array<[number, number, 'infantry' | 'apc']> = [
    [70, 40, 'infantry'], [70, 40, 'infantry'],       // NW picket (Jovaišiai axis)
    [108, 42, 'infantry'], [108, 42, 'apc'],          // NE picket
    [108, 80, 'infantry'], [108, 80, 'infantry'],     // SE picket
    [72, 78, 'infantry'], [72, 78, 'apc'],            // SW picket
    [78, 60, 'infantry'],                              // west screen
  ];
  for (const [gx, gy, t] of outposts) {
    const u = createUnit(t, 'enemy', tx(gx), ty(gy));
    u.stance = 'defend';
    u.order = 'patrol';
    u.patrolPoints = [{ x: tx(gx - 2), y: ty(gy) }, { x: tx(gx + 2), y: ty(gy) }];
    u.patrolIndex = 1;
    units.push(u);
  }
}

/** Spawn the player force at the chosen deployment town in a rough formation. */
function spawnPlayerForce(units: Unit[], town: DeploymentTown, comp: { infantry: number; tank: number; apc: number }) {
  const cx = town.pos.x, cy = town.pos.y;
  // aim toward Leipalingis
  const L = { x: tx(LEIPALINGIS_ANCHORS.leipalingis.x), y: ty(LEIPALINGIS_ANCHORS.leipalingis.y) };
  const ang = Math.atan2(L.y - cy, L.x - cx);
  const fwdX = Math.cos(ang), fwdY = Math.sin(ang);
  const rightX = -fwdY, rightY = fwdX;
  let slot = 0;
  const place = (type: 'infantry' | 'tank' | 'apc') => {
    // spread out in a shallow arc behind town centre
    const row = Math.floor(slot / 5);
    const col = (slot % 5) - 2;
    const px = cx + rightX * col * 24 - fwdX * (60 + row * 32);
    const py = cy + rightY * col * 24 - fwdY * (60 + row * 32);
    const u = createUnit(type, 'player', px, py);
    u.facing = ang;
    u.stance = 'defend';
    units.push(u);
    slot++;
  };
  for (let i = 0; i < comp.infantry; i++) place('infantry');
  for (let i = 0; i < comp.tank; i++) place('tank');
  for (let i = 0; i < comp.apc; i++) place('apc');
}

const briefing = [
  'OPERATION SILVER BIRCH — RECAPTURE LEIPALINGIS.',
  '',
  'Two weeks ago a mechanised enemy company seized the town of Leipalingis and dug in. They now control the crossroads, the church square and the perimeter tree line, and hold hasty trenches on every approach. Civilian population has evacuated to the surrounding villages.',
  '',
  'You command a battalion detachment staging out of the ring of villages — Jovaišiai, Didžiasalis, Veršiai, Stračiūnai and (farthest west) Seirijai. Each village offers a different axis of attack: paved road, open field, forest cover, quiet farm track, or a long safe march. There is no rush. Recon, manoeuvre, use terrain — then retake the town.',
  '',
  'RULES OF ENGAGEMENT: preserve your force. Combined arms wins here. Infantry alone will bleed in the open fields; armour alone will die in the trench belt and forests. Use the tactical pause (SPACE) and slow-time (1/2/3/4) to think.',
  '',
  'OBJECTIVE: Neutralise the Leipalingis garrison and hold the town centre.',
].join('\n');

export const leipalingisMission: MissionDef = {
  id: 'leipalingis',
  name: 'Operation Silver Birch — Recapture Leipalingis',
  summary: 'Advance from a surrounding village, break the garrison, retake the town centre.',
  briefing,
  rewardKills: false,
  mapLayout: 'leipalingis_region',
  mapSeed: 1917,
  deploymentTowns: DEPLOYMENT_TOWNS,
  defaultComposition: { infantry: 8, tank: 2, apc: 2 },
  init: (ctx?: DeploymentContext) => {
    const s: Partial<GameState> = {
      units: [], objectives: [], capturePoints: [],
      reinforcementBudget: 0, rewardCP: 0,
      detectionMultiplier: 1, script: {},
    };
    const town = DEPLOYMENT_TOWNS.find(t => t.id === ctx?.town) ?? DEPLOYMENT_TOWNS[0];
    const comp = ctx?.composition ?? { infantry: 8, tank: 2, apc: 2 };
    spawnPlayerForce(s.units!, town, comp);
    garrisonLeipalingis(s.units!);

    const L = LEIPALINGIS_ANCHORS.leipalingis;
    s.capturePoints!.push({
      id: 'town_centre',
      pos: { x: tx(L.x), y: ty(L.y) },
      radius: 140,
      owner: 'enemy', progress: -1,
      label: 'Leipalingis Town Centre',
    });

    s.objectives!.push({
      id: 'capture_centre',
      description: 'Capture and hold Leipalingis town centre',
      status: 'active',
    });
    s.objectives!.push({
      id: 'reduce_garrison',
      description: 'Reduce the enemy garrison (defeat majority of defenders)',
      status: 'active',
    });
    s.objectives!.push({
      id: 'preserve_armour',
      description: 'Keep at least one friendly tank alive',
      status: 'active', optional: true,
    });
    return s;
  },
  update: (state: GameState, dt: number) => {
    // Capture progress at town centre
    for (const cp of state.capturePoints) {
      if (cp.id !== 'town_centre') continue;
      const here = state.units.filter(u => u.alive && distance(u.pos, cp.pos) < cp.radius);
      const p = here.filter(u => u.team === 'player').length;
      const e = here.filter(u => u.team === 'enemy').length;
      if (p > e) cp.progress = Math.min(1, cp.progress + dt * 0.05);
      else if (e > p) cp.progress = Math.max(-1, cp.progress - dt * 0.03);
      if (cp.progress >= 0.9) cp.owner = 'player';
      else if (cp.progress <= -0.9) cp.owner = 'enemy';
    }

    const enemies = state.units.filter(u => u.alive && u.team === 'enemy');
    const enemyCount = enemies.length;
    const initialEnemies = (state.script.__initialEnemies as number | undefined) ??
      ((state.script.__initialEnemies = enemyCount) as number);
    const reduced = enemyCount / initialEnemies < 0.25;
    const centreHeld = state.capturePoints.find(c => c.id === 'town_centre')?.owner === 'player';

    const reduceObj = state.objectives.find(o => o.id === 'reduce_garrison');
    if (reduceObj && reduceObj.status === 'active' && reduced) reduceObj.status = 'complete';

    const capObj = state.objectives.find(o => o.id === 'capture_centre');
    if (capObj && capObj.status === 'active' && centreHeld) capObj.status = 'complete';

    const armourObj = state.objectives.find(o => o.id === 'preserve_armour');
    if (armourObj && armourObj.status === 'active') {
      const tankAlive = state.units.some(u => u.alive && u.team === 'player' && u.type === 'tank');
      if (!tankAlive) armourObj.status = 'failed';
    }

    if (capObj?.status === 'complete' && reduceObj?.status === 'complete' && !state.gameOver) {
      state.gameOver = true; state.gameResult = 'win';
      state.eventLog.unshift({ message: 'Leipalingis retaken. Silver Birch complete.', time: state.time, type: 'objective' });
    }

    const anyPlayer = state.units.some(u => u.alive && u.team === 'player');
    if (!anyPlayer) { state.gameOver = true; state.gameResult = 'lose'; }
  },
};

export const MISSIONS: MissionDef[] = [leipalingisMission];
export function getMission(_id?: string): MissionDef { return leipalingisMission; }
export { DEPLOYMENT_TOWNS };
