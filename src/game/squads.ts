import { GameState, Unit, Position } from './types';
import { CELL_SIZE } from './constants';
import { distance, setDestination } from './units';
import { memoryAt, threatAt } from './threatMap';

/**
 * Enemy squad controller.
 * Clusters living enemies into squads by proximity, assigns a squad role,
 * and posts a shared rally / focus target onto each member so per-unit AI
 * (in ai.ts) executes coordinated movement instead of lone-wolf rushes.
 *
 * Per-unit AI is NOT replaced; squads only set `squadRally` + `squadFocus`
 * tags that ai.ts can prefer over isolated decisions.
 */

type Role = 'assault' | 'flank' | 'support' | 'regroup';

interface Squad {
  id: string;
  members: Unit[];
  center: Position;
  role: Role;
  rally: Position | null;
  focus: Unit | null;
}

const CLUSTER_RADIUS = 220;
const RECOMPUTE_INTERVAL = 1.25;

interface SquadState {
  lastTime: number;
  squads: Squad[];
  /** memberCount per squad-leader id from previous recompute, used to detect losses */
  prevCounts: Record<string, number>;
}

function getSquadState(state: GameState): SquadState {
  const s = state.script as Record<string, unknown>;
  let st = s.__squads as SquadState | undefined;
  if (!st) { st = { lastTime: -999, squads: [], prevCounts: {} }; s.__squads = st; }
  return st;
}

function clusterEnemies(state: GameState): Squad[] {
  const enemies = state.units.filter(u => u.alive && u.team === 'enemy' && !u.insideOf);
  const used = new Set<string>();
  const squads: Squad[] = [];
  let id = 0;
  for (const seed of enemies) {
    if (used.has(seed.id)) continue;
    const members: Unit[] = [seed]; used.add(seed.id);
    // BFS within CLUSTER_RADIUS
    for (let i = 0; i < members.length; i++) {
      for (const e of enemies) {
        if (used.has(e.id)) continue;
        if (distance(members[i].pos, e.pos) <= CLUSTER_RADIUS) {
          members.push(e); used.add(e.id);
        }
      }
    }
    const cx = members.reduce((s, m) => s + m.pos.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.pos.y, 0) / members.length;
    squads.push({
      id: `sq_${id++}`,
      members,
      center: { x: cx, y: cy },
      role: 'assault',
      rally: null,
      focus: null,
    });
  }
  return squads;
}

/** Pick squad role based on health, ammo, morale aggregate + threat + suppression. */
function pickRole(squad: Squad, state: GameState): Role {
  const m = squad.members;
  const avgHealth = m.reduce((s, u) => s + u.health / u.maxHealth, 0) / m.length;
  const avgMorale = m.reduce((s, u) => s + u.morale, 0) / m.length;
  const avgSuppression = m.reduce((s, u) => s + u.suppression, 0) / m.length;
  const localThreat = threatAt(state, 'enemy', squad.center.x, squad.center.y);

  // Pinned-down squad: pull back to recover
  if (avgSuppression > 0.55 && avgMorale < 0.55) return 'regroup';
  if (avgHealth < 0.35 || avgMorale < 0.3) return 'regroup';
  if (localThreat > 0.55 && avgHealth < 0.7) return 'support';
  // mixed-arms with vehicle = assault, infantry-heavy with known target = flank
  const hasVehicle = m.some(u => u.type === 'tank' || u.type === 'apc');
  if (!hasVehicle && m.length >= 3 && avgSuppression < 0.35) return 'flank';
  return 'assault';
}

