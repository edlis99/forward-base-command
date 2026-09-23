import { useEffect, useRef } from 'react';
import { GameState, InputState } from '../game/types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { drawCampaignMap } from '../game/maps/drawCampaignMap';

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
    };
    paint(); const timer = window.setInterval(paint, 200); return () => window.clearInterval(timer);
  }, [gameStateRef]);
  return <div className="absolute bottom-[216px] right-3 w-[260px] border border-[#71856b] bg-[#15251eee] p-1 font-mono text-[10px] text-[#d2dfc4]">
    <div className="flex justify-between px-1 mb-1"><span>REGION · click to focus</span><span>N ↑</span></div>
    <canvas ref={ref} width={520} height={378} aria-label="Leipalingis tactical region map" className="block w-full cursor-crosshair"
      onClick={e => { const box = e.currentTarget.getBoundingClientRect(); inputRef.current.cameraFocus = {
        x: (e.clientX - box.left) / box.width * MAP_COLS * CELL_SIZE,
        y: (e.clientY - box.top) / box.height * MAP_ROWS * CELL_SIZE,
      }; }} />
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="text-[8px] opacity-70">© OpenStreetMap contributors</a>
  </div>;
}
