import { useEffect, useRef } from 'react';
import { GameState, InputState } from '../game/types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { drawCampaignMap } from '../game/maps/drawCampaignMap';
import { cameraView } from '../scene3d/cameraView';

export function CampaignMap({ gameStateRef, inputRef }: { gameStateRef: React.MutableRefObject<GameState>; inputRef: React.MutableRefObject<InputState> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d')!;
    const background = document.createElement('canvas'); background.width = canvas.width; background.height = canvas.height;
    drawCampaignMap(background.getContext('2d')!, gameStateRef.current.terrain, canvas.width, canvas.height, true);
    const paint = () => {
      ctx.drawImage(background, 0, 0);
      for (const u of gameStateRef.current.units) {
        if (!u.alive || u.insideOf || (u.team === 'enemy' && !u.spottedByEnemy)) continue;
        ctx.fillStyle = u.team === 'player' ? '#90daf8' : '#f09b82';
        const x = u.pos.x / CELL_SIZE / MAP_COLS * canvas.width, y = u.pos.y / CELL_SIZE / MAP_ROWS * canvas.height;
        ctx.beginPath(); ctx.arc(x, y, u.selected ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      }
      // The part of the map in view: the camera's outline on the ground (a
      // trapezoid, as the camera looks at the land at an angle; it turns with the view).
      const corners = cameraView.corners;
      if (corners.length === 4) {
        ctx.beginPath();
        corners.forEach((c, i) => {
          const x = c.x / MAP_COLS * canvas.width, y = c.z / MAP_ROWS * canvas.height;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(240, 236, 214, 0.12)'; ctx.fill();
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(12, 20, 16, 0.85)'; ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = '#f4efd8'; ctx.lineWidth = 2; ctx.stroke();
      }
    };
    // Every frame, so the view outline follows the camera without lag.
    let frame = 0;
    const loop = () => { paint(); frame = requestAnimationFrame(loop); };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [gameStateRef]);
  // Click to look there; hold and drag to pan the view across the map.
  const dragging = useRef(false);
  const focusAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    inputRef.current.cameraFocus = {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * MAP_COLS * CELL_SIZE,
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) * MAP_ROWS * CELL_SIZE,
    };
  };
  return <div className="absolute bottom-[216px] right-3 w-[260px] border border-[#71856b] bg-[#15251eee] p-1 font-mono text-[10px] text-[#d2dfc4]">
    <div className="flex justify-between px-1 mb-1"><span>REGION · click to focus</span><span>N ↑</span></div>
    <canvas ref={ref} width={520} height={378} aria-label="Leipalingis tactical region map" className="block w-full cursor-crosshair touch-none"
      onPointerDown={e => { if (e.button !== 0) return; dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); focusAt(e); }}
      onPointerMove={e => { if (dragging.current) focusAt(e); }}
      onPointerUp={e => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { dragging.current = false; }} />
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="text-[8px] opacity-70">© OpenStreetMap contributors</a>
  </div>;
}
