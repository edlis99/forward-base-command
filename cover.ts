import { GameState, Position, TerrainCell, Unit } from './types';
import { CELL_SIZE } from './constants';
import { getTerrainAt } from './terrain';
import { clearUnitOrders, setDestination } from './units';

export const COVER_NAMES: Record<NonNullable<TerrainCell['prop']>, string> = {
  logs: 'Timber stack', hay: 'Hay bales', stone_wall: 'Stone wall',
  wreck: 'Abandoned truck', barricade: 'Roadside barricade',
  boulder: 'Field rocks', scrub: 'Brush cover',
};
export function coverLabel(cell: TerrainCell): string {
  return cell.prop ? COVER_NAMES[cell.prop] : ({ urban: 'Building frontage', forest: 'Woodland',
    hedgerow: 'Hedgerow', rubble: 'Rubble', crater: 'Shell crater', trench: 'Trench',
    sandbag: 'Sandbags' } as Partial<Record<TerrainCell['type'], string>>)[cell.type] ?? 'Field cover';
}
export function isOccupyableCover(cell: TerrainCell | null): boolean {
  return !!cell && !cell.blocksMovement && cell.coverBonus > 0;
}

/** Two separated positions on the open side of a prop, matching its rendered rotation. */
export function coverPositions(cell: TerrainCell, x: number, y: number): Position[] {
  const angle = cell.propAngle ?? 0;
  const front = cell.type === 'urban' ? .32 : cell.prop ? .18 : 0;
  return [-.22, .22].map(side => ({
    x: (x + .5 + Math.cos(angle) * side - Math.sin(angle) * front) * CELL_SIZE,
    y: (y + .5 + Math.sin(angle) * side + Math.cos(angle) * front) * CELL_SIZE,
  }));
}

/** Claim reachable, separate positions; leave old orders intact when no slot is available. */
export function occupyCover(state: GameState, selected: Unit[], at: Position): Set<string> {
  const assigned = new Set<string>();
  if (!isOccupyableCover(getTerrainAt(state.terrain, at.x, at.y))) return assigned;
  const x = Math.floor(at.x / CELL_SIZE), y = Math.floor(at.y / CELL_SIZE);
  const candidates: { cell: TerrainCell; pos: Position; distance: number }[] = [];
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const cell = state.terrain[y + dy]?.[x + dx];
    if (!isOccupyableCover(cell)) continue;
    for (const pos of coverPositions(cell, x + dx, y + dy)) {
      const occupied = state.units.some(u => u.alive && !u.insideOf && !selected.includes(u) &&
        [u.pos, u.coverTarget].some(p => p && Math.hypot(p.x - pos.x, p.y - pos.y) < 10));
      if (!occupied) candidates.push({ cell, pos, distance: Math.hypot(pos.x - at.x, pos.y - at.y) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const remaining = selected.filter(u => u.alive && !u.insideOf && u.type === 'infantry');
  // Nearest soldier claims each slot: fewer crossing paths on the approach.
  for (const candidate of candidates) {
    remaining.sort((a, b) => Math.hypot(a.pos.x - candidate.pos.x, a.pos.y - candidate.pos.y) -
      Math.hypot(b.pos.x - candidate.pos.x, b.pos.y - candidate.pos.y));
    for (const unit of remaining) {
      const previous = { ...unit };
      clearUnitOrders(unit);
      setDestination(unit, state, candidate.pos);
      if (!unit.targetPos) { Object.assign(unit, previous); continue; }
      unit.order = 'move'; unit.holdOnArrive = true;
      unit.coverTarget = { ...candidate.pos };
      unit.arrivalFacing = (candidate.cell.propAngle ?? 0) - Math.PI / 2;
      assigned.add(unit.id); remaining.splice(remaining.indexOf(unit), 1); break;
    }
    if (!remaining.length) break;
  }
  return assigned;
}

/** Find nearby cover independently for each soldier, preserving orders if none is reachable. */
export function takeCoverForSelected(state: GameState): void {
  if (state.gameOver) return;
  const infantry = state.units.filter(u => u.alive && u.selected && u.team === 'player' && !u.insideOf && u.type === 'infantry');
  let count = 0;
  for (const unit of infantry) {
    const gx = Math.floor(unit.pos.x / CELL_SIZE), gy = Math.floor(unit.pos.y / CELL_SIZE);
    const nearby: Position[] = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (isOccupyableCover(state.terrain[gy + dy]?.[gx + dx])) nearby.push({ x: (gx + dx + .5) * CELL_SIZE, y: (gy + dy + .5) * CELL_SIZE });
    }
    nearby.sort((a, b) => Math.hypot(a.x - unit.pos.x, a.y - unit.pos.y) - Math.hypot(b.x - unit.pos.x, b.y - unit.pos.y));
    for (const pos of nearby) if (occupyCover(state, [unit], pos).size) { count++; break; }
  }
  state.eventLog.unshift({ message: count ? `${count}/${infantry.length} infantry moving to nearby cover` : 'No reachable cover nearby — move closer to a field object or woodland.', time: state.time, type: 'info' });
}

export function coverState(unit: Unit): 'moving' | 'covered' | 'none' {
  if (unit.type !== 'infantry') return 'none';
  if (unit.holdOnArrive && unit.targetPos && unit.coverTarget) return 'moving';
  return unit.inCover && !unit.targetPos ? 'covered' : 'none';
}
export function unitStatus(unit: Unit, state: GameState): string {
  if (unit.prone && unit.suppression > .5) return 'Pinned';
  if (unit.engaging) return 'Engaging';
  if (unit.waiting === 'formation') return 'Regrouping';
  if (unit.waiting === 'traffic') return 'Yielding';
  if (coverState(unit) === 'moving') return 'Taking cover';
  if (coverState(unit) === 'covered') return 'In cover';
  if (unit.order === 'entrench') return 'Digging';
  if (unit.boardTarget) return 'Boarding';
  const cell = getTerrainAt(state.terrain, unit.pos.x, unit.pos.y);
  if (unit.type !== 'helicopter' && cell?.type === 'road') return unit.targetPos ? 'Moving · exposed' : 'Exposed';
  return ({ move: 'Moving', attack_move: 'Advancing', attack: 'Engaging', hold_position: 'Holding', retreat: 'Retreating', idle: 'Ready', patrol: 'Patrolling' } as Record<string, string>)[unit.order] ?? unit.order;
}
