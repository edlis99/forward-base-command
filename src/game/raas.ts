import { CapturePoint, GameState, MapLayoutId, MissionDef, Position, Team, Unit, UnitType } from './types';
import { createUnit, distance } from './units';
import { random } from './rng';
import { applyCommand } from './commands';
import { controllerOf } from './controllers';

/**
 * RAAS (Random Advance and Secure), competitive variant from
 * docs/squad_gameplay_and_competitive_map_design.md (copied into the repo):
 *  - one authored chain is drawn from a validated pool before deployment and
 *    shown to both sides at once;
 *  - objectives are captured in order: a side may only attack the point just
 *    beyond the unbroken run it holds from its own end of the chain, and must
 *    keep that run to advance (recapture works in both directions);
 *  - only dismounted infantry capture; the attacker needs a minimum commitment
 *    and more infantry in the zone than the defender, equal strength stalls;
 *  - extra infantry speed capture up to a cap; progress drains back when the
 *    attackers leave, so running through a marker does nothing;
 *  - tickets: losses cost tickets, losing a point costs tickets, holding a
 *    clear territorial lead drains the opponent. No capture grants combat power.
 * All values below are first-pass test values, not tuned balance.
 */

export interface RaasObjectiveDef { id: string; name: string; pos: Position; radius?: number }
/** Objectives ordered from the 'player' main to the 'enemy' main. */
export interface RaasChain { id: string; name: string; objectives: RaasObjectiveDef[] }

export interface RaasRules {
  startTickets: number;
  ticketsPerLoss: Record<UnitType, number>;
  ticketsOnPointLost: number;
  /** Seconds to neutralise an enemy point / capture a neutral one at minimum strength. */
  neutraliseSeconds: number;
  captureSeconds: number;
  /** Minimum infantry in the zone to neutralise an enemy point / capture a neutral one. */
  minToNeutralise: number;
  minToCapture: number;
  /** Each infantry beyond a one-man advantage adds this much speed, up to maxSpeedBonus x. */
  extraInfantryBonus: number;
  maxSpeedBonus: number;
  /** Seconds for an abandoned attempt to drain fully back to the owner. */
  regenSeconds: number;
  /** Lead (points held minus opponent's) at which the opponent starts to bleed. */
  bleedLead: number;
  /** Seconds per ticket drained, per point of lead at or beyond bleedLead. */
  bleedInterval: number;
  timeLimit: number;
}

export const DEFAULT_RAAS_RULES: RaasRules = {
  startTickets: 300,
  ticketsPerLoss: { infantry: 5, apc: 15, tank: 25, helicopter: 25 },
  ticketsOnPointLost: 20,
  neutraliseSeconds: 40, captureSeconds: 40,
  minToNeutralise: 2, minToCapture: 1,
  extraInfantryBonus: 0.25, maxSpeedBonus: 2,
  regenSeconds: 60,
  bleedLead: 2, bleedInterval: 5,
  timeLimit: 1800,
};

export type ObjectiveStatus = 'secured' | 'locked' | 'neutralising' | 'capturing' | 'contested' | 'stalled' | 'recovering';

export interface RaasObjective {
  id: string; name: string; pos: Position; radius: number;
  owner: Team | 'neutral';
  /** -1 = enemy held, 0 = neutral, +1 = player held. */
  progress: number;
  status: ObjectiveStatus;
  /** Why progress is or is not happening, in plain words for the HUD. */
  reason: string;
  eligible: Record<Team, boolean>;
  present: Record<Team, number>;
}

export interface RaasState {
  chainId: string; chainName: string;
  objectives: RaasObjective[];
  tickets: Record<Team, number>;
  rules: RaasRules;
  /** Units whose loss has been charged. */
  charged: Record<string, true>;
  bleed: Record<Team, number>;
  aiTimer: number;
}

const other = (t: Team): Team => (t === 'player' ? 'enemy' : 'player');
const sign = (t: Team) => (t === 'player' ? 1 : -1);

/** Deterministically draw one chain from the validated pool. */
export function pickChain(pool: RaasChain[], seed: number): RaasChain {
  return pool[Math.floor(random({ rngState: seed | 0 }) * pool.length) % pool.length];
}

