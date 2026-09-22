import { MissionDef, GameState, Unit, DeploymentContext, DeploymentTown, Position } from '../types';
import { createUnit, distance, setDestination } from '../units';
import { CELL_SIZE } from '../constants';
import { LEIPALINGIS_ANCHORS } from '../terrain';
import { STAGING_AREAS } from '../maps/leipalingis';

const tx = (gx: number) => gx * CELL_SIZE + CELL_SIZE / 2;
const ty = (gy: number) => gy * CELL_SIZE + CELL_SIZE / 2;

const DEPLOYMENT_TOWNS: DeploymentTown[] = [
  { id: 'jovaisiai', name: 'Jovaišiai',
    pos: { x: tx(STAGING_AREAS.jovaisiai.x), y: ty(STAGING_AREAS.jovaisiai.y) },
    approach: 'Northern axis · local roads to the 180 corridor', distanceKm: 3.7, risk: 'med',
    terrainNote: 'Farmyards and woodland edges break up the approach. Paved stretches are exposed.',
    advantage: 'Short northern approach with cover positions beside the road.' },
  { id: 'didziasalis', name: 'Didžiasalis',
    pos: { x: tx(STAGING_AREAS.didziasalis.x), y: ty(STAGING_AREAS.didziasalis.y) },
    approach: 'Southern axis · Druskininkai road corridor', distanceKm: 5.5, risk: 'med',
    terrainNote: 'Southern woodland, lakes and the 180 approach constrain armour to the road network.',
    advantage: 'Fast armour transit; dismount infantry into roadside cover before contact.' },
  { id: 'versiai', name: 'Veršiai',
    pos: { x: tx(STAGING_AREAS.versiai.x), y: ty(STAGING_AREAS.versiai.y) },
    approach: 'South-eastern axis · local lanes and farmyards', distanceKm: 3.4, risk: 'med',
    terrainNote: 'Local roads pass between woodland and dispersed farms.',
    advantage: 'Use courtyards and timber stacks as successive infantry positions.' },
  { id: 'straciunai', name: 'Stračiūnai',
    pos: { x: tx(STAGING_AREAS.straciunai.x), y: ty(STAGING_AREAS.straciunai.y) },
    approach: 'North-eastern axis · Merkinė road approach', distanceKm: 7.6, risk: 'high',
    terrainNote: 'Longer approach through a mixture of wooded lanes and open road sections.',
    advantage: 'Several approach junctions; recon the next bend before moving armour.' },
  { id: 'seirijai', name: 'Seirijų kryptis',
    pos: { x: tx(STAGING_AREAS.seirijai.x), y: ty(STAGING_AREAS.seirijai.y) },
    approach: 'Northern map edge · route 180 from Seirijai', distanceKm: 7.1, risk: 'low',
    terrainNote: 'Seirijai is outside this map. Your force stages on its southern approach road.',
    advantage: 'Direct paved corridor; use the forest margins to avoid exposure.' },
];

/** Spawn a layered enemy garrison: outer trench line, MG nests at 4 chokepoints,
 *  inner town defenders, forward outposts per approach village, and a reserve
 *  squad in the church square tagged for counterattack. */
