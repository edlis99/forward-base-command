import React, { useState } from 'react';
import { MissionDef } from '../game/types';
import { makeLeipalingisRaas } from '../game/maps/raasLeipalingis';
import { FACTIONS, FACTION_IDS, FactionId, opposingFaction } from '../game/factions';
import { FactionPreview } from '../scene3d/FactionModels';

interface Props {
  onStart: (m: MissionDef, faction: FactionId) => void;
  faction: FactionId;
  onFactionChange: (id: FactionId) => void;
}

const MissionSelect: React.FC<Props> = ({ onStart, faction, onFactionChange }) => {
  const [hovered, setHovered] = useState<string | null>(null);

  const startRaas = () => onStart(makeLeipalingisRaas(Math.floor(Math.random() * 0x7fffffff)), faction);

  const menuItem = (id: string, label: string, sub: string, onClick: () => void, accent = false) => (
    <button
      key={id}
      onClick={onClick}
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      className="w-full text-left px-5 py-3 border-l-2 transition-all duration-150"
      style={{
        background: hovered === id ? 'rgba(165,207,111,0.10)' : 'rgba(14,20,14,0.55)',
        borderColor: hovered === id ? '#a5cf6f' : '#2c3a2c',
        color: accent ? '#e8f0c8' : '#c0d0b0',
      }}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-base tracking-[0.2em]">{hovered === id ? '▸ ' : '  '}{label}</span>
        <span className="text-[10px] tracking-widest" style={{ color: '#6a7a5a' }}>{sub}</span>
      </div>
    </button>
  );

  return (
    <div className="absolute inset-0 font-mono overflow-auto" style={{ color: '#c0d0b0' }}>
      {/* backdrop: tactical grid + vignette */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 30% 20%, #1c2618 0%, #0d1110 55%, #070a07 100%)',
      }} />
      <div className="absolute inset-0 opacity-[0.07]" style={{
        backgroundImage: 'linear-gradient(#a5cf6f 1px, transparent 1px), linear-gradient(90deg, #a5cf6f 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 4px)',
      }} />

      <div className="relative min-h-full flex flex-col p-5 sm:p-10 max-w-6xl mx-auto">
        {/* header */}
        <div>
          <div className="text-[11px] tracking-[0.4em] mb-2" style={{ color: '#6a7a5a' }}>
            TACTICAL OPERATIONS COMMAND · BUILD 0.9
          </div>
          <h1 className="text-3xl sm:text-5xl tracking-[0.12em] leading-none" style={{ color: '#a5cf6f', textShadow: '0 0 24px rgba(165,207,111,0.25)' }}>
            FIELD COMMAND
          </h1>
          <div className="mt-2 h-px w-2/3" style={{ background: 'linear-gradient(90deg, #a5cf6f 0%, transparent 100%)' }} />
        </div>

        <fieldset className="mt-7">
          <legend className="text-[11px] tracking-[0.3em] text-[#a5cf6f] mb-3">CHOOSE YOUR FACTION</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            {FACTION_IDS.map(id => {
              const f = FACTIONS[id], selected = id === faction;
              return <label key={id} className={`relative cursor-pointer border p-4 transition-colors ${selected ? 'border-[#87cef0] bg-[#1c302b]' : 'border-[#3a4a3a] bg-[#101a16] hover:border-[#738775]'}`}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="faction" value={id} checked={selected} onChange={() => onFactionChange(id)} className="accent-[#87cef0]" />
                  <span className="text-xl text-[#c9d6b0]" aria-hidden="true">{f.emblem}</span>
                  <strong className="text-sm sm:text-base text-[#e2ecd5]">{f.name}</strong>
                  <span className="ml-auto text-[9px] text-[#87cef0]">{selected ? 'SELECTED' : ''}</span>
                </div>
                <div className="h-[135px] my-2 pointer-events-none" aria-hidden="true"><FactionPreview faction={id} /></div>
                <div className="text-[10px] tracking-widest text-[#a5cf6f] mb-1">{f.inspiration.toUpperCase()}</div>
                <p className="text-[11px] leading-relaxed text-[#a7b69f]">{f.description}</p>
                <div className="text-[10px] mt-3 text-[#d1d6b4]">{f.units.tank} · {f.units.apc} · {f.units.helicopter}</div>
              </label>;
            })}
          </div>
          <p className="text-[10px] mt-3 text-[#93a58e]">Fictional factions · Equal combat stats, costs and reinforcements · AI opponent: {FACTIONS[opposingFaction(faction)].name}</p>
        </fieldset>

        {/* menu + side panel */}
        <div className="flex flex-col sm:flex-row gap-5 items-start mt-5">
          <div className="w-full sm:w-[380px] shrink-0 flex flex-col gap-2">
            <div className="text-[10px] tracking-[0.35em] mb-1 px-1" style={{ color: '#6a7a5a' }}>— MAIN MENU —</div>
            {menuItem('deploy', 'DEPLOY', 'RAAS · LEIPALINGIS', startRaas, true)}
            {menuItem('settings', 'SETTINGS', 'SOON', () => {})}
            {menuItem('quit', 'QUIT', 'SOON', () => {})}
          </div>

          {(hovered === 'deploy' || hovered === null) && (
            <div className="flex-1 p-5 border" style={{ background: 'rgba(16,24,16,0.85)', borderColor: '#3a4a3a' }}>
              <div className="text-sm tracking-[0.25em] mb-3" style={{ color: '#a5cf6f' }}>OPERATION: RAAS · LEIPALINGIS</div>
              <div className="text-[12px] leading-relaxed space-y-3" style={{ color: '#b0c0a0' }}>
                <p>Lead {FACTIONS[faction].name} against {FACTIONS[opposingFaction(faction)].name}. A random lane of five objectives is revealed as you advance through Leipalingis. Capture in order with infantry and exhaust the enemy's tickets.</p>
                <p style={{ color: '#8a9a7a' }}>APCs deploy radios [R]. Infantry build forward spawn points [B]. Your faction choice changes equipment and uniforms; both sides have equal capabilities.</p>
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="mt-auto pt-5 flex justify-between items-end text-[10px] tracking-widest" style={{ color: '#5a6a4a' }}>
          <div>COMBAT PROTOTYPE · SQUAD MOVEMENT BUILD</div>
          <div>CLICK DEPLOY TO BEGIN</div>
        </div>
        <details className="mt-3 text-[10px] text-[#91a18a]">
          <summary className="cursor-pointer">Model credits</summary>
          <p className="mt-2">Aster infantry: <a className="underline" href="https://sketchfab.com/3d-models/free-military-soldier-rigged-e9c56308a67d4a3db62e914fafa4d198" target="_blank" rel="noreferrer">FREE [Military Soldier] RIGGED by BAMEN</a>, <a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>, converted and recoloured, with game-authored walking motion. Vostran infantry: <a className="underline" href="https://poly.pizza/m/Btfn3G5Xv4" target="_blank" rel="noreferrer">SWAT by Quaternius</a>, CC0. Rifles: <a className="underline" href="https://poly.pizza/bundle/Ultimate-Guns-Pack-cpgUfI4t2F" target="_blank" rel="noreferrer">Quaternius Ultimate Guns Pack</a>, CC0. Tank base: <a className="underline" href="https://poly.pizza/m/egcLMSGiuA" target="_blank" rel="noreferrer">Tank by KolosStudios</a>, CC BY 3.0. Original faction-specific armour, APC and helicopter detailing is made in-game; all equipment changes are visual only.</p>
        </details>
      </div>
    </div>
  );
};

export default MissionSelect;