/** Index of the point a side may attack right now, or -1 if it holds the whole chain. */
export function attackIndex(objectives: Pick<RaasObjective, 'owner'>[], team: Team): number {
  const n = objectives.length;
  if (team === 'player') {
    let i = 0;
    while (i < n && objectives[i].owner === 'player') i++;
    return i < n ? i : -1;
  }
  let i = n - 1;
  while (i >= 0 && objectives[i].owner === 'enemy') i--;
  return i;
}

function infantryIn(state: GameState, o: RaasObjective): Record<Team, number> {
  const present = { player: 0, enemy: 0 };
  for (const u of state.units) {
    if (u.alive && !u.insideOf && u.type === 'infantry' && distance(u.pos, o.pos) < o.radius) present[u.team]++;
  }
  return present;
}

function stepObjective(state: GameState, r: RaasState, o: RaasObjective, dt: number) {
  const rules = r.rules;
  o.present = infantryIn(state, o);
  const attacker = (['player', 'enemy'] as Team[]).find(t => o.eligible[t] && o.present[t] > o.present[other(t)]);

  if (attacker) {
    const neutralising = o.owner === other(attacker);
    const need = neutralising ? rules.minToNeutralise : rules.minToCapture;
    if (o.present[attacker] < need) {
      o.status = 'stalled';
      o.reason = `${attacker} needs ${need} infantry here to ${neutralising ? 'neutralise' : 'capture'}`;
      return;
    }
    const lead = o.present[attacker] - o.present[other(attacker)];
    const speed = Math.min(rules.maxSpeedBonus, 1 + rules.extraInfantryBonus * (lead - 1));
    const seconds = neutralising ? rules.neutraliseSeconds : rules.captureSeconds;
    const before = o.owner;
    o.progress += sign(attacker) * (dt / seconds) * speed;
    o.progress = Math.max(-1, Math.min(1, o.progress));
    if (o.owner === other(attacker) && sign(attacker) * o.progress >= 0) {
      o.owner = 'neutral'; o.progress = 0;
    } else if (o.owner === 'neutral' && sign(attacker) * o.progress >= 1) {
      o.owner = attacker; o.progress = sign(attacker);
    }
    o.status = o.owner === other(attacker) ? 'neutralising' : o.owner === attacker ? 'secured' : 'capturing';
    o.reason = o.status === 'secured' ? `${attacker} secured ${o.name}` : `${attacker} ${o.status}, outnumbering the defence`;
    if (before !== o.owner && before !== 'neutral') {
      r.tickets[before] -= rules.ticketsOnPointLost;
      state.eventLog.unshift({ message: `${o.name} neutralised by ${attacker}`, time: state.time, type: 'objective' });
    } else if (before !== o.owner) {
      state.eventLog.unshift({ message: `${attacker} captured ${o.name}`, time: state.time, type: 'objective' });
    }
    return;
  }

  // Nobody is pushing: report why, and drain an abandoned attempt back to the owner.
  const p = o.present.player, e = o.present.enemy;
  if (p > 0 && e > 0 && p === e && (o.eligible.player || o.eligible.enemy)) {
    o.status = 'contested'; o.reason = 'contested: equal strength stalls capture';
    return;
  }
  const home = o.owner === 'neutral' ? 0 : sign(o.owner);
  if (o.progress !== home) {
    const step = (2 / rules.regenSeconds) * dt;
    o.progress = o.progress < home ? Math.min(home, o.progress + step) : Math.max(home, o.progress - step);
    o.status = 'recovering'; o.reason = 'attempt abandoned, progress draining back';
  } else if (!o.eligible.player && !o.eligible.enemy) {
    o.status = o.owner === 'neutral' ? 'locked' : 'secured';
    o.reason = o.owner === 'neutral' ? 'not next in sequence for either side' : `held by ${o.owner}`;
  } else {
    o.status = o.owner === 'neutral' ? 'locked' : 'secured';
    const who = (['player', 'enemy'] as Team[]).filter(t => o.eligible[t]).join(' and ');
    o.reason = `open to ${who}; no attacking infantry`;
  }
  if ((p > 0 && !o.eligible.player) || (e > 0 && !o.eligible.enemy)) {
    const t: Team = p > 0 && !o.eligible.player ? 'player' : 'enemy';
    if (!o.eligible[other(t)] || o.present[other(t)] === 0) o.reason = `${t} cannot capture yet: take the previous objective first`;
  }
}

