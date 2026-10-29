import React from 'react';
import { GameState, UnitType, Stance, FormationType, DebugFlags } from '../game/types';
import { SelectedForcePanel } from './SelectedForcePanel';
import { Position } from '../game/types';
import { factionFor } from '../game/factions';

interface Props {
  gameState: GameState;
  onChange: () => void;
  onFocus: (pos: Position) => void;
  onSpawn: (type: UnitType) => void;
  onStance: (s: Stance) => void;
  onHold: () => void;
  onTogglePause: () => void;
  onExit: () => void;
  onDig: () => void;
  onUnload: () => void;
  onFormation: (f: FormationType | null) => void;
  onToggleDebug: (layer: keyof DebugFlags) => void;
  onSetTimeScale: (s: number) => void;
}

const GameHUD: React.FC<Props> = ({ gameState, onChange, onFocus, onSpawn, onStance, onHold, onTogglePause, onExit, onDig, onUnload, onFormation, onToggleDebug, onSetTimeScale }) => {
  const pool = gameState.reinforcementBudget + (gameState.mission.rewardKills ? gameState.rewardCP : 0);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between text-[#c0d0b0]">
      {/* Top bar */}
      <div className="pointer-events-auto flex items-center justify-between px-4 py-2 font-mono text-xs"
        style={{ background: 'rgba(15,20,15,0.88)', borderBottom: '1px solid #2a3a2a' }}>
        <div className="flex items-center gap-5">
          <span style={{ color: '#a5cf6f' }}>● {gameState.mission.name}</span>
          <span aria-label="Faction matchup" className="hidden xl:inline text-[10px]">
            <span style={{ color: '#87cef0' }}>{factionFor(gameState, 'player').shortName}</span>
            {' vs '}
            <span style={{ color: '#e49678' }}>{factionFor(gameState, 'enemy').shortName}</span>
          </span>
          <span style={{ color: gameState.paused ? '#f0a030' : '#8a9a7a' }}>
            {gameState.paused ? '⏸ PAUSED' : '▶ Active'}
          </span>
          <span>Pool: <span style={{ color: '#d4c47a' }}>{Math.floor(pool)}</span></span>
          {gameState.mission.rewardKills && (
            <span style={{ color: '#7a8a6a' }}>Kill rewards on</span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {/* Tactical time control */}
          <div className="flex items-center gap-1 mr-2">
            <span style={{ color: '#7a8a6a' }}>Time:</span>
            {[
              { s: 0.25, label: '¼×' },
              { s: 0.5, label: '½×' },
              { s: 1, label: '1×' },
              { s: 2, label: '2×' },
            ].map(({ s, label }) => (
              <button key={s} onClick={() => onSetTimeScale(s)} className="px-2 py-0.5 border"
                style={{
                  background: Math.abs((gameState.timeScale ?? 1) - s) < 0.01 ? 'rgba(80,100,60,0.9)' : 'rgba(40,50,40,0.8)',
                  borderColor: '#5a6a5a',
                }}>{label}</button>
            ))}
          </div>
          <button onClick={onTogglePause} className="px-2 py-1 border" style={{ background: 'rgba(40,50,40,0.8)', borderColor: '#5a6a5a' }}>
            [Space] {gameState.paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={onExit} className="px-2 py-1 border" style={{ background: 'rgba(60,40,40,0.8)', borderColor: '#7a5a5a', color: '#e0a0a0' }}>
            Abort
          </button>
        </div>
      </div>

      {/* Capture progress bar (top centre) */}
      {(() => {
        const cp = gameState.capturePoints.find(c => c.id === 'town_centre');
        if (!cp) return null;
        const pct = Math.round(((cp.progress + 1) / 2) * 100);
        const holderColor = cp.owner === 'player' ? '#5cda5c' : cp.owner === 'enemy' ? '#da5c5c' : '#f0a030';
        return (
          <div className="pointer-events-none absolute top-10 left-1/2 -translate-x-1/2 font-mono text-[11px] px-3 py-2 min-w-[280px]"
            style={{ background: 'rgba(15,20,15,0.9)', border: '1px solid #2a3a2a' }}>
            <div className="flex justify-between mb-1">
              <span style={{ color: '#a5cf6f' }}>{cp.label}</span>
              <span style={{ color: holderColor }}>{cp.owner.toUpperCase()}</span>
            </div>
            <div style={{ width: '100%', height: 8, background: '#1a1f1a', border: '1px solid #2a3a2a', position: 'relative' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: holderColor, transition: 'width 0.3s' }} />
              <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: '#5a6a5a' }} />
            </div>
          </div>
        );
      })()}

      {/* Counterattack warning banner */}
      {((gameState.script.__counterBannerUntil as number) ?? 0) > gameState.time && (
        <div className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 font-mono text-sm px-4 py-2"
          style={{ background: 'rgba(80,20,20,0.92)', border: '1px solid #a04040', color: '#ffd0c0', letterSpacing: 1 }}>
          ⚠ ENEMY COUNTERATTACK FROM CHURCH SQUARE
        </div>
      )}


      {/* Mission Objectives panel */}
      <div className="pointer-events-none absolute top-12 left-3 max-w-xs font-mono text-xs p-2"
        style={{ background: 'rgba(15,20,15,0.85)', border: '1px solid #2a3a2a' }}>
        <div className="mb-1" style={{ color: '#a5cf6f' }}>OBJECTIVES</div>
        {gameState.objectives.map(o => (
          <div key={o.id} className="flex gap-1" style={{
            color: o.status === 'complete' ? '#5cda5c' : o.status === 'failed' ? '#da5c5c' : '#c0d0b0',
            opacity: o.optional ? 0.85 : 1,
          }}>
            <span>{o.status === 'complete' ? '✓' : o.status === 'failed' ? '✗' : '●'}</span>
            <span>{o.description}{o.optional && ' (opt)'}</span>
          </div>
        ))}
        {gameState.capturePoints.length > 0 && (
          <div className="mt-2">
            <div className="mb-1" style={{ color: '#a5cf6f' }}>POINTS</div>
            {gameState.capturePoints.map(cp => (
              <div key={cp.id} className="flex justify-between gap-2">
                <span>{cp.label}</span>
                <span style={{ color: cp.owner === 'player' ? '#5cda5c' : cp.owner === 'enemy' ? '#da5c5c' : '#a0a0a0' }}>
                  {cp.owner}{Math.abs(cp.progress) < 0.9 ? ` (${Math.round(cp.progress * 100)}%)` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hotkey legend */}
      <div className="pointer-events-none absolute top-12 right-3 text-[10px] font-mono px-2 py-1"
        style={{ background: 'rgba(15,20,15,0.85)', border: '1px solid #2a3a2a', color: '#8a9a7a' }}>
        <div>Space: pause · 1/2/3/4: time ¼×/½×/1×/2× · WASD: pan · Q/E: rotate · Wheel: zoom</div>
        <div>Click: select · Drag: box · Shift: toggle/add · Ctrl+A: all</div>
        <div>RClick: move/attack/occupy cover · Shift: queue · Ctrl: attack-move</div>
        <div>H: hold · F: hold-fire · X: tight · G: defend · Y: aggressive</div>
        <div>C: cover · T: dig-in · Shift+T: trench line · U: load infantry into APC / unload · Home: focus</div>
        <div>5/6/7: line/wedge/column · 0: auto</div>
        <div>RAAS: R: radio (stopped APC) · B: spawn point (2 infantry build it)</div>
        <div>F1: cover · F2: concealment · F3: tactical</div>
      </div>

      {/* Debug overlay toggle row */}
      <div className="pointer-events-auto absolute top-44 right-3 text-[10px] font-mono p-2 flex flex-col gap-1"
        style={{ background: 'rgba(15,20,15,0.85)', border: '1px solid #2a3a2a', color: '#a5cf6f' }}>
        <div>DEBUG</div>
        {([
          ['showCover', 'Cover [F1]'],
          ['showConcealment', 'Conceal [F2]'],
          ['showTactical', 'Tactical [F3]'],
          ['showMovement', 'Squads [F4]'],
        ] as [keyof DebugFlags, string][]).map(([k, label]) => (
          <button key={k} onClick={() => onToggleDebug(k)}
            className="px-2 py-0.5 border text-left"
            style={{
              background: gameState.debug[k] ? 'rgba(80,100,60,0.9)' : 'rgba(40,50,40,0.8)',
              borderColor: '#5a6a5a',
              color: gameState.debug[k] ? '#e8f0c8' : '#a5cf6f',
            }}>
            {gameState.debug[k] ? '● ' : '○ '}{label}
          </button>
        ))}
        <div className="mt-1 text-[9px]" style={{ color: '#7a8a6a' }}>
          blue→green→yellow→red
        </div>
      </div>

      <SelectedForcePanel state={gameState} onChange={onChange} onFocus={onFocus} onSpawn={onSpawn}
        onStance={onStance} onHold={onHold} onDig={onDig} onUnload={onUnload} onFormation={onFormation} />

      {/* Game over overlay now handled by MissionSummary in GameUI. */}
    </div>
  );
};

export default GameHUD;
