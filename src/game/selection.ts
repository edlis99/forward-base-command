import { GameState, Unit, UnitType } from './types';

export type SelectionMode = 'replace' | 'add' | 'toggle' | 'remove';
export const controllable = (u: Unit) => u.alive && u.team === 'player' && !u.insideOf;
export const selectedUnits = (state: GameState) => state.units.filter(u => controllable(u) && u.selected);
export function selectionRoster(state: GameState): Unit[] {
  const ids = new Set(state.selectionRoster);
  return state.units.filter(u => controllable(u) && (ids.has(u.id) || u.selected));
}
/** World gestures replace the roster; panel filters retain it for re-selection. */
export function selectUnits(state: GameState, ids: string[], mode: SelectionMode = 'replace', remember = true) {
  const hits = new Set(ids);
  for (const u of state.units) {
    if (!controllable(u)) { u.selected = false; continue; }
    if (mode === 'replace') u.selected = hits.has(u.id);
    else if (hits.has(u.id)) u.selected = mode === 'toggle' ? !u.selected : mode === 'add';
  }
  if (remember) state.selectionRoster = selectedUnits(state).map(u => u.id);
  state.previewSelected.clear(); state.commandPreview = null;
}
export function selectRosterType(state: GameState, type?: UnitType) {
  selectUnits(state, selectionRoster(state).filter(u => !type || u.type === type).map(u => u.id), 'replace', false);
}
export function adjustSelectedCount(state: GameState, type: UnitType, delta: number) {
  const candidates = selectionRoster(state).filter(u => u.type === type);
  const unit = delta > 0 ? candidates.find(u => !u.selected) : [...candidates].reverse().find(u => u.selected);
  if (unit) selectUnits(state, [unit.id], delta > 0 ? 'add' : 'remove', false);
}