export function updateRaas(state: GameState, dt: number) {
  const r = state.raas;
  if (!r || state.gameOver) return;
  const rules = r.rules;

  // Eligibility is decided from ownership at the start of the tick, for both sides at once.
  const atk = { player: attackIndex(r.objectives, 'player'), enemy: attackIndex(r.objectives, 'enemy') };
  r.objectives.forEach((o, i) => { o.eligible = { player: i === atk.player, enemy: i === atk.enemy }; });
  for (const o of r.objectives) stepObjective(state, r, o, dt);

  // Losses.
  for (const u of state.units) {
    if (u.alive || r.charged[u.id]) continue;
    r.charged[u.id] = true;
    r.tickets[u.team] -= rules.ticketsPerLoss[u.type];
  }

  // Territorial drain.
  const held = { player: 0, enemy: 0 };
  for (const o of r.objectives) if (o.owner !== 'neutral') held[o.owner]++;
  for (const t of ['player', 'enemy'] as Team[]) {
    const lead = held[other(t)] - held[t];
    if (lead >= rules.bleedLead) {
      r.bleed[t] += dt * (lead - rules.bleedLead + 1) / rules.bleedInterval;
      const whole = Math.floor(r.bleed[t]);
      if (whole > 0) { r.tickets[t] -= whole; r.bleed[t] -= whole; }
    }
  }

  // Keep the generic capture markers (HUD / 3D scene) in sync.
  state.capturePoints = r.objectives.map((o): CapturePoint => ({ id: o.id, label: o.name, pos: o.pos, radius: o.radius, owner: o.owner, progress: o.progress }));

  // Outcome.
  const alive = (t: Team) => state.units.some(u => u.alive && u.team === t);
  let winner: Team | null | undefined;
  const out = { player: r.tickets.player <= 0 || !alive('player'), enemy: r.tickets.enemy <= 0 || !alive('enemy') };
  if (out.player && out.enemy) winner = r.tickets.player === r.tickets.enemy ? null : r.tickets.player > r.tickets.enemy ? 'player' : 'enemy';
  else if (out.player) winner = 'enemy';
  else if (out.enemy) winner = 'player';
  else if (state.time >= rules.timeLimit) winner = r.tickets.player === r.tickets.enemy ? null : r.tickets.player > r.tickets.enemy ? 'player' : 'enemy';
  if (winner === undefined) return;
  state.gameOver = true; state.winner = winner;
  state.gameResult = winner === 'player' ? 'win' : winner === 'enemy' ? 'lose' : null;
  state.eventLog.unshift({ message: winner ? `${winner} wins (${r.tickets.player} v ${r.tickets.enemy} tickets)` : 'RAAS match drawn', time: state.time, type: 'objective' });
}

// ---------------- simple AI commander (same rules and information as a human) ----------------

const AI_INTERVAL = 4;
const DEFEND_SHARE = 0.3;

/**
 * Plays RAAS for every AI-controlled side: a share of the infantry guards the
 * side's front objective, the rest plus all vehicles attack the next eligible
 * point. Orders go through applyCommand, so the AI obeys the same rules.
 */
export function updateRaasAi(state: GameState, dt: number) {
  const r = state.raas;
  if (!r || state.gameOver) return;
  r.aiTimer -= dt;
  if (r.aiTimer > 0) return;
  r.aiTimer = AI_INTERVAL;
  for (const team of ['player', 'enemy'] as Team[]) {
    if (controllerOf(state, team) !== 'ai') continue;
    const attack = attackIndex(r.objectives, team);
    const front = team === 'player' ? attack - 1 : attack + 1;
    const units = state.units.filter(u => u.alive && !u.insideOf && u.team === team);
    const infantry = units.filter(u => u.type === 'infantry');
    const defendObj = r.objectives[attack === -1 ? (team === 'player' ? r.objectives.length - 1 : 0) : front];
    const attackObj = attack >= 0 ? r.objectives[attack] : undefined;

    const defenders = new Set<string>();
    if (defendObj && attackObj) {
      const n = Math.round(infantry.length * DEFEND_SHARE);
      [...infantry].sort((a, b) => distance(a.pos, defendObj.pos) - distance(b.pos, defendObj.pos)).slice(0, n).forEach(u => defenders.add(u.id));
    }
    const needsOrder = (u: Unit, goal: RaasObjective) => !u.targetPos && distance(u.pos, goal.pos) > goal.radius * 0.6 ||
      (!!u.finalDest && distance(u.finalDest, goal.pos) > goal.radius);
    const send = (list: Unit[], goal: RaasObjective | undefined) => {
      if (!goal) return;
      const ids = list.filter(u => needsOrder(u, goal)).map(u => u.id);
      if (ids.length) applyCommand(state, team, { type: 'move', unitIds: ids, x: goal.pos.x, y: goal.pos.y, attackMove: true });
    };
    send(units.filter(u => defenders.has(u.id)), defendObj);
    send(units.filter(u => !defenders.has(u.id)), attackObj ?? defendObj);
  }
}

