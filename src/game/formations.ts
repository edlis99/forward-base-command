import { Unit, Position, FormationType } from './types';
import { findNearestPassableWorld, isFootprintPassable } from './terrain';

export function pickFormation(units: Unit[]): FormationType {
  const hasArmor = units.some(u => u.type === 'tank' || u.type === 'apc');
  if (hasArmor) return 'wedge';
  return 'line';
}

/** Generate raw slot positions for `n` units of the given formation type. */
function slotPositions(n: number, anchor: Position, facing: number, type: FormationType, spacing: number): Position[] {
  const fwd = { x: Math.cos(facing), y: Math.sin(facing) };
  const right = { x: -fwd.y, y: fwd.x };
  const out: Position[] = [];
  for (let i = 0; i < n; i++) {
    if (type === 'line') {
      const lateral = (i - (n - 1) / 2) * spacing;
      out.push({ x: anchor.x + right.x * lateral, y: anchor.y + right.y * lateral });
    } else if (type === 'column') {
      const back = -i * spacing * 1.4;
      out.push({ x: anchor.x + fwd.x * back, y: anchor.y + fwd.y * back });
    } else {
      const row = Math.floor((i + 1) / 2);
      const side = i % 2 === 0 ? -1 : 1;
      const lateral = row * spacing * side;
      const back = -row * spacing * 0.8;
      out.push({
        x: anchor.x + fwd.x * back + right.x * lateral,
        y: anchor.y + fwd.y * back + right.y * lateral,
      });
    }
  }
  return out;
}

/**
 * Compute formation slot positions for the given units, anchored at `anchor`,
 * oriented along `facing` (radians, world-space angle).
 *
 * Slots are assigned by greedy nearest-pair matching (closest unit/slot pair
 * first) so units keep their relative arrangement and don't cross each other's
 * paths on the way to the destination. Heavy units still bias toward the front
 * slots via a small ordering weight.
 */
