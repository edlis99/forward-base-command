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
      straciunai: 'Stračiūnai', seirijai: 'Seirijai',
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
    // ---------- Capture progress at town centre (~90s uncontested to flip) ----------
    const cp = state.capturePoints.find(c => c.id === 'town_centre');
    if (cp) {
      const here = state.units.filter(u => u.alive && distance(u.pos, cp.pos) < cp.radius);
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
        state.reinforcementBudget += 60; // token — ~2 infantry
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