// ---------------- mission builder ----------------

export interface RaasSetup {
  name: string;
  mapLayout: MapLayoutId;
  mapSeed?: number;
  chain: RaasChain;
  /** Deployment areas (not objectives). */
  mains: Record<Team, Position>;
  composition: { infantry: number; tank: number; apc: number };
  rules?: Partial<RaasRules>;
}

function deploy(team: Team, main: Position, toward: Position, comp: RaasSetup['composition']): Unit[] {
  const len = Math.hypot(toward.x - main.x, toward.y - main.y) || 1;
  const fwd = { x: (toward.x - main.x) / len, y: (toward.y - main.y) / len }, right = { x: -fwd.y, y: fwd.x };
  const units: Unit[] = [];
  let row = 0;
  for (const type of ['infantry', 'tank', 'apc'] as const) {
    for (let i = 0; i < comp[type]; i++) {
      const col = (i % 4) - 1.5, depth = row + Math.floor(i / 4);
      const u = createUnit(type, team, main.x + right.x * col * 36 - fwd.x * depth * 40, main.y + right.y * col * 36 - fwd.y * depth * 40);
      u.facing = Math.atan2(fwd.y, fwd.x);
      u.homePos = { ...u.pos };
      units.push(u);
    }
    row += Math.ceil(comp[type] / 4);
  }
  return units;
}

export function makeRaasMission(setup: RaasSetup): MissionDef {
  const rules: RaasRules = { ...DEFAULT_RAAS_RULES, ...setup.rules, ticketsPerLoss: { ...DEFAULT_RAAS_RULES.ticketsPerLoss, ...setup.rules?.ticketsPerLoss } };
  const objs = setup.chain.objectives;
  return {
    id: 'raas',
    name: setup.name,
    summary: `RAAS: ${setup.chain.name}`,
    briefing: `Objective chain "${setup.chain.name}": ${objs.map(o => o.name).join(' → ')}. Capture in order, hold your line, drain the enemy's tickets.`,
    rewardKills: false,
    mapLayout: setup.mapLayout,
    mapSeed: setup.mapSeed,
    init: () => {
      const objectives: RaasObjective[] = objs.map((o, i) => {
        const owner: Team | 'neutral' = i === 0 ? 'player' : i === objs.length - 1 ? 'enemy' : 'neutral';
        return { id: o.id, name: o.name, pos: { ...o.pos }, radius: o.radius ?? 140, owner, progress: owner === 'player' ? 1 : owner === 'enemy' ? -1 : 0,
          status: owner === 'neutral' ? 'locked' : 'secured', reason: '', eligible: { player: false, enemy: false }, present: { player: 0, enemy: 0 } };
      });
      const raas: RaasState = { chainId: setup.chain.id, chainName: setup.chain.name, objectives,
        tickets: { player: rules.startTickets, enemy: rules.startTickets }, rules, charged: {}, bleed: { player: 0, enemy: 0 }, aiTimer: 0 };
      const mid = objs[Math.floor(objs.length / 2)].pos;
      return {
        units: [...deploy('player', setup.mains.player, mid, setup.composition), ...deploy('enemy', setup.mains.enemy, mid, setup.composition)],
        capturePoints: objectives.map(o => ({ id: o.id, label: o.name, pos: o.pos, radius: o.radius, owner: o.owner, progress: o.progress })),
        objectives: [{ id: 'raas', description: `Drain the enemy's tickets: ${objs.map(o => o.name).join(' → ')}`, status: 'active' }],
        raas,
      };
    },
    update: (state, dt) => { updateRaasAi(state, dt); updateRaas(state, dt); },
  };
}
