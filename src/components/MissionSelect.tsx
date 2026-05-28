import React from 'react';
import { MISSIONS } from '../game/missions';
import { MissionDef } from '../game/types';

interface Props { onStart: (m: MissionDef) => void; }

const MissionSelect: React.FC<Props> = ({ onStart }) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center font-mono"
      style={{ background: 'linear-gradient(180deg, #0d1110 0%, #1a201a 100%)', color: '#c0d0b0' }}>
      <div className="max-w-4xl w-full p-8">
        <h1 className="text-3xl mb-1" style={{ color: '#a5cf6f' }}>FIELD COMMAND</h1>
        <div className="text-sm mb-6" style={{ color: '#7a8a6a' }}>
          Select an operation. Each mission has different objectives, force composition, and rules of engagement.
        </div>
        <div className="grid grid-cols-2 gap-4">
          {MISSIONS.map(m => (
            <button key={m.id} onClick={() => onStart(m)}
              className="text-left p-4 border transition-colors hover:border-[#a5cf6f]"
              style={{ background: 'rgba(20,30,20,0.85)', borderColor: '#3a4a3a' }}>
              <div className="text-lg mb-1" style={{ color: '#a5cf6f' }}>{m.name}</div>
              <div className="text-xs mb-2" style={{ color: '#8a9a7a' }}>{m.summary}</div>
              <div className="text-[11px]" style={{ color: '#6a7a6a' }}>{m.briefing}</div>
              <div className="text-[11px] mt-2" style={{ color: m.rewardKills ? '#d4c47a' : '#5a6a5a' }}>
                {m.rewardKills ? 'Kill rewards: ON' : 'No kill rewards'}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MissionSelect;
