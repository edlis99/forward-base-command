import React, { useState } from 'react';
import { MISSIONS } from '../game/missions';
import { MissionDef } from '../game/types';

interface Props { onStart: (m: MissionDef) => void; }

const MissionSelect: React.FC<Props> = ({ onStart }) => {
  const [expanded, setExpanded] = useState(true);
  const m = MISSIONS[0];
  return (
    <div className="absolute inset-0 flex items-center justify-center font-mono overflow-auto"
      style={{ background: 'linear-gradient(180deg, #0d1110 0%, #1a201a 100%)', color: '#c0d0b0' }}>
      <div className="max-w-3xl w-full p-8">
        <h1 className="text-3xl mb-1" style={{ color: '#a5cf6f' }}>FIELD COMMAND</h1>
        <div className="text-sm mb-6" style={{ color: '#7a8a6a' }}>
          Single active operation. Review the briefing, then proceed to deployment to select your staging village and force.
        </div>
        <div className="p-5 border" style={{ background: 'rgba(20,30,20,0.9)', borderColor: '#3a4a3a' }}>
          <div className="text-xl mb-1" style={{ color: '#a5cf6f' }}>{m.name}</div>
          <div className="text-xs mb-3" style={{ color: '#8a9a7a' }}>{m.summary}</div>
          <div
            className="text-[12px] whitespace-pre-wrap leading-relaxed"
            style={{ color: '#b0c0a0', maxHeight: expanded ? 'none' : 160, overflow: 'hidden' }}
          >
            {m.briefing}
          </div>
          <div className="flex justify-between items-center mt-4">
            <button onClick={() => setExpanded(x => !x)} className="text-[11px] underline"
              style={{ color: '#8a9a7a' }}>
              {expanded ? 'Collapse briefing' : 'Read full briefing'}
            </button>
            <button onClick={() => onStart(m)} className="px-5 py-2 border text-sm"
              style={{ background: 'rgba(60,90,50,0.9)', borderColor: '#a5cf6f', color: '#e8f0c8' }}>
              PROCEED TO DEPLOYMENT →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MissionSelect;
