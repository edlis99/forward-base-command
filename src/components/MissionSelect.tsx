import React, { useState } from 'react';
import { MissionDef } from '../game/types';
import { makeLeipalingisRaas } from '../game/maps/raasLeipalingis';
import { FACTIONS, FACTION_IDS, opposingFaction, FactionId } from '../game/factions';
import { FactionPreview } from '../scene3d/FactionModels';

interface Props {
  onStart: (m: MissionDef, faction: FactionId) => void;
  faction: FactionId;
  onFactionChange: (f: FactionId) => void;
}

const MissionSelect: React.FC<Props> = ({ onStart, faction, onFactionChange }) => {
  const [hovered, setHovered] = useState<string | null>(null);
  const [screen, setScreen] = useState<'menu' | 'faction'>('menu');

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

  const factionCard = (id: FactionId) => {
    const f = FACTIONS[id];
    const selected = faction === id;
    return (
      <button
        key={id}
        role="radio"
        aria-checked={selected}
        onClick={() => onFactionChange(id)}
        onMouseEnter={() => setHovered(`fac-${id}`)}
        onMouseLeave={() => setHovered(null)}
        className="flex-1 text-left p-5 border transition-all duration-150"
        style={{
          background: selected ? 'rgba(165,207,111,0.10)' : 'rgba(14,20,14,0.55)',
          borderColor: selected ? '#a5cf6f' : hovered === `fac-${id}` ? '#5a7050' : '#2c3a2c',
          boxShadow: selected ? '0 0 18px rgba(165,207,111,0.15) inset' : 'none',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-lg tracking-[0.15em]" style={{ color: selected ? '#e8f0c8' : '#c0d0b0' }}>
            {f.emblem} {f.name}
          </span>
          <span
            className="w-4 h-4 rounded-full border flex items-center justify-center"
            style={{ borderColor: selected ? '#a5cf6f' : '#4a5a4a' }}
          >
            {selected && <span className="w-2 h-2 rounded-full" style={{ background: '#a5cf6f' }} />}
          </span>
        </div>
        <div className="text-[10px] tracking-[0.3em] mb-3" style={{ color: '#6a7a5a' }}>{f.instruction ?? f.inspiration}</div>
        <div className="h-28 mb-3 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }}>
          <FactionPreview faction={id} />
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: '#8a9a7a' }}>{f.description}</p>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]" style={{ color: '#7a8a6a' }}>
          <span>INF · {f.units.infantry}</span>
          <span>MBT · {f.units.tank}</span>
          <span>APC · {f.units.apc}</span>
          <span>HEL · {f.units.helicopter}</span>
        </div>
      </button>
    );
  };

  return (
    <div className="absolute inset-0 font-mono overflow-hidden" style={{ color: '#c0d0b0' }}>
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

      <div className="relative h-full flex flex-col p-10 max-w-5xl mx-auto">
        {/* header */}
        <div>
          <div className="text-[11px] tracking-[0.4em] mb-2" style={{ color: '#6a7a5a' }}>
            TACTICAL OPERATIONS COMMAND · BUILD 0.9
          </div>
          <h1 className="text-6xl tracking-[0.12em] leading-none" style={{ color: '#a5cf6f', textShadow: '0 0 24px rgba(165,207,111,0.25)' }}>
            FIELD COMMAND
          </h1>
          <div className="mt-2 h-px w-2/3" style={{ background: 'linear-gradient(90deg, #a5cf6f 0%, transparent 100%)' }} />
        </div>

        {screen === 'menu' ? (
          /* menu + side panel */
          <div className="flex gap-8 items-start mt-14">
            <div className="w-[420px] flex flex-col gap-2">
              <div className="text-[10px] tracking-[0.35em] mb-1 px-1" style={{ color: '#6a7a5a' }}>— MAIN MENU —</div>
              {menuItem('deploy', 'DEPLOY', 'RAAS · LEIPALINGIS', () => setScreen('faction'), true)}
              {menuItem('settings', 'SETTINGS', 'SOON', () => {})}
              {menuItem('quit', 'QUIT', 'SOON', () => {})}
            </div>

            {hovered === 'deploy' && (
              <div className="flex-1 p-5 border" style={{ background: 'rgba(16,24,16,0.85)', borderColor: '#3a4a3a' }}>
                <div className="text-sm tracking-[0.25em] mb-3" style={{ color: '#a5cf6f' }}>OPERATION: RAAS · LEIPALINGIS</div>
                <div className="text-[12px] leading-relaxed space-y-3" style={{ color: '#b0c0a0' }}>
                  <p>
                    The real Leipalingis area against the AI: lakes, woods, a river and two towns, Leipalingis and
                    Seirijai. A random lane of five objectives is drawn and revealed as you advance — capture them in
                    order with infantry, hold your line, and bleed the enemy's tickets dry.
                  </p>
                  <p>
                    You stage in the west, the enemy in the east. APCs can deploy radios (R) and infantry can
                    raise forward spawn points (B) near a radio — keep your reinforcements close to the front.
                  </p>
                  <p style={{ color: '#8a9a7a' }}>
                    Victory: reduce enemy tickets to zero. Losses, lost objectives and losing ground all cost tickets;
                    holding every objective drains the enemy fast.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* faction selection */
          <div className="flex flex-col mt-10 flex-1 min-h-0">
            <div className="text-[10px] tracking-[0.35em] mb-1 px-1" style={{ color: '#6a7a5a' }}>— SELECT YOUR FACTION —</div>
            <div className="text-sm tracking-[0.25em] mb-4" style={{ color: '#a5cf6f' }}>OPERATION: RAAS · LEIPALINGIS</div>

            <div className="flex gap-4">
              {FACTION_IDS.map(factionCard)}
            </div>

            <div className="mt-4 text-[11px] tracking-widest" style={{ color: '#8a9a7a' }}>
              AI opponent: {FACTIONS[opposingFaction(faction)].name}
            </div>

            <div className="mt-6 flex gap-3 w-[420px]">
              {menuItem('back', 'BACK', 'MENU', () => setScreen('menu'))}
              {menuItem('confirm-deploy', 'DEPLOY', FACTIONS[faction].shortName, startRaas, true)}
            </div>
          </div>
        )}

        {/* footer */}
        <div className="mt-auto flex justify-between items-end text-[10px] tracking-widest" style={{ color: '#5a6a4a' }}>
          <div>COMBAT PROTOTYPE · SQUAD MOVEMENT BUILD</div>
          <div>{screen === 'menu' ? 'CLICK DEPLOY TO BEGIN' : 'CHOOSE A FACTION, THEN DEPLOY'}</div>
        </div>
      </div>
    </div>
  );
};

export default MissionSelect;
