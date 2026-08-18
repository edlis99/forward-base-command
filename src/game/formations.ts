import { Unit, Position, FormationType } from './types';
import { findNearestPassableWorld } from './terrain';

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
): { id: string; pos: Position }[] {
  const raw = computeFormation(units, anchor, facing, type, formationSpacing(units));
  const claimed = new Set<string>();
  const byId = new Map(units.map(u => [u.id, u]));
  return raw.map(slot => {
    const u = byId.get(slot.id);
    if (!u || u.type === 'helicopter') return slot;
    const veh = u.type === 'tank' || u.type === 'apc';
    let pos = findNearestPassableWorld(terrain, slot.pos.x, slot.pos.y, veh, false, 10);
    let key = `${Math.floor(pos.x / cellSize)},${Math.floor(pos.y / cellSize)}`;
    if (claimed.has(key)) {
      // Nudge outward in a ring until a free, passable cell is found.
      const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      for (const [dx, dy] of ring) {
        const cand = findNearestPassableWorld(
          terrain, pos.x + dx * cellSize, pos.y + dy * cellSize, veh, false, 4,
        );
        const ck = `${Math.floor(cand.x / cellSize)},${Math.floor(cand.y / cellSize)}`;
        if (!claimed.has(ck)) { pos = cand; key = ck; break; }
      }
    }
    claimed.add(key);
    return { id: slot.id, pos };
  });
}
