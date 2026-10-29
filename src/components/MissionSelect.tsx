import React, { useState } from 'react';
import { MissionDef } from '../game/types';
import { makeLeipalingisRaas } from '../game/maps/raasLeipalingis';

interface Props { onStart: (m: MissionDef) => void; }

const MissionSelect: React.FC<Props> = ({ onStart }) => {
  const [hovered, setHovered] = useState<string | null>(null);

  const startRaas = () => onStart(makeLeipalingisRaas(Math.floor(Math.random() * 0x7fffffff)));

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

        {/* menu + side panel */}
        <div className="flex gap-8 items-start mt-14">
          <div className="w-[420px] flex flex-col gap-2">
            <div className="text-[10px] tracking-[0.35em] mb-1 px-1" style={{ color: '#6a7a5a' }}>— MAIN MENU —</div>
            {menuItem('deploy', 'DEPLOY', 'RAAS · LEIPALINGIS', startRaas, true)}
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

        {/* footer */}
        <div className="mt-auto flex justify-between items-end text-[10px] tracking-widest" style={{ color: '#5a6a4a' }}>
          <div>COMBAT PROTOTYPE · SQUAD MOVEMENT BUILD</div>
          <div>CLICK DEPLOY TO BEGIN</div>
        </div>
      </div>
    </div>
  );
};

export default MissionSelect;
