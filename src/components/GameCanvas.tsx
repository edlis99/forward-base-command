import React, { useRef, useEffect, useCallback } from 'react';
import { GameState, InputState } from '../game/types';
import {
  createInitialState, createInputState, update, render,
  screenToWorld, handleLeftClick, handleRightClick, handleBoxSelect,
} from '../game/engine';

interface GameCanvasProps {
  gameStateRef: React.MutableRefObject<GameState>;
  inputRef: React.MutableRefObject<InputState>;
  onStateChange: () => void;
}

const GameCanvas: React.FC<GameCanvasProps> = ({ gameStateRef, inputRef, onStateChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const state = gameStateRef.current;
    const world = screenToWorld(sx, sy, state);

    if (e.button === 0) {
      // Left click
      if (e.altKey) {
        // Pan
        inputRef.current.isPanning = true;
        inputRef.current.dragStart = { x: e.clientX, y: e.clientY };
      } else {
        inputRef.current.isDragging = true;
        inputRef.current.dragStart = { x: world.x, y: world.y };
        handleLeftClick(world.x, world.y, state, e.shiftKey);
        onStateChange();
      }
    } else if (e.button === 2) {
      handleRightClick(world.x, world.y, state);
      onStateChange();
    }
  }, [gameStateRef, inputRef, onStateChange]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const state = gameStateRef.current;
    const world = screenToWorld(sx, sy, state);

    inputRef.current.mousePos = { x: sx, y: sy };
    inputRef.current.mouseWorldPos = world;

    if (inputRef.current.isPanning && inputRef.current.dragStart) {
      const dx = e.clientX - inputRef.current.dragStart.x;
      const dy = e.clientY - inputRef.current.dragStart.y;
      state.camera.x -= dx / state.zoom;
      state.camera.y -= dy / state.zoom;
      inputRef.current.dragStart = { x: e.clientX, y: e.clientY };
    } else if (inputRef.current.isDragging && inputRef.current.dragStart) {
      state.selectionBox = {
        start: inputRef.current.dragStart,
        end: world,
      };
    }
  }, [gameStateRef, inputRef]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const state = gameStateRef.current;
    if (inputRef.current.isDragging && state.selectionBox) {
      const { start, end } = state.selectionBox;
      const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      if (dist > 10) {
        handleBoxSelect(start.x, start.y, end.x, end.y, state, e.shiftKey);
      }
      state.selectionBox = null;
      onStateChange();
    }
    inputRef.current.isDragging = false;
    inputRef.current.isPanning = false;
    inputRef.current.dragStart = null;
  }, [gameStateRef, inputRef, onStateChange]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const state = gameStateRef.current;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    state.zoom = Math.max(0.5, Math.min(2, state.zoom * zoomFactor));
  }, [gameStateRef]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      inputRef.current.keys.add(e.key.toLowerCase());
      const state = gameStateRef.current;

      // Ability hotkeys
      if (e.key === 'q') state.activeAbility = state.activeAbility === 'recon_drone' ? null : 'recon_drone';
      if (e.key === 'e') state.activeAbility = state.activeAbility === 'smoke_screen' ? null : 'smoke_screen';
      if (e.key === 'Escape') {
        state.activeAbility = null;
        state.units.forEach(u => u.selected = false);
      }

      // Avoid 'w' conflict with camera and airstrike — use 'r' for airstrike instead
      if (e.key === 'r') state.activeAbility = state.activeAbility === 'airstrike' ? null : 'airstrike';

      onStateChange();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      inputRef.current.keys.delete(e.key.toLowerCase());
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [inputRef, gameStateRef, onStateChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = canvas.parentElement?.clientWidth || 1200;
      canvas.height = canvas.parentElement?.clientHeight || 700;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const gameLoop = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = timestamp;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      update(gameStateRef.current, inputRef.current, dt);
      render(ctx, gameStateRef.current, canvas.width, canvas.height);

      animFrameRef.current = requestAnimationFrame(gameLoop);
    };

    animFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [gameStateRef, inputRef]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
    />
  );
};

export default GameCanvas;
