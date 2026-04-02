import React, { useRef, useState, useCallback } from 'react';
import { GameState, InputState, UnitType } from '../game/types';
import { createInitialState, createInputState, spawnUnit } from '../game/engine';
import GameCanvas from './GameCanvas';
import GameHUD from './GameHUD';

const GameUI: React.FC = () => {
  const gameStateRef = useRef<GameState>(createInitialState());
  const inputRef = useRef<InputState>(createInputState());
  const [hudVersion, setHudVersion] = useState(0);

  const triggerHudUpdate = useCallback(() => {
    setHudVersion(v => v + 1);
  }, []);

  const handleSpawn = useCallback((type: UnitType) => {
    spawnUnit(type, gameStateRef.current);
    triggerHudUpdate();
  }, [triggerHudUpdate]);

  const handleAbility = useCallback((key: string) => {
    const state = gameStateRef.current;
    if (key === 'q') state.activeAbility = state.activeAbility === 'recon_drone' ? null : 'recon_drone';
    if (key === 'w') state.activeAbility = state.activeAbility === 'airstrike' ? null : 'airstrike';
    if (key === 'e') state.activeAbility = state.activeAbility === 'smoke_screen' ? null : 'smoke_screen';
    triggerHudUpdate();
  }, [triggerHudUpdate]);

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: '#1a1f1a' }}>
      <GameCanvas
        gameStateRef={gameStateRef}
        inputRef={inputRef}
        onStateChange={triggerHudUpdate}
      />
      <GameHUD
        gameState={gameStateRef.current}
        onSpawn={handleSpawn}
        onAbility={handleAbility}
        hudVersion={hudVersion}
      />
    </div>
  );
};

export default GameUI;