function garrisonLeipalingis(units: Unit[], reserveIds: string[], outposts: Record<string, string[]>) {
  const L = LEIPALINGIS_ANCHORS.leipalingis;

  const tagDefend = (u: Unit) => {
    u.stance = 'defend'; u.order = 'hold_position'; u.homePos = { ...u.pos };
  };

  // ---------- Outer trench line: N / E / S / W approaches ----------
  const trenchLine: Array<[number, number]> = [
    // North approach
    [L.x - 4, L.y - 18], [L.x, L.y - 18], [L.x + 4, L.y - 18],
    // South approach
    [L.x - 4, L.y + 18], [L.x, L.y + 18], [L.x + 4, L.y + 18],
    // West approach
    [L.x - 18, L.y - 3], [L.x - 18, L.y + 3],
    // East approach
    [L.x + 18, L.y - 3], [L.x + 18, L.y + 3],
  ];
  for (const [gx, gy] of trenchLine) {
    const u = createUnit('infantry', 'enemy', tx(gx), ty(gy));
    tagDefend(u);
    units.push(u);
  }

  // ---------- MG nests at 4 chokepoints (sandbag rings) ----------
  const chokepoints: Array<[number, number]> = [
    [L.x, L.y - 12], [L.x, L.y + 12], [L.x - 12, L.y], [L.x + 12, L.y],
  ];
  for (const [gx, gy] of chokepoints) {
    const u = createUnit('infantry', 'enemy', tx(gx), ty(gy));
    tagDefend(u);
    u.accuracy = Math.min(1, u.accuracy + 0.15); // MG accuracy bonus
    (u as Unit & { _role?: string })._role = 'mg';
    units.push(u);
  }

  // ---------- Inner town defenders (garrison bulk) ----------
  const inner: Array<[number, number]> = [
    [L.x - 8, L.y - 6], [L.x + 8, L.y - 6],
    [L.x - 8, L.y + 6], [L.x + 8, L.y + 6],
    [L.x - 2, L.y - 2],
  ];
  for (const [gx, gy] of inner) {
    const u = createUnit('infantry', 'enemy', tx(gx), ty(gy));
    tagDefend(u);
    units.push(u);
  }

  // ---------- Church square reserve (counterattack squad) ----------
  const reserveSpots: Array<['infantry' | 'apc' | 'tank', number, number]> = [
    ['infantry', L.x - 1, L.y + 1],
    ['infantry', L.x + 1, L.y + 1],
    ['infantry', L.x, L.y + 2],
    ['apc', L.x - 2, L.y + 3],
    ['tank', L.x + 3, L.y - 1],
  ];
  for (const [t, gx, gy] of reserveSpots) {
    const u = createUnit(t, 'enemy', tx(gx), ty(gy));
    tagDefend(u);
    (u as Unit & { _role?: string })._role = 'reserve';
    reserveIds.push(u.id);
    units.push(u);
  }

  // ---------- Forward outposts, one small squad per approach village ----------
  const villages: Array<[string, number, number]> = [
    ['jovaisiai',   LEIPALINGIS_ANCHORS.jovaisiai.x,   LEIPALINGIS_ANCHORS.jovaisiai.y],
    ['didziasalis', LEIPALINGIS_ANCHORS.didziasalis.x, LEIPALINGIS_ANCHORS.didziasalis.y],
    ['versiai',     LEIPALINGIS_ANCHORS.versiai.x,     LEIPALINGIS_ANCHORS.versiai.y],
    ['straciunai',  LEIPALINGIS_ANCHORS.straciunai.x,  LEIPALINGIS_ANCHORS.straciunai.y],
    ['seirijai',    LEIPALINGIS_ANCHORS.seirijai.x,    LEIPALINGIS_ANCHORS.seirijai.y],
  ];
  for (const [id, vx, vy] of villages) {
    // Position outpost between village and Leipalingis (so player has to fight through it).
    const dx = L.x - vx, dy = L.y - vy;
    const len = Math.hypot(dx, dy) || 1;
    const ox = Math.round(vx + (dx / len) * 12);
    const oy = Math.round(vy + (dy / len) * 12);
    const spots: Array<['infantry' | 'apc', number, number]> = [
      ['infantry', ox - 1, oy], ['infantry', ox + 1, oy],
    ];
    // Add an APC to two of the villages for variety
    if (id === 'didziasalis' || id === 'straciunai') spots.push(['apc', ox, oy + 1]);
    const ids: string[] = [];
    for (const [t, gx, gy] of spots) {
      const u = createUnit(t, 'enemy', tx(gx), ty(gy));
      tagDefend(u);
      (u as Unit & { _role?: string })._role = 'outpost';
      ids.push(u.id);
      units.push(u);
    }
    outposts[id] = ids;
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
    // Keep the deployed force compact in the roadside staging area outside the village.
    const row = Math.floor(slot / 5);
    const col = (slot % 5) - 2;
    const px = cx + rightX * col * 32 - fwdX * row * 32;
    const py = cy + rightY * col * 32 - fwdY * row * 32;
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
  'You command a detachment staging near Jovaišiai to the north, Didžiasalis to the south, Veršiai to the south-east, Stračiūnai to the north-east, or on route 180 from Seirijai at the northern map edge. The road and woodland layout is based on OpenStreetMap, compressed for play. Paved roads increase movement speed by 46% but detection builds 50% faster. Gravel shoulders and farm tracks are slower. Recon, manoeuvre, use terrain — then retake the town.',
  '',
  'TERRAIN: right-click a farmhouse, timber stack, stone wall, hay bales, abandoned truck or barricade to occupy cover and hold. Each infantry unit claims a separate nearby position. Use Shift+right-click for ordinary queued movement. Home focuses your troops.',
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
    const reserveIds: string[] = [];
    const outpostIds: Record<string, string[]> = {};
    garrisonLeipalingis(s.units!, reserveIds, outpostIds);
    s.script!.__reserveIds = reserveIds;
    s.script!.__outpostIds = outpostIds;
    s.script!.__counterattackFired = false;
    s.script!.__counterBannerUntil = 0;
    s.script!.__clearedVillages = {};
    s.script!.__deployTown = town.id;
    // Starting player strength for defeat check (sum of max HP)
    s.script!.__startStrength = s.units!.filter(u => u.team === 'player').reduce((n, u) => n + u.maxHealth, 0);
    s.script!.__startTime = 0;
    s.script!.__killsEnemy = 0;
    s.script!.__lossesPlayer = 0;
    s.script!.__prevEnemyAlive = s.units!.filter(u => u.alive && u.team === 'enemy').length;
    s.script!.__prevPlayerAlive = s.units!.filter(u => u.alive && u.team === 'player').length;

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
      id: 'preserve_armour',
      description: 'Keep at least one friendly tank alive',
      status: 'active', optional: true,
    });
    // Secondary "clear the approach outposts" objectives (skip the deploy town)
    const villageNames: Record<string, string> = {
      jovaisiai: 'Jovaišiai', didziasalis: 'Didžiasalis', versiai: 'Veršiai',
      straciunai: 'Stračiūnai', seirijai: 'Seirijų kryptis',
    };
    for (const vid of Object.keys(outpostIds)) {
      if (vid === town.id) continue;
      s.objectives!.push({
        id: `clear_${vid}`,
        description: `Clear the ${villageNames[vid]} outpost`,
        status: 'active', optional: true,
      });
    }
    return s;
  },
  update: (state: GameState, dt: number) => {
    // ---------- Kill / loss tracking (delta-based) ----------
    const enemyAlive = state.units.filter(u => u.alive && u.team === 'enemy').length;
    const playerAlive = state.units.filter(u => u.alive && u.team === 'player').length;
    const prevEnemy = state.script.__prevEnemyAlive as number | undefined;
    const prevPlayer = state.script.__prevPlayerAlive as number | undefined;
    if (prevEnemy !== undefined && enemyAlive < prevEnemy) {
      state.script.__killsEnemy = (state.script.__killsEnemy as number ?? 0) + (prevEnemy - enemyAlive);
    }
    if (prevPlayer !== undefined && playerAlive < prevPlayer) {
      state.script.__lossesPlayer = (state.script.__lossesPlayer as number ?? 0) + (prevPlayer - playerAlive);
    }
    state.script.__prevEnemyAlive = enemyAlive;
    state.script.__prevPlayerAlive = playerAlive;


    const cp = state.capturePoints.find(c => c.id === 'town_centre');
    if (cp) {
      const here = state.units.filter(u => u.alive && !u.insideOf && distance(u.pos, cp.pos) < cp.radius);
      const p = here.filter(u => u.team === 'player').length;
      const e = here.filter(u => u.team === 'enemy').length;
      if (p > 0 && e === 0) cp.progress = Math.min(1, cp.progress + dt * (2 / 90));       // 0→1 in ~90s from empty
      else if (e > 0 && p === 0) cp.progress = Math.max(-1, cp.progress - dt * (2 / 120));// enemies retake slower
      else if (p > 0 && e > 0) cp.progress = Math.max(-1, cp.progress - dt * 0.05);       // contested: slight decay
      if (cp.progress >= 0.9) cp.owner = 'player';
      else if (cp.progress <= -0.9) cp.owner = 'enemy';
      else cp.owner = 'neutral';

      // ---------- Counterattack trigger ----------
      if (!state.script.__counterattackFired && p > 0) {
        state.script.__counterattackFired = true;
        state.script.__counterBannerUntil = state.time + 6;
        const ids = (state.script.__reserveIds as string[]) ?? [];
        for (const id of ids) {
          const u = state.units.find(x => x.id === id && x.alive);
          if (!u) continue;
          u.order = 'attack_move';
          u.stance = 'aggressive';
          setDestination(u, state, cp.pos);
        }
        state.eventLog.unshift({
          message: 'Enemy reserves counterattacking from the church square!',
          time: state.time, type: 'contact',
        });
      }
    }

    // ---------- Secondary: clear village outposts (grants reinforcements) ----------
    const cleared = state.script.__clearedVillages as Record<string, boolean>;
    const outpostIds = state.script.__outpostIds as Record<string, string[]>;
    for (const vid of Object.keys(outpostIds ?? {})) {
      if (cleared[vid]) continue;
      const ids = outpostIds[vid];
      const alive = state.units.some(u => u.alive && u.team === 'enemy' && ids.includes(u.id));
      if (!alive) {
        cleared[vid] = true;
        const obj = state.objectives.find(o => o.id === `clear_${vid}`);
        if (obj) obj.status = 'complete';
        state.reinforcementBudget += 60; // enough for one infantry reinforcement (50)
        state.eventLog.unshift({
          message: `${vid} outpost cleared — reinforcements granted`,
          time: state.time, type: 'reward',
        });
      }
    }

    // ---------- Optional: preserve armour ----------
    const armourObj = state.objectives.find(o => o.id === 'preserve_armour');
    if (armourObj && armourObj.status === 'active') {
      const tankAlive = state.units.some(u => u.alive && u.team === 'player' && u.type === 'tank');
      if (!tankAlive) armourObj.status = 'failed';
    }

    // ---------- Win/loss ----------
    const capObj = state.objectives.find(o => o.id === 'capture_centre');
    const centreHeld = cp?.owner === 'player' && (cp?.progress ?? 0) >= 1;
    if (capObj && capObj.status === 'active' && centreHeld) capObj.status = 'complete';

    if (!state.gameOver && centreHeld) {
      if (armourObj?.status === 'active') armourObj.status = 'complete';
      state.gameOver = true; state.gameResult = 'win';
      state.eventLog.unshift({ message: 'Leipalingis retaken. Silver Birch complete.', time: state.time, type: 'objective' });
    }

    // Defeat: <25% starting strength AND not holding centre
    const startStrength = (state.script.__startStrength as number) || 1;
    const curStrength = state.units.filter(u => u.alive && u.team === 'player').reduce((n, u) => n + u.health, 0);
    if (!state.gameOver && curStrength / startStrength < 0.25 && !centreHeld) {
      state.gameOver = true; state.gameResult = 'lose';
      state.eventLog.unshift({ message: 'Force combat-ineffective. Withdrawal ordered.', time: state.time, type: 'objective' });
    }
    if (!state.gameOver && !state.units.some(u => u.alive && u.team === 'player')) {
      state.gameOver = true; state.gameResult = 'lose';
    }
  },
};

export const MISSIONS: MissionDef[] = [leipalingisMission];
export function getMission(_id?: string): MissionDef { return leipalingisMission; }
export { DEPLOYMENT_TOWNS };
