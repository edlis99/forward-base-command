import { GameState, Position, TerrainCell, Unit } from './types';
import { CELL_SIZE } from './constants';
import { getTerrainAt } from './terrain';
import { clearUnitOrders, setDestination } from './units';

export const COVER_NAMES: Record<NonNullable<TerrainCell['prop']>, string> = {
  logs: 'Timber stack', hay: 'Hay bales', stone_wall: 'Stone wall',
  wreck: 'Abandoned truck', barricade: 'Roadside barricade',
};
export function coverLabel(cell: TerrainCell): string {
  return cell.prop ? COVER_NAMES[cell.prop] : cell.type === 'urban' ? 'Farmhouse / courtyard' : cell.type === 'trench' ? 'Trench' : 'Sandbags';
}
export function isOccupyableCover(cell: TerrainCell | null): boolean {
  return !!cell && !cell.blocksMovement && (!!cell.prop || ['urban', 'trench', 'sandbag'].includes(cell.type));
}

/** Claim separate, reachable firing positions. Orders persist until replaced. */
export function occupyCover(state: GameState, selected: Unit[], at: Position): Set<string> {
  const assigned = new Set<string>();
  if (!isOccupyableCover(getTerrainAt(state.terrain, at.x, at.y))) return assigned;
  const x = Math.floor(at.x / CELL_SIZE), y = Math.floor(at.y / CELL_SIZE);
  const candidates: { cell: TerrainCell; pos: Position; distance: number }[] = [];
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const cell = state.terrain[y + dy]?.[x + dx];
    if (!isOccupyableCover(cell)) continue;
    // Stay on the open side of the model, within the same logical cover cell.
    const angle = cell.propAngle ?? 0;
    const offset = (cell.prop || cell.type === 'urban') ? .28 : 0;
    const pos = { x: (x + dx + 0.5 - Math.sin(angle) * offset) * CELL_SIZE,
      y: (y + dy + 0.5 + Math.cos(angle) * offset) * CELL_SIZE };
    const occupied = state.units.some(u => u.alive && !u.insideOf && !selected.includes(u) &&
      [u.pos, u.holdOnArrive ? u.finalDest : null].some(p => p && Math.hypot(p.x - pos.x, p.y - pos.y) < CELL_SIZE * 0.7));
    if (!occupied) candidates.push({ cell, pos, distance: Math.hypot(dx, dy) });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const unit of selected.filter(u => u.type === 'infantry')) {
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      // Preserve the old order if this cover pocket cannot be reached.
      const previous = { ...unit };
      clearUnitOrders(unit);
      setDestination(unit, state, candidate.pos);
      if (!unit.targetPos) { Object.assign(unit, previous); continue; }
      unit.order = 'move'; unit.holdOnArrive = true;
      assigned.add(unit.id); candidates.splice(i, 1); break;
    }
  }
  return assigned;
}
