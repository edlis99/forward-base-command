import React from 'react';
import { GameState } from '../game/types';

interface Props {
  gameState: GameState;
  onReturn: () => void;
  onRetry: () => void;
}

const fmtTime = (secs: number) => {
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const MissionSummary: React.FC<Props> = ({ gameState, onReturn, onRetry }) => {
  const win = gameState.gameResult === 'win';
  const kills = (gameState.script.__killsEnemy as number) ?? 0;
  const losses = (gameState.script.__lossesPlayer as number) ?? 0;
  const time = gameState.time;
  const objectives = gameState.objectives;

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.78)' }}>
      <div className="p-8 font-mono min-w-[440px] max-w-[560px]"
        style={{ background: 'rgba(15,20,15,0.97)', border: `2px solid ${win ? '#5a8a4a' : '#8a4a4a'}` }}>
        <div className="text-[11px] tracking-widest mb-1" style={{ color: '#7a8a6a' }}>
          OPERATION SILVER BIRCH — AFTER-ACTION REPORT
        </div>
        <h2 className="text-3xl mb-4" style={{ color: win ? '#5cda5c' : '#da5c5c' }}>
          {win ? 'VICTORY' : 'DEFEAT'}
        </h2>
        <div className="mb-4 text-sm" style={{ color: '#a5cf6f' }}>{gameState.mission.name}</div>

        <div className="grid grid-cols-3 gap-3 mb-5 text-sm">
          <div style={{ background: 'rgba(25,32,25,0.9)', padding: 10, border: '1px solid #2a3a2a' }}>
            <div className="text-[10px]" style={{ color: '#7a8a6a' }}>ENEMIES KILLED</div>
            <div className="text-2xl" style={{ color: '#d4c47a' }}>{kills}</div>
          </div>
          <div style={{ background: 'rgba(25,32,25,0.9)', padding: 10, border: '1px solid #2a3a2a' }}>
            <div className="text-[10px]" style={{ color: '#7a8a6a' }}>UNITS LOST</div>
            <div className="text-2xl" style={{ color: '#da8888' }}>{losses}</div>
          </div>
          <div style={{ background: 'rgba(25,32,25,0.9)', padding: 10, border: '1px solid #2a3a2a' }}>
            <div className="text-[10px]" style={{ color: '#7a8a6a' }}>MISSION TIME</div>
            <div className="text-2xl" style={{ color: '#c0d0b0' }}>{fmtTime(time)}</div>
          </div>
        </div>

        <div className="mb-5">
          <div className="text-[10px] mb-2" style={{ color: '#7a8a6a' }}>OBJECTIVES</div>
          <div className="flex flex-col gap-1 text-sm">
            {objectives.map(o => (
              <div key={o.id} className="flex gap-2" style={{
                color: o.status === 'complete' ? '#5cda5c' : o.status === 'failed' ? '#da5c5c' : '#8a9a7a',
              }}>
                <span>{o.status === 'complete' ? '✓' : o.status === 'failed' ? '✗' : '○'}</span>
                <span>{o.description}{o.optional ? ' (optional)' : ''}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onRetry} className="px-4 py-2 border"
            style={{ background: 'rgba(40,55,40,0.85)', borderColor: '#5a7a5a', color: '#c0d0b0' }}>
            Retry
          </button>
          <button onClick={onReturn} className="px-4 py-2 border"
            style={{ background: 'rgba(55,40,40,0.85)', borderColor: '#7a5a5a', color: '#e0c0c0' }}>
            Return to Briefing
          </button>
        </div>
      </div>
    </div>
  );
};

export default MissionSummary;
