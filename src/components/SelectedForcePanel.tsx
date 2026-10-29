import React from 'react';
import { Crosshair, Footprints, Shield, Truck, Users, Minus, Plus, LocateFixed, ChevronRight } from 'lucide-react';
import { GameState, Unit, UnitType, Stance, FormationType, Position } from '../game/types';
import { UNIT_STATS } from '../game/constants';
import { adjustSelectedCount, controllable, selectedUnits, selectionRoster, selectRosterType, selectUnits } from '../game/selection';
import { coverState, takeCoverForSelected, unitStatus } from '../game/cover';
import { factionFor } from '../game/factions';

const TYPES: { type: UnitType; label: string; icon: typeof Users }[] = [
  { type: 'infantry', label: 'Infantry', icon: Footprints },
  { type: 'tank', label: 'Tanks', icon: Shield },
  { type: 'apc', label: 'APCs', icon: Truck },
  { type: 'helicopter', label: 'Air', icon: Crosshair },
];
const button = 'px-2 py-1 rounded border border-[#43544d] bg-[#202f29] hover:bg-[#35483d] disabled:opacity-35 disabled:cursor-default whitespace-nowrap';
interface Props {
  state: GameState;
  onChange: () => void;
  onFocus: (pos: Position) => void;
  onSpawn: (type: UnitType) => void;
  onStance: (s: Stance) => void;
  onHold: () => void;
  onDig: () => void;
  onUnload: () => void;
  onFormation: (f: FormationType | null) => void;
}
export function SelectedForcePanel({ state, onChange, onFocus, onSpawn, onStance, onHold, onDig, onUnload, onFormation }: Props) {
  const selected = selectedUnits(state), roster = selectionRoster(state);
  const pool = state.reinforcementBudget + (state.mission.rewardKills ? state.rewardCP : 0);
  const mutate = (fn: () => void) => { fn(); onChange(); };
  const focus = (units: Unit[]) => {
    if (units.length) onFocus({ x: units.reduce((sum, u) => sum + u.pos.x, 0) / units.length, y: units.reduce((sum, u) => sum + u.pos.y, 0) / units.length });
  };
  return <section aria-label="Selected force" className="pointer-events-auto absolute bottom-0 inset-x-0 h-[204px] border-t border-[#586b5c] bg-[#111d19f5] text-[#cbd8cb] font-mono text-[11px] shadow-[0_-6px_24px_#0004]">
    <div className="flex items-center gap-3 h-10 px-3 border-b border-[#35443b]">
      <Users size={17} className="text-[#87cef0]" />
      <strong className="text-sm text-[#e2f0e7]" aria-live="polite">{selected.length} SELECTED</strong>
      <span className="hidden lg:inline text-[#90a699]">{roster.length ? `${roster.length} in roster` : 'Click a unit or drag a selection box'}</span>
      <button className={button} onClick={() => mutate(() => selectUnits(state, state.units.filter(controllable).map(u => u.id)))}>All forces <span className="text-[#8b9d91]">Ctrl+A</span></button>
      <button className={button} disabled={!selected.length} onClick={() => focus(selected)} title="Focus selected units (Home)"><LocateFixed size={14} /></button>
      <button className={button} disabled={!roster.length} onClick={() => mutate(() => selectUnits(state, []))}>Clear</button>
      <span className="flex-1" />
      <details className="relative">
        <summary className={`${button} cursor-pointer list-none`}>Reinforcements · {Math.floor(pool)} CP</summary>
        <div className="absolute bottom-8 right-0 flex gap-2 p-3 bg-[#14241f] border border-[#637461] rounded shadow-xl">
          {TYPES.map(({ type, label }) => <button key={type} className={button} title={label} disabled={pool < UNIT_STATS[type].cost || state.gameOver} onClick={() => onSpawn(type)}>{factionFor(state, 'player').units[type]} · {UNIT_STATS[type].cost}</button>)}
        </div>
      </details>
    </div>
    <div className="flex h-[112px]">
      <div className="w-[260px] shrink-0 px-3 py-2 border-r border-[#35443b] overflow-y-auto">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[#90a699]">SELECT BY TYPE / AMOUNT</span>
          <button className="text-[#87cef0] hover:underline disabled:opacity-40" disabled={!roster.length} onClick={() => mutate(() => selectRosterType(state))}>Restore all</button>
        </div>
        {TYPES.filter(({ type }) => roster.some(u => u.type === type)).map(({ type, label, icon: Icon }) => {
          const count = selected.filter(u => u.type === type).length, total = roster.filter(u => u.type === type).length;
          return <div className="flex items-center gap-1 h-6" key={type}>
            <button aria-label={`Select ${label}`} className="flex items-center gap-2 flex-1 text-left hover:text-[#87cef0]" onClick={() => mutate(() => selectRosterType(state, type))}><Icon size={13} />{label}</button>
            <button aria-label={`Remove one ${type}`} className="p-1 hover:bg-[#35483d] disabled:opacity-30" disabled={!count} onClick={() => mutate(() => adjustSelectedCount(state, type, -1))}><Minus size={12} /></button>
            <span className="w-10 text-center tabular-nums text-[#e2f0e7]">{count}/{total}</span>
            <button aria-label={`Add one ${type}`} className="p-1 hover:bg-[#35483d] disabled:opacity-30" disabled={count === total} onClick={() => mutate(() => adjustSelectedCount(state, type, 1))}><Plus size={12} /></button>
          </div>;
        })}
        {!roster.length && <p className="text-[#90a699] pt-2">Shift+click adds or removes.<br />Double-click selects a visible type.</p>}
      </div>
      <div className="flex-1 min-w-0 overflow-x-auto flex items-center gap-2 px-3" aria-label="Unit roster">
        {!roster.length && <div className="text-[#90a699]">Select a force to see individual units, health and cover status.</div>}
        {roster.map((u, index) => {
          const { icon: Icon, label } = TYPES.find(t => t.type === u.type)!;
          const covered = coverState(u), status = unitStatus(u, state);
          return <button key={u.id} aria-label={`${label} ${index + 1}: ${status}`} aria-pressed={u.selected}
            onClick={e => mutate(() => selectUnits(state, [u.id], e.shiftKey ? 'toggle' : 'replace', false))}
            onDoubleClick={() => focus([u])}
            title={`${u.id} · ${Math.ceil(u.health)}/${u.maxHealth} HP · Ammo ${u.ammo}/${u.maxAmmo} · ${u.stance.replace('_', ' ')}\n${u.type === 'apc' ? `Passengers ${u.passengers.length}/4 · ` : ''}Click: select only · Shift: toggle · Double-click: focus`}
            className={`shrink-0 w-[116px] h-[86px] rounded border p-2 text-left transition-colors ${u.selected ? 'border-[#87cef0] bg-[#29403e] shadow-[inset_0_2px_0_#87cef0]' : 'border-[#3a4b42] bg-[#1b2923] opacity-60 hover:opacity-100'}`}>
            <div className="flex items-center justify-between"><Icon size={18} className={u.selected ? 'text-[#a4dffd]' : ''} /><span className="text-[#9eafa3]">{index + 1 < 10 ? '0' : ''}{index + 1}</span></div>
            <div className="mt-1 text-[#e2f0e7] truncate" title={factionFor(state, u.team).units[u.type]}>{factionFor(state, u.team).units[u.type]}</div>
            <div className="h-[3px] bg-[#0c1712] my-1"><div className={u.health / u.maxHealth > .4 ? 'bg-[#a3cb8f] h-full' : 'bg-[#e49668] h-full'} style={{ width: `${u.health / u.maxHealth * 100}%` }} /></div>
            <div className={`flex items-center gap-1 text-[10px] truncate ${covered === 'covered' ? 'text-[#b7e8a2]' : covered === 'moving' || u.waiting ? 'text-[#edce8c]' : 'text-[#9eafa3]'}`}>
              {covered !== 'none' && <Shield size={10} className="shrink-0" />}{status}
            </div>
          </button>;
        })}
      </div>
    </div>
    <div className="flex items-center gap-2 h-[30px] px-3 border-t border-[#35443b] overflow-x-auto">
      <button className={`${button} text-[#a8dcf3]`} aria-pressed={state.coordinatedMovement} title="Together: ground units match the slowest member and wait for stragglers. Air units travel separately. Applies to new move orders."
        onClick={() => mutate(() => { state.coordinatedMovement = !state.coordinatedMovement; })}>{state.coordinatedMovement ? 'Move together' : 'Move independently'} <ChevronRight size={10} className="inline" /></button>
      <button className={button} disabled={!selected.length} onClick={onHold}>Hold [H]</button>
      <button className={button} disabled={!selected.some(u => u.type === 'infantry')} onClick={() => mutate(() => takeCoverForSelected(state))}>Take cover [C]</button>
      <button className={button} disabled={!selected.some(u => u.type === 'infantry')} onClick={onDig}>Dig [T]</button>
      <button className={button} disabled={!selected.some(u => u.type === 'apc' && u.passengers.length)} onClick={onUnload}>Unload [U]</button>
      <label className="flex items-center gap-1 ml-auto">Formation
        <select className={`${button} py-0.5`} aria-label="Arrival formation" value={state.preferredFormation ?? 'auto'} onChange={e => onFormation(e.target.value === 'auto' ? null : e.target.value as FormationType)}>
          <option value="auto">Auto · terrain</option><option value="line">Line</option><option value="wedge">Wedge</option><option value="column">Column</option>
        </select>
      </label>
      <label className="flex items-center gap-1">Stance
        <select className={`${button} py-0.5`} aria-label="Selected stance" disabled={!selected.length} value={selected.length && selected.every(u => u.stance === selected[0].stance) ? selected[0].stance : ''} onChange={e => onStance(e.target.value as Stance)}>
          <option value="" disabled>Mixed / none</option><option value="hold_fire">Hold fire</option><option value="tight">Tight</option><option value="defend">Defend</option><option value="aggressive">Aggressive</option>
        </select>
      </label>
    </div>
    <div className="h-[21px] flex items-center gap-4 px-3 text-[10px] text-[#97aa9d] overflow-hidden">
      <span className="whitespace-nowrap">RMB move · Drag RMB: facing · Shift+RMB: queue</span>
      <span className="truncate text-[#c4c4a0]" role="status">{state.eventLog[0]?.message}</span>
    </div>
  </section>;
}
