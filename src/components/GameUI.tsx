import React, { useRef, useState, useCallback, useEffect } from 'react';
import { GameState, InputState, UnitType, MissionDef, Stance } from '../game/types';
import {
  createInitialState, createInputState, update,
  spawnReinforcement, setStanceForSelected, holdPositionForSelected, togglePause,
} from '../game/engine';
import Scene3D from '../scene3d/Scene3D';
import GameHUD from './GameHUD';
import MissionSelect from './MissionSelect';

const GameUI: React.FC = () => {
  const [mission, setMission] = useState<MissionDef | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const inputRef = useRef<InputState>(createInputState());
  const [hudVersion, setHudVersion] = useState(0);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const triggerHudUpdate = useCallback(() => setHudVersion(v => v + 1), []);

  const startMission = useCallback((m: MissionDef) => {
    gameStateRef.current = createInitialState(m);
    setMission(m);
    triggerHudUpdate();
  }, [triggerHudUpdate]);

  const exitMission = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    gameStateRef.current = null;
    setMission(null);
  }, []);

  // Game loop
  useEffect(() => {
    if (!mission) return;
    lastTimeRef.current = 0;
    const loop = (ts: number) => {
      if (!gameStateRef.current) return;
      if (!lastTimeRef.current) lastTimeRef.current = ts;
      const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = ts;
      update(gameStateRef.current, inputRef.current, dt);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [mission]);

  // HUD ticker (low frequency)
  useEffect(() => {
    if (!mission) return;
    const id = setInterval(triggerHudUpdate, 200);
    return () => clearInterval(id);
  }, [mission, triggerHudUpdate]);

  // Key handling
  useEffect(() => {
    if (!mission) return;
    const onDown = (e: KeyboardEvent) => {
      inputRef.current.keys.add(e.key.toLowerCase());
      const state = gameStateRef.current; if (!state) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); togglePause(state); triggerHudUpdate(); }
      if (k === 'h') { holdPositionForSelected(state); triggerHudUpdate(); }
      if (k === 'f') { setStanceForSelected(state, 'hold_fire'); triggerHudUpdate(); }
      if (k === 'x') { setStanceForSelected(state, 'tight'); triggerHudUpdate(); }
      if (k === 'g') { setStanceForSelected(state, 'defend'); triggerHudUpdate(); }
      if (k === 'y') { setStanceForSelected(state, 'aggressive'); triggerHudUpdate(); }
      if (k === 'escape') { state.units.forEach(u => u.selected = false); triggerHudUpdate(); }
    };
    const onUp = (e: KeyboardEvent) => inputRef.current.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [mission, triggerHudUpdate]);

  const handleSpawn = useCallback((type: UnitType) => {
    if (!gameStateRef.current) return;
    spawnReinforcement(type, gameStateRef.current);
    triggerHudUpdate();
  }, [triggerHudUpdate]);

  const handleStance = useCallback((s: Stance) => {
    if (!gameStateRef.current) return;
    setStanceForSelected(gameStateRef.current, s);
    triggerHudUpdate();
  }, [triggerHudUpdate]);

  if (!mission || !gameStateRef.current) {
    return (
      <div className="relative w-full h-screen overflow-hidden">
        <MissionSelect onStart={startMission} />
      </div>
    );
  }

  return (
    <div className="relative w-full h-screen overflow-hidden" style={{ background: '#0d1110' }}>
      <Scene3D
        gameStateRef={gameStateRef as React.MutableRefObject<GameState>}
        inputRef={inputRef}
        onChange={triggerHudUpdate}
      />
      <GameHUD
        gameState={gameStateRef.current}
        onSpawn={handleSpawn}
        onStance={handleStance}
        onHold={() => { holdPositionForSelected(gameStateRef.current!); triggerHudUpdate(); }}
        onTogglePause={() => { togglePause(gameStateRef.current!); triggerHudUpdate(); }}
        onExit={exitMission}
      />
    </div>
  );
};

export default GameUI;
