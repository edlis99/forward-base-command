import React, { useRef, useState, useCallback, useEffect } from 'react';
import { GameState, InputState, UnitType, MissionDef, Stance, DeploymentContext } from '../game/types';
import {
  createInitialState, createInputState, update,
  spawnReinforcement, setStanceForSelected, holdPositionForSelected, togglePause,
  digInForSelected, setFormation, toggleDebugLayer, digTrenchLineForSelected,
  setTimeScale,
} from '../game/engine';
import Scene3D from '../scene3d/Scene3D';
import GameHUD from './GameHUD';
import MissionSelect from './MissionSelect';
import DeploymentScreen from './DeploymentScreen';

type Phase = 'briefing' | 'deployment' | 'combat';

const GameUI: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('briefing');
  const [mission, setMission] = useState<MissionDef | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const inputRef = useRef<InputState>(createInputState());
  const [hudVersion, setHudVersion] = useState(0);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const triggerHudUpdate = useCallback(() => setHudVersion(v => v + 1), []);

  const openBriefing = useCallback((m: MissionDef) => {
    setMission(m);
    setPhase('deployment');
  }, []);

  const beginCombat = useCallback((ctx: DeploymentContext) => {
    if (!mission) return;
    gameStateRef.current = createInitialState(mission, ctx);
    setPhase('combat');
    triggerHudUpdate();
  }, [mission, triggerHudUpdate]);

  const exitMission = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    gameStateRef.current = null;
    setMission(null);
    setPhase('briefing');
  }, []);

  useEffect(() => {
    if (phase !== 'combat') return;
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
  }, [phase]);

  useEffect(() => {
    if (phase !== 'combat') return;
    const id = setInterval(triggerHudUpdate, 200);
    return () => clearInterval(id);
  }, [phase, triggerHudUpdate]);

  useEffect(() => {
    if (phase !== 'combat') return;
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
      if (k === 't') {
        if (e.shiftKey) digTrenchLineForSelected(state);
        else digInForSelected(state);
        triggerHudUpdate();
      }
      // Formations 4/5/6 to avoid conflict with time-scale 1/2/3/4
      if (k === '5') { setFormation(state, 'line'); triggerHudUpdate(); }
      if (k === '6') { setFormation(state, 'wedge'); triggerHudUpdate(); }
      if (k === '7') { setFormation(state, 'column'); triggerHudUpdate(); }
      if (k === '0') { setFormation(state, null); triggerHudUpdate(); }
      // Tactical time control
      if (k === '1') { setTimeScale(state, 0.25); triggerHudUpdate(); }
      if (k === '2') { setTimeScale(state, 0.5); triggerHudUpdate(); }
      if (k === '3') { setTimeScale(state, 1); triggerHudUpdate(); }
      if (k === '4') { setTimeScale(state, 2); triggerHudUpdate(); }
      if (k === 'f1') { e.preventDefault(); toggleDebugLayer(state, 'showCover'); triggerHudUpdate(); }
      if (k === 'f2') { e.preventDefault(); toggleDebugLayer(state, 'showConcealment'); triggerHudUpdate(); }
      if (k === 'f3') { e.preventDefault(); toggleDebugLayer(state, 'showTactical'); triggerHudUpdate(); }
      if (k === 'escape') { state.units.forEach(u => u.selected = false); triggerHudUpdate(); }
    };
    const onUp = (e: KeyboardEvent) => inputRef.current.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, [phase, triggerHudUpdate]);

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

  if (phase === 'briefing' || !mission) {
    return (
      <div className="relative w-full h-screen overflow-hidden">
        <MissionSelect onStart={openBriefing} />
      </div>
    );
  }
  if (phase === 'deployment' || !gameStateRef.current) {
    return (
      <div className="relative w-full h-screen overflow-hidden">
        <DeploymentScreen mission={mission} onStart={beginCombat} onBack={() => setPhase('briefing')} />
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
        onDig={() => { digInForSelected(gameStateRef.current!); triggerHudUpdate(); }}
        onFormation={(f) => { setFormation(gameStateRef.current!, f); triggerHudUpdate(); }}
        onToggleDebug={(l) => { toggleDebugLayer(gameStateRef.current!, l); triggerHudUpdate(); }}
        onSetTimeScale={(s) => { setTimeScale(gameStateRef.current!, s); triggerHudUpdate(); }}
      />
    </div>
  );
};

export default GameUI;