/** Pick a shared focus enemy (visible to ANY member) by threat + proximity. */
function pickFocus(squad: Squad, state: GameState): Unit | null {
  const visible = state.units.filter(u =>
    u.alive && u.team === 'player' && !u.insideOf && u.spottedByEnemy
  );
  if (visible.length === 0) return null;
  let best: Unit | null = null; let bestScore = -Infinity;
  for (const v of visible) {
    const d = distance(v.pos, squad.center);
    const threat = v.type === 'tank' ? 1.4 : v.type === 'apc' ? 1.1 : v.type === 'helicopter' ? 1.3 : 1.0;
    const score = -d * 0.01 + threat * 50 - v.health / v.maxHealth * 20;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best;
}

/** Pick a rally / approach point for the squad based on role + memory. */
function pickRally(squad: Squad, state: GameState): Position | null {
  const focus = squad.focus;
  if (squad.role === 'regroup') {
    // pull back toward home of the leader (highest health member)
    const leader = [...squad.members].sort((a, b) => b.health - a.health)[0];
    return leader?.homePos ?? null;
  }
  if (!focus) {
    // search toward last-known memory hotspot
    if (!state.threat) return null;
    const field = state.threat.lastSeenPlayer;
    let bestIdx = -1, bestVal = 0.05;
    for (let i = 0; i < field.length; i++) if (field[i] > bestVal) { bestVal = field[i]; bestIdx = i; }
    if (bestIdx < 0) return null;
    const cols = Math.ceil(state.mapWidth / (CELL_SIZE * 4));
    const cw = CELL_SIZE * 4;
    const gx = bestIdx % cols, gy = Math.floor(bestIdx / cols);
    return { x: gx * cw + cw / 2, y: gy * cw + cw / 2 };
  }
  // role-based offset around focus
  const dx = focus.pos.x - squad.center.x;
  const dy = focus.pos.y - squad.center.y;
  const len = Math.hypot(dx, dy) || 1;
  if (squad.role === 'flank') {
    const sign = (squad.id.charCodeAt(squad.id.length - 1) % 2) === 0 ? 1 : -1;
    const px = -dy / len * sign, py = dx / len * sign;
    const standoff = 160;
    return { x: focus.pos.x - dx / len * standoff + px * 220, y: focus.pos.y - dy / len * standoff + py * 220 };
  }
  if (squad.role === 'support') {
    // stay back, hold cover near current center
    return { x: squad.center.x - dx / len * 60, y: squad.center.y - dy / len * 60 };
  }
  // assault: push toward focus at standoff
  const standoff = 100;
  return { x: focus.pos.x - dx / len * standoff, y: focus.pos.y - dy / len * standoff };
}

export function updateSquads(state: GameState, dt: number) {
  const st = getSquadState(state);
  if (state.time - st.lastTime < RECOMPUTE_INTERVAL) {
    // still apply existing tags so freshly-spawned units inherit nothing stale
    return;
  }
  st.lastTime = state.time;
  const nextSquads = clusterEnemies(state);
  const newCounts: Record<string, number> = {};

  for (const sq of nextSquads) {
    sq.role = pickRole(sq, state);
    sq.focus = pickFocus(sq, state);
    sq.rally = pickRally(sq, state);

    // Casualty shock: if previous squad with similar leader had more members, dock morale
    const leaderKey = sq.members[0]?.id ?? sq.id;
    const prev = st.prevCounts[leaderKey] ?? sq.members.length;
    const losses = Math.max(0, prev - sq.members.length);
    if (losses > 0) {
      const shock = Math.min(0.35, losses * 0.12);
      for (const u of sq.members) {
        u.morale = Math.max(0.05, u.morale - shock);
        u.suppression = Math.min(1, u.suppression + shock * 0.5);
      }
    }
    newCounts[leaderKey] = sq.members.length;

    // Stamp tags onto members for ai.ts to read
    for (const u of sq.members) {
      const tag = u as Unit & { _squadRally?: Position | null; _squadFocus?: string | null; _squadRole?: Role };
      tag._squadRally = sq.rally;
      tag._squadFocus = sq.focus?.id ?? null;
      tag._squadRole = sq.role;
    }

    // Regrouping squads: ordered retreat to rally
    if (sq.role === 'regroup' && sq.rally) {
      for (const u of sq.members) {
        if (u.order === 'retreat') continue;
        if (distance(u.pos, sq.rally) < 80) continue;
        if (u.attackTarget && u.health / u.maxHealth > 0.45 && u.suppression < 0.5) continue;
        setDestination(u, state, sq.rally);
        u.order = 'attack_move';
      }
    }

    // Support squads near rally: accelerate morale/suppression recovery (in cover, catching breath)
    if (sq.role === 'support') {
      for (const u of sq.members) {
        u.morale = Math.min(1, u.morale + dt * 0.06);
        u.suppression = Math.max(0, u.suppression - dt * 0.08);
      }
    }
  }

  st.squads = nextSquads;
  st.prevCounts = newCounts;
}
}
