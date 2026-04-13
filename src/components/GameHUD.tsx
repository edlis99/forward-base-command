import React from 'react';
import { GameState, UnitType } from '../game/types';
import { UNIT_STATS, VETERANCY_NAMES } from '../game/constants';

interface GameHUDProps {
  gameState: GameState;
  onSpawn: (type: UnitType) => void;
  onAbility: (key: string) => void;
  hudVersion: number;
}

const GameHUD: React.FC<GameHUDProps> = ({ gameState, onSpawn, onAbility }) => {
  const selected = gameState.units.filter(u => u.alive && u.selected && u.team === 'player');
  const cp = Math.floor(gameState.commandPoints);

  const unitTypes: { type: UnitType; label: string; icon: string }[] = [
    { type: 'infantry', label: 'Infantry', icon: '👤' },
    { type: 'tank', label: 'Tank', icon: '🔷' },
    { type: 'apc', label: 'APC', icon: '🚛' },
    { type: 'helicopter', label: 'Heli', icon: '🚁' },
  ];

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      {/* Top bar */}
      <div className="pointer-events-auto flex items-center justify-between px-4 py-2"
        style={{ background: 'rgba(20,25,20,0.85)' }}>
        <div className="flex items-center gap-6">
          <div className="text-sm font-mono" style={{ color: '#a0b090' }}>
            <span style={{ color: '#d4c47a' }}>⬢ CP: {cp}</span>
            <span className="ml-2 text-xs" style={{ color: '#7a8a6a' }}>+{gameState.commandPointRate}/s</span>
          </div>
          <div className="text-xs font-mono" style={{ color: '#8a9a7a' }}>
            Wave: {gameState.wave}/10
          </div>
          <div className="text-xs font-mono" style={{ color: '#8a9a7a' }}>
            Units: {gameState.units.filter(u => u.alive && u.team === 'player').length}
          </div>
          <div className="text-xs font-mono" style={{ color: '#d4c47a' }}>
            Kills: {gameState.totalKills}
            {gameState.killStreak >= 3 && (
              <span style={{ color: '#f0a030' }}> 🔥x{gameState.killStreak}</span>
            )}
          </div>
        </div>

        {/* Abilities */}
        <div className="flex gap-2">
          {gameState.abilities.map(ab => {
            const active = gameState.activeAbility === ab.type;
            const ready = ab.currentCooldown <= 0;
            const needsUnit = ab.requiresUnit;
            const hasSelected = selected.length > 0;
            const canUse = ready && (!needsUnit || hasSelected);
            return (
              <button
                key={ab.type}
                onClick={() => onAbility(ab.key)}
                className="px-3 py-1 text-xs font-mono border transition-colors"
                style={{
                  background: active ? 'rgba(74,144,217,0.3)' : 'rgba(40,50,40,0.8)',
                  borderColor: active ? '#4a90d9' : canUse ? '#5a6a5a' : '#3a4a3a',
                  color: canUse ? '#c0d0b0' : '#5a6a5a',
                  cursor: canUse ? 'pointer' : 'not-allowed',
                }}
                disabled={!canUse}
                title={ab.description + (needsUnit ? ' (requires selected unit)' : '')}
              >
                [{ab.key.toUpperCase()}] {ab.name}
                {needsUnit && <span className="ml-1 text-xs" style={{ color: '#6ab0f9' }}>📡</span>}
                {ab.currentCooldown > 0 && (
                  <span className="ml-1" style={{ color: '#d94a4a' }}>
                    {Math.ceil(ab.currentCooldown)}s
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active ability indicator */}
      {gameState.activeAbility && (
        <div className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 px-4 py-1 text-xs font-mono"
          style={{ background: 'rgba(74,144,217,0.2)', color: '#6ab0f9', border: '1px solid rgba(74,144,217,0.4)' }}>
          {gameState.activeAbility === 'recon_drone' 
            ? 'Click target area to launch drone from selected unit · ESC to cancel'
            : `Click to deploy ${gameState.activeAbility.replace('_', ' ')} · ESC to cancel`}
        </div>
      )}

      {/* Bottom panel */}
      <div className="pointer-events-auto flex items-end gap-4 px-4 py-2"
        style={{ background: 'rgba(20,25,20,0.85)' }}>
        {/* Unit spawn */}
        <div className="flex gap-2">
          {unitTypes.map(({ type, label, icon }) => {
            const cost = UNIT_STATS[type].cost;
            const canAfford = cp >= cost;
            return (
              <button
                key={type}
                onClick={() => onSpawn(type)}
                className="flex flex-col items-center px-3 py-2 text-xs font-mono border transition-colors"
                style={{
                  background: canAfford ? 'rgba(40,60,40,0.8)' : 'rgba(30,35,30,0.8)',
                  borderColor: canAfford ? '#5a7a5a' : '#3a4a3a',
                  color: canAfford ? '#c0d0b0' : '#5a6a5a',
                  cursor: canAfford ? 'pointer' : 'not-allowed',
                  minWidth: 65,
                }}
                disabled={!canAfford}
              >
                <span className="text-lg">{icon}</span>
                <span>{label}</span>
                <span style={{ color: '#d4c47a' }}>{cost} CP</span>
              </button>
            );
          })}
        </div>

        {/* Selected unit info */}
        {selected.length > 0 && (
          <div className="flex-1 ml-4">
            <div className="text-xs font-mono mb-1" style={{ color: '#8a9a7a' }}>
              Selected: {selected.length} unit{selected.length > 1 ? 's' : ''}
            </div>
            {selected.length === 1 && (
              <div className="text-xs font-mono grid grid-cols-2 gap-x-4 gap-y-1" style={{ color: '#a0b090' }}>
                <span>Type: {selected[0].type}</span>
                <span>HP: {Math.ceil(selected[0].health)}/{selected[0].maxHealth}</span>
                <span>DMG: {Math.round(selected[0].damage)} | ARM: {selected[0].armor}</span>
                <span>ACC: {Math.round(selected[0].accuracy * 100)}% | Morale: {Math.round(selected[0].morale * 100)}%</span>
                <span style={{ color: VETERANCY_NAMES[selected[0].veterancy] === 'Elite' ? '#f0a030' : '#b0c090' }}>
                  {'★'.repeat(selected[0].veterancy)} {VETERANCY_NAMES[selected[0].veterancy]} ({selected[0].kills} kills)
                </span>
                {selected[0].droneActive && (
                  <span style={{ color: '#6ab0f9' }}>🛸 Drone active</span>
                )}
              </div>
            )}
            {selected.length > 1 && (
              <div className="text-xs font-mono flex gap-3" style={{ color: '#a0b090' }}>
                {(['infantry', 'tank', 'apc', 'helicopter'] as const).map(t => {
                  const count = selected.filter(u => u.type === t).length;
                  return count > 0 ? <span key={t}>{t}: {count}</span> : null;
                })}
              </div>
            )}
          </div>
        )}

        {/* Event log */}
        <div className="w-72 max-h-28 overflow-hidden">
          {gameState.eventLog.slice(0, 5).map((log, i) => (
            <div key={i} className="text-xs font-mono truncate" style={{
              color: log.type === 'kill' ? '#d94a4a' 
                : log.type === 'ability' ? '#4a90d9' 
                : log.type === 'spawn' ? '#d4c47a' 
                : log.type === 'reward' ? '#f0a030'
                : '#7a8a6a',
              opacity: 1 - i * 0.15,
            }}>
              {log.message}
            </div>
          ))}
        </div>
      </div>

      {/* Game over overlay */}
      {gameState.gameOver && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="text-center p-8" style={{ background: 'rgba(20,25,20,0.95)', border: '2px solid #5a6a5a' }}>
            <h2 className="text-3xl font-mono mb-4" style={{
              color: gameState.gameResult === 'win' ? '#4ad94a' : '#d94a4a'
            }}>
              {gameState.gameResult === 'win' ? 'VICTORY' : 'DEFEAT'}
            </h2>
            <div className="text-sm font-mono mb-2" style={{ color: '#d4c47a' }}>
              Total kills: {gameState.totalKills} | Best streak: {gameState.killStreak}
            </div>
            <p className="text-sm font-mono mb-4" style={{ color: '#a0b090' }}>
              {gameState.gameResult === 'win'
                ? 'All enemy forces eliminated. Area secured.'
                : 'All friendly forces destroyed. Mission failed.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 font-mono text-sm border"
              style={{ background: 'rgba(40,60,40,0.8)', borderColor: '#5a7a5a', color: '#c0d0b0', cursor: 'pointer' }}
            >
              RESTART MISSION
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameHUD;
