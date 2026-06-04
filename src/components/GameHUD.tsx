import React from 'react';
import { GameState, UnitType, Stance, FormationType } from '../game/types';
import { UNIT_STATS, VETERANCY_NAMES } from '../game/constants';

interface Props {
  gameState: GameState;
  onSpawn: (type: UnitType) => void;
  onStance: (s: Stance) => void;
  onHold: () => void;
  onTogglePause: () => void;
  onExit: () => void;
  onDig: () => void;
  onFormation: (f: FormationType | null) => void;
}

const GameHUD: React.FC<Props> = ({ gameState, onSpawn, onStance, onHold, onTogglePause, onExit, onDig, onFormation }) => {
  const selected = gameState.units.filter(u => u.alive && u.selected && u.team === 'player');
  const pool = gameState.reinforcementBudget + (gameState.mission.rewardKills ? gameState.rewardCP : 0);

  const unitTypes: { type: UnitType; label: string }[] = [
    { type: 'infantry', label: 'Infantry' },
    { type: 'tank', label: 'Tank' },
    { type: 'apc', label: 'APC' },
    { type: 'helicopter', label: 'Heli' },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between text-[#c0d0b0]">
      {/* Top bar */}
      <div className="pointer-events-auto flex items-center justify-between px-4 py-2 font-mono text-xs"
        style={{ background: 'rgba(15,20,15,0.88)', borderBottom: '1px solid #2a3a2a' }}>
        <div className="flex items-center gap-5">
          <span style={{ color: '#a5cf6f' }}>● {gameState.mission.name}</span>
          <span style={{ color: gameState.paused ? '#f0a030' : '#8a9a7a' }}>
            {gameState.paused ? '⏸ PAUSED' : '▶ Active'}
          </span>
          <span>Pool: <span style={{ color: '#d4c47a' }}>{Math.floor(pool)}</span></span>
          {gameState.mission.rewardKills && (
            <span style={{ color: '#7a8a6a' }}>Kill rewards on</span>
          )}
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={onTogglePause} className="px-2 py-1 border" style={{ background: 'rgba(40,50,40,0.8)', borderColor: '#5a6a5a' }}>
            [Space] {gameState.paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={onExit} className="px-2 py-1 border" style={{ background: 'rgba(60,40,40,0.8)', borderColor: '#7a5a5a', color: '#e0a0a0' }}>
            Abort
          </button>
        </div>
      </div>

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
        <div>Space: pause · WASD: pan · Wheel: zoom</div>
        <div>LClick: select · Drag: box-select · Shift: add</div>
        <div>RClick: move/attack · Shift+R: queue · Ctrl+R: attack-move</div>
        <div>H: hold · F: hold-fire · X: tight · G: defend · Y: aggressive</div>
        <div>T: dig-in · 1/2/3: line/wedge/column · 0: auto</div>
      </div>

      {/* Bottom bar */}
      <div className="pointer-events-auto flex items-end gap-4 px-4 py-2 font-mono text-xs"
        style={{ background: 'rgba(15,20,15,0.88)', borderTop: '1px solid #2a3a2a' }}>
        {/* Reinforcement spawn */}
        <div className="flex gap-2">
          {unitTypes.map(({ type, label }) => {
            const cost = UNIT_STATS[type].cost;
            const canAfford = pool >= cost;
            return (
              <button key={type} onClick={() => onSpawn(type)}
                className="px-2 py-1 border flex flex-col items-center min-w-[60px]"
                style={{
                  background: canAfford ? 'rgba(40,55,40,0.85)' : 'rgba(28,32,28,0.85)',
                  borderColor: canAfford ? '#5a7a5a' : '#3a4a3a',
                  color: canAfford ? '#c0d0b0' : '#5a6a5a',
                  cursor: canAfford ? 'pointer' : 'not-allowed',
                }}
                disabled={!canAfford}>
                <span>{label}</span>
                <span style={{ color: '#d4c47a' }}>{cost}</span>
              </button>
            );
          })}
        </div>

        {/* Stance buttons */}
        <div className="flex flex-col gap-1">
          <div style={{ color: '#7a8a6a' }}>Stance</div>
          <div className="flex gap-1">
            {(['hold_fire', 'tight', 'defend', 'aggressive'] as Stance[]).map(s => (
              <button key={s} onClick={() => onStance(s)}
                className="px-2 py-0.5 border"
                style={{ background: 'rgba(40,50,40,0.8)', borderColor: '#5a6a5a' }}>
                {s.replace('_', '-')}
              </button>
            ))}
            <button onClick={onHold} className="px-2 py-0.5 border" style={{ background: 'rgba(40,50,40,0.8)', borderColor: '#5a6a5a' }}>
              hold-pos
            </button>
            <button onClick={onDig} className="px-2 py-0.5 border" style={{ background: 'rgba(60,55,30,0.8)', borderColor: '#7a6a3a', color: '#e4d488' }}>
              dig-in [T]
            </button>
          </div>
          <div className="flex gap-1 mt-1">
            <span style={{ color: '#7a8a6a' }}>Form:</span>
            {(['line', 'wedge', 'column'] as FormationType[]).map(f => (
              <button key={f} onClick={() => onFormation(f)} className="px-2 py-0.5 border"
                style={{
                  background: gameState.preferredFormation === f ? 'rgba(80,100,60,0.9)' : 'rgba(40,50,40,0.8)',
                  borderColor: '#5a6a5a',
                }}>
                {f}
              </button>
            ))}
            <button onClick={() => onFormation(null)} className="px-2 py-0.5 border"
              style={{ background: !gameState.preferredFormation ? 'rgba(80,100,60,0.9)' : 'rgba(40,50,40,0.8)', borderColor: '#5a6a5a' }}>
              auto
            </button>
          </div>
        </div>

        {/* Selected info */}
        {selected.length > 0 && (
          <div className="flex-1 ml-2">
            <div style={{ color: '#a5cf6f' }}>Selected: {selected.length}</div>
            {selected.length === 1 && (
              <div className="grid grid-cols-2 gap-x-3">
                <span>{selected[0].type} · {selected[0].order}</span>
                <span>HP {Math.ceil(selected[0].health)}/{selected[0].maxHealth}</span>
                <span>Ammo {selected[0].ammo}/{selected[0].maxAmmo}{selected[0].reloadTimer > 0 ? ' ⟳' : ''}</span>
                <span>Stance {selected[0].stance}</span>
                <span>Morale {Math.round(selected[0].morale * 100)}% · Fatigue {Math.round(selected[0].fatigue * 100)}%</span>
                <span style={{ color: selected[0].veterancy >= 3 ? '#f0a030' : '#b0c090' }}>
                  {'★'.repeat(selected[0].veterancy)} {VETERANCY_NAMES[selected[0].veterancy]} ({selected[0].kills} kills)
                </span>
              </div>
            )}
          </div>
        )}

        {/* Event log */}
        <div className="w-72 max-h-24 overflow-hidden">
          {gameState.eventLog.slice(0, 6).map((log, i) => (
            <div key={i} className="truncate" style={{
              color: log.type === 'kill' ? '#da5c5c'
                : log.type === 'contact' ? '#f0a030'
                : log.type === 'objective' ? '#5cda5c'
                : log.type === 'reward' ? '#f0a030'
                : log.type === 'spawn' ? '#d4c47a' : '#7a8a6a',
              opacity: 1 - i * 0.13,
            }}>{log.message}</div>
          ))}
        </div>
      </div>

      {/* Game over */}
      {gameState.gameOver && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div className="text-center p-8 font-mono" style={{ background: 'rgba(15,20,15,0.96)', border: '2px solid #5a6a5a' }}>
            <h2 className="text-3xl mb-4" style={{ color: gameState.gameResult === 'win' ? '#5cda5c' : '#da5c5c' }}>
              {gameState.gameResult === 'win' ? 'MISSION COMPLETE' : 'MISSION FAILED'}
            </h2>
            <div className="mb-4 text-sm" style={{ color: '#a5cf6f' }}>{gameState.mission.name}</div>
            <button onClick={onExit} className="px-4 py-2 border"
              style={{ background: 'rgba(40,55,40,0.85)', borderColor: '#5a7a5a', color: '#c0d0b0' }}>
              Return to Mission Select
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameHUD;
