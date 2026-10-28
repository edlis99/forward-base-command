import React, { useRef, useState, useCallback, useEffect } from 'react';
import { GameState, InputState, UnitType, MissionDef, Stance, DeploymentContext } from '../game/types';
import {
  createInitialState, createInputState, update,
  spawnReinforcement, setStanceForSelected, holdPositionForSelected, togglePause,
  digInForSelected, setFormation, toggleDebugLayer, digTrenchLineForSelected,
  setTimeScale, disembarkSelected,
} from '../game/engine';
import { selectUnits, controllable } from '../game/selection';
import { takeCoverForSelected } from '../game/cover';
import Scene3D from '../scene3d/Scene3D';
import GameHUD from './GameHUD';
import MissionSelect from './MissionSelect';
import DeploymentScreen from './DeploymentScreen';
import MissionSummary from './MissionSummary';
import { applyCommand } from '../game/commands';

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
    if (m.id === 'raas') {
      // RAAS has fixed mains on both sides: no campaign deployment screen.
      inputRef.current = createInputState();
      gameStateRef.current = createInitialState(m, undefined, { seed: Math.floor(Math.random() * 0x7fffffff) });
      setPhase('combat');
      triggerHudUpdate();
      return;
    }
    setPhase('deployment');
  }, [triggerHudUpdate]);

  const beginCombat = useCallback((ctx: DeploymentContext) => {
    if (!mission) return;
    inputRef.current = createInputState();
    // Single-player: a fresh seed per game so battles differ; matches on a server pass an agreed seed instead.
    gameStateRef.current = createInitialState(mission, ctx, { seed: Math.floor(Math.random() * 0x7fffffff) });
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
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const state = gameStateRef.current; if (!state) return;
      if (state.gameOver || e.repeat) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'a') {
        e.preventDefault(); selectUnits(state, state.units.filter(controllable).map(u => u.id)); triggerHudUpdate(); return;
      }
      inputRef.current.keys.add(k);
      if (k === 'c') { takeCoverForSelected(state); triggerHudUpdate(); }
      if (k === 'r' && state.raas) {
        // RAAS: a selected, stopped APC deploys a radio where it stands.
        const apc = state.units.find(u => u.alive && u.selected && u.team === 'player' && u.type === 'apc' && !u.insideOf);
        const result = apc ? applyCommand(state, 'player', { type: 'build_radio', unitId: apc.id }) : { ok: false as const, reason: 'select an APC first' };
        if (!result.ok) state.eventLog.unshift({ message: `Radio: ${result.reason}`, time: state.time, type: 'info' });
        triggerHudUpdate();
      }
      if (k === 'b' && state.raas) {
        // RAAS: lay out a spawn point where the selected infantry stand (near your radio).
        const inf = state.units.filter(u => u.alive && u.selected && u.team === 'player' && u.type === 'infantry' && !u.insideOf);
        const result = inf.length
          ? applyCommand(state, 'player', { type: 'build_spawn', x: inf.reduce((n, u) => n + u.pos.x, 0) / inf.length, y: inf.reduce((n, u) => n + u.pos.y, 0) / inf.length })
          : { ok: false as const, reason: 'select infantry standing near your radio' };
        if (!result.ok) state.eventLog.unshift({ message: `Spawn point: ${result.reason}`, time: state.time, type: 'info' });
        triggerHudUpdate();
      }
      if (k === ' ') { e.preventDefault(); togglePause(state); triggerHudUpdate(); }
      if (k === 'h') { holdPositionForSelected(state); triggerHudUpdate(); }
      if (k === 'u') { disembarkSelected(state); triggerHudUpdate(); }
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
      if (k === 'f4') { e.preventDefault(); toggleDebugLayer(state, 'showMovement'); triggerHudUpdate(); }
      if (k === 'escape') { selectUnits(state, []); triggerHudUpdate(); }
    };
    const onUp = (e: KeyboardEvent) => inputRef.current.keys.delete(e.key.toLowerCase());
    const onBlur = () => { inputRef.current = createInputState(); const state = gameStateRef.current; if (state) { state.selectionBox = null; state.previewSelected.clear(); state.commandPreview = null; } };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', onBlur); };
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
        onChange={triggerHudUpdate}
        onFocus={pos => { inputRef.current.cameraFocus = pos; }}
        onSpawn={handleSpawn}
        onStance={handleStance}
        onHold={() => { holdPositionForSelected(gameStateRef.current!); triggerHudUpdate(); }}
        onTogglePause={() => { togglePause(gameStateRef.current!); triggerHudUpdate(); }}
        onExit={exitMission}
        onDig={() => { digInForSelected(gameStateRef.current!); triggerHudUpdate(); }}
        onUnload={() => { disembarkSelected(gameStateRef.current!); triggerHudUpdate(); }}
        onFormation={(f) => { setFormation(gameStateRef.current!, f); triggerHudUpdate(); }}
        onToggleDebug={(l) => { toggleDebugLayer(gameStateRef.current!, l); triggerHudUpdate(); }}
        onSetTimeScale={(s) => { setTimeScale(gameStateRef.current!, s); triggerHudUpdate(); }}
      />
      {gameStateRef.current.gameOver && (
        <MissionSummary
          gameState={gameStateRef.current}
          onReturn={exitMission}
          onRetry={() => {
            cancelAnimationFrame(animRef.current);
            gameStateRef.current = null;
            setPhase('deployment');
          }}
        />
      )}
    </div>
  );
};

export default GameUI;