export function computeFormation(
  units: Unit[],
  anchor: Position,
  facing: number,
  type: FormationType,
  spacing = 36,
): { id: string; pos: Position }[] {
  const ground = units.filter(u => u.type !== 'helicopter');
  const heli = units.filter(u => u.type === 'helicopter');
  const fwd = { x: Math.cos(facing), y: Math.sin(facing) };
  const right = { x: -fwd.y, y: fwd.x };

  const slots = slotPositions(ground.length, anchor, facing, type, spacing);
  const out: { id: string; pos: Position }[] = [];

  // Greedy nearest matching between units and slots, with a role weight so
  // tanks/APCs prefer forward slots (lower index) and infantry trail.
  const roleWeight = (u: Unit) => (u.type === 'tank' ? 0 : u.type === 'apc' ? 1 : 2);
  const pairs: { ui: number; si: number; cost: number }[] = [];
  for (let ui = 0; ui < ground.length; ui++) {
    for (let si = 0; si < slots.length; si++) {
      const dx = ground[ui].pos.x - slots[si].x;
      const dy = ground[ui].pos.y - slots[si].y;
      pairs.push({ ui, si, cost: Math.hypot(dx, dy) + roleWeight(ground[ui]) * si * 2 });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const usedU = new Set<number>();
  const usedS = new Set<number>();
  for (const p of pairs) {
    if (usedU.has(p.ui) || usedS.has(p.si)) continue;
    usedU.add(p.ui); usedS.add(p.si);
    out.push({ id: ground[p.ui].id, pos: slots[p.si] });
  }

  // Helicopters: stagger above anchor
  heli.forEach((u, i) => {
    const lateral = (i + 1) * spacing * 0.7 * (i % 2 === 0 ? 1 : -1);
    out.push({ id: u.id, pos: { x: anchor.x + right.x * lateral, y: anchor.y + right.y * lateral } });
  });

  return out;
}

/** Spacing scaled by unit mix: vehicles need wider slots than infantry. */
export function formationSpacing(units: Unit[]): number {
  const vehicles = units.filter(u => u.type === 'tank' || u.type === 'apc').length;
  const ratio = units.length ? vehicles / units.length : 0;
  return 32 + ratio * 26;
}

/**
 * Compute formation slots and snap each one to passable ground, claiming cells
 * so two units never get the same destination cell (prevents bunching and the
 * endless repathing that happened when a slot landed inside a wall/forest).
 */
export function resolveFormationSlots(
  units: Unit[],
  anchor: Position,
  facing: number,
  type: FormationType,
  terrain: import('./types').TerrainCell[][],
  cellSize: number,
  claimed: Set<string> = new Set<string>(),
): { id: string; pos: Position }[] {
  const raw = computeFormation(units, anchor, facing, type, formationSpacing(units));
  const byId = new Map(units.map(u => [u.id, u]));
  return raw.map(slot => {
    const u = byId.get(slot.id);
    if (!u || u.type === 'helicopter') return slot;
    const veh = u.type === 'tank' || u.type === 'apc';
    let pos = findNearestPassableWorld(terrain, slot.pos.x, slot.pos.y, veh, false, 10);
    let key = `${Math.floor(pos.x / cellSize)},${Math.floor(pos.y / cellSize)}`;
    if (claimed.has(key)) {
      // Search deterministic expanding rings. Do not call nearest-passable for
      // each nudge: it can snap several slots back onto the same cell.
      const baseX = Math.floor(pos.x / cellSize), baseY = Math.floor(pos.y / cellSize);
      outer: for (let r = 1; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const gx = baseX + dx, gy = baseY + dy;
          const ck = `${gx},${gy}`;
          if (claimed.has(ck) || !isFootprintPassable(terrain, gx, gy, veh, false)) continue;
          pos = { x: gx * cellSize + cellSize / 2, y: gy * cellSize + cellSize / 2 };
          key = ck;
          break outer;
        }
      }
    }
    claimed.add(key);
    return { id: slot.id, pos };
  });
}

/**
 * Cluster units into squads by proximity (BFS within `radius`). Two groups of
 * troops 300m apart are two squads, and each keeps its own block in the
 * destination formation instead of being blended into one long line.
 */
export function clusterSquads(units: Unit[], radius = 110): Unit[][] {
  const used = new Set<string>();
  const out: Unit[][] = [];
  for (const seed of units) {
    if (used.has(seed.id)) continue;
    const members = [seed];
    used.add(seed.id);
    for (let i = 0; i < members.length; i++) {
      for (const u of units) {
        if (used.has(u.id)) continue;
        const d = Math.hypot(members[i].pos.x - u.pos.x, members[i].pos.y - u.pos.y);
        if (d <= radius) { members.push(u); used.add(u.id); }
      }
    }
    out.push(members);
  }
  return out;
}

/**
 * Squad-coordinated destination layout.
 *
 * Instead of one giant formation, each proximity squad gets its own sub-block
 * placed side-by-side along the formation front, in the same left-to-right
 * order the squads currently occupy. Armoured squads are pushed slightly
 * forward and infantry squads trail, so a mixed force arrives as a coherent
 * line of squads rather than a scrambled blob.
 */
export function resolveSquadFormations(
  units: Unit[],
  anchor: Position,
  facing: number,
  preferred: FormationType | undefined,
  terrain: import('./types').TerrainCell[][],
  cellSize: number,
): { id: string; pos: Position; squad: number }[] {
  const fwd = { x: Math.cos(facing), y: Math.sin(facing) };
  const right = { x: -fwd.y, y: fwd.x };
  const squads = clusterSquads(units);

  // Order squads by their current lateral offset so nobody crosses paths.
  const info = squads.map((members, i) => {
    const cx = members.reduce((s, u) => s + u.pos.x, 0) / members.length;
    const cy = members.reduce((s, u) => s + u.pos.y, 0) / members.length;
    const lateral = (cx - anchor.x) * right.x + (cy - anchor.y) * right.y;
    const spacing = formationSpacing(members);
    const armorRatio = members.filter(u => u.type === 'tank' || u.type === 'apc').length / members.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
    return { i, members, lateral, spacing, armorRatio, width: cols * spacing };
  });
  info.sort((a, b) => a.lateral - b.lateral || a.i - b.i);

  const gap = 34;
  const total = info.reduce((s, g) => s + g.width, 0) + gap * (info.length - 1);
  let cursor = -total / 2;
  const claimed = new Set<string>();
  const out: { id: string; pos: Position; squad: number }[] = [];

  info.forEach((g, order) => {
    const center = cursor + g.width / 2;
    cursor += g.width + gap;
    // Armour leads, infantry echelons back a little.
    const depth = (g.armorRatio - 0.5) * 30;
    const subAnchor: Position = {
      x: anchor.x + right.x * center + fwd.x * depth,
      y: anchor.y + right.y * center + fwd.y * depth,
    };
    const type = preferred ?? pickFormation(g.members);
    const slots = resolveFormationSlots(g.members, subAnchor, facing, type, terrain, cellSize, claimed);
    for (const s of slots) out.push({ id: s.id, pos: s.pos, squad: order });
  });

  return out;
}

