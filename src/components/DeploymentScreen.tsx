import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MissionDef, DeploymentTownId, DeploymentContext, DeploymentTown } from '../game/types';
import { generateTerrain, LEIPALINGIS_ANCHORS } from '../game/terrain';
import { MAP_COLS, MAP_ROWS } from '../game/constants';

interface Props {
  mission: MissionDef;
  onStart: (ctx: DeploymentContext) => void;
  onBack: () => void;
}

const riskColor: Record<'low' | 'med' | 'high', string> = {
  low: '#8adc7a', med: '#e4c46a', high: '#e07a5a',
};

// Tactical map colours – slightly muted / desaturated vs 3D scene
const MAP_COLORS: Record<string, string> = {
  open: '#556b3f', tall_grass: '#6e8548', forest: '#25401c',
  road: '#3b342a', gravel: '#7d7360', urban: '#a49484',
  wall: '#7a7268', water: '#254b66', mud: '#3a2d1e',
  hedgerow: '#2e4a22', sandbag: '#9c8a5e', trench: '#2a2018',
  rubble: '#6f685c', crater: '#241d18',
};

const TOWN_KEY: Record<DeploymentTownId, keyof typeof LEIPALINGIS_ANCHORS> = {
  jovaisiai: 'jovaisiai', didziasalis: 'didziasalis',
  versiai: 'versiai', straciunai: 'straciunai', seirijai: 'seirijai',
};

function TacticalMap({ towns, selected, onSelect }: {
  towns: DeploymentTown[]; selected: DeploymentTownId;
  onSelect: (id: DeploymentTownId) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 640, h: 480 });
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const terrain = useMemo(() => generateTerrain('leipalingis_region', 1337), []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.floor(e.contentRect.width);
      const h = Math.floor(w * (MAP_ROWS / MAP_COLS));
      setSize({ w, h });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const ctx = cvs.getContext('2d'); if (!ctx) return;
    // Draw at native map resolution then let CSS scale — sharpest & cheap
    cvs.width = MAP_COLS;
    cvs.height = MAP_ROWS;
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(MAP_COLS, MAP_ROWS);
    for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
      const c = terrain[y][x];
      const hex = MAP_COLORS[c.type] ?? '#3a4a32';
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // Slight elevation shading
      const shade = c.elevation === 2 ? 22 : c.elevation === 0 ? -18 : 0;
      const i = (y * MAP_COLS + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, r + shade));
      img.data[i + 1] = Math.max(0, Math.min(255, g + shade));
      img.data[i + 2] = Math.max(0, Math.min(255, b + shade));
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [terrain]);

  const cellToPct = (x: number, y: number) => ({
    left: `${(x / MAP_COLS) * 100}%`,
    top: `${(y / MAP_ROWS) * 100}%`,
  });

  const L = LEIPALINGIS_ANCHORS.leipalingis;

  return (
    <div ref={wrapRef} className="relative border" style={{ borderColor: '#3a4a3a', background: '#0a0f0a' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%', height: 'auto', display: 'block',
          imageRendering: 'pixelated',
          filter: 'contrast(1.05) saturate(0.9)',
        }}
      />
      {/* Grid overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage:
          'linear-gradient(rgba(200,220,180,0.06) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(200,220,180,0.06) 1px, transparent 1px)',
        backgroundSize: '10% 10%',
      }} />

      {/* Objective marker */}
      <div className="absolute" style={{
        ...cellToPct(L.x, L.y), transform: 'translate(-50%, -50%)',
        width: 46, height: 46, border: '2px solid #ff5a4a', borderRadius: '50%',
        boxShadow: '0 0 12px rgba(255,90,74,0.5)', pointerEvents: 'none',
      }} />
      <div className="absolute text-[10px] font-mono" style={{
        ...cellToPct(L.x, L.y), transform: 'translate(-50%, 30px)',
        color: '#ffb0a0', textShadow: '0 0 4px #000', pointerEvents: 'none',
      }}>
        LEIPALINGIS ⚑
      </div>

      {/* Deployment markers */}
      {towns.map(t => {
        const a = LEIPALINGIS_ANCHORS[TOWN_KEY[t.id]];
        const active = t.id === selected;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="absolute font-mono"
            style={{
              ...cellToPct(a.x, a.y), transform: 'translate(-50%, -50%)',
              width: active ? 28 : 20, height: active ? 28 : 20,
              border: `2px solid ${active ? '#e0eac8' : '#8adc7a'}`,
              background: active ? 'rgba(120,180,80,0.85)' : 'rgba(20,40,20,0.7)',
              color: '#0d1110', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', borderRadius: 4,
              boxShadow: active ? '0 0 14px rgba(165,207,111,0.7)' : '0 0 6px rgba(0,0,0,0.5)',
            }}
            title={t.name}
          >
            {t.name.charAt(0)}
          </button>
        );
      })}
      {towns.map(t => {
        const a = LEIPALINGIS_ANCHORS[TOWN_KEY[t.id]];
        return (
          <div key={t.id + '-lbl'} className="absolute text-[10px] font-mono pointer-events-none" style={{
            ...cellToPct(a.x, a.y), transform: 'translate(-50%, 18px)',
            color: '#d0e0a8', textShadow: '0 0 3px #000',
          }}>
            {t.name}
          </div>
        );
      })}

      {/* Compass */}
      <div className="absolute top-2 right-2 font-mono text-[10px] text-center" style={{ color: '#a5cf6f' }}>
        <div>N</div><div style={{ opacity: 0.6 }}>↑</div>
      </div>
      <div className="absolute bottom-2 left-2 font-mono text-[10px]" style={{ color: '#8a9a7a' }}>
        Scale: {(MAP_COLS * 32 / 1000).toFixed(1)} × {(MAP_ROWS * 32 / 1000).toFixed(1)} km
      </div>
    </div>
  );
}

const DeploymentScreen: React.FC<Props> = ({ mission, onStart, onBack }) => {
  const towns: DeploymentTown[] = mission.deploymentTowns ?? [];
  const [town, setTown] = useState<DeploymentTownId>(towns[0]?.id ?? 'jovaisiai');
  const [comp, setComp] = useState(mission.defaultComposition ?? { infantry: 8, tank: 2, apc: 2 });
  const chosen = towns.find(t => t.id === town);

  const adj = (k: 'infantry' | 'tank' | 'apc', d: number) => {
    setComp(c => ({ ...c, [k]: Math.max(0, Math.min(k === 'infantry' ? 14 : 4, c[k] + d)) }));
  };

  return (
    <div className="absolute inset-0 font-mono overflow-auto"
      style={{ background: 'linear-gradient(180deg, #0d1110 0%, #171f19 100%)', color: '#c0d0b0' }}>
      <div className="max-w-[1400px] mx-auto p-6">
        <div className="flex items-baseline justify-between mb-2">
          <h1 className="text-2xl" style={{ color: '#a5cf6f' }}>DEPLOYMENT — RECAPTURE LEIPALINGIS</h1>
          <button onClick={onBack} className="px-3 py-1 border text-xs"
            style={{ background: 'rgba(60,40,40,0.7)', borderColor: '#7a5a5a', color: '#e0a0a0' }}>
            ← Briefing
          </button>
        </div>
        <div className="text-xs mb-4" style={{ color: '#7a8a6a' }}>
          Select a staging village on the tactical map. Each axis of advance offers a different route, terrain and risk profile.
        </div>

        <div className="grid grid-cols-[1fr_360px] gap-5">
          {/* Left: tactical map + town list */}
          <div className="space-y-4">
            <TacticalMap towns={towns} selected={town} onSelect={setTown} />
            <div className="grid grid-cols-2 gap-2">
              {towns.map(t => {
                const active = t.id === town;
                return (
                  <button key={t.id} onClick={() => setTown(t.id)}
                    className="text-left p-2 border transition-colors"
                    style={{
                      background: active ? 'rgba(50,80,50,0.8)' : 'rgba(20,30,20,0.75)',
                      borderColor: active ? '#a5cf6f' : '#3a4a3a',
                    }}>
                    <div className="flex items-baseline justify-between">
                      <div className="text-sm" style={{ color: '#e0eac8' }}>{t.name}</div>
                      <div className="text-[10px] flex gap-2">
                        <span style={{ color: '#a5cf6f' }}>{t.distanceKm} km</span>
                        <span style={{ color: riskColor[t.risk] }}>{t.risk}</span>
                      </div>
                    </div>
                    <div className="text-[10px] mt-1" style={{ color: '#8a9a7a' }}>{t.approach}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: chosen briefing + composition + start */}
          <div className="space-y-3">
            <div className="p-4 border" style={{ background: 'rgba(20,30,20,0.85)', borderColor: '#3a4a3a' }}>
              <div className="text-xs mb-1" style={{ color: '#a5cf6f' }}>SELECTED AXIS</div>
              <div className="text-lg" style={{ color: '#e0eac8' }}>{chosen?.name ?? '—'}</div>
              <div className="text-[11px] mt-1" style={{ color: '#8a9a7a' }}>{chosen?.approach}</div>
              <div className="text-[11px] mt-1" style={{ color: '#6a7a6a' }}>Terrain: {chosen?.terrainNote}</div>
              <div className="text-[11px] mt-1" style={{ color: '#a5cf6f' }}>Advantage: {chosen?.advantage}</div>
              <div className="text-[11px] mt-1 flex gap-3">
                <span style={{ color: '#a5cf6f' }}>{chosen?.distanceKm} km to objective</span>
                <span style={{ color: chosen ? riskColor[chosen.risk] : '#888' }}>risk: {chosen?.risk}</span>
              </div>
            </div>

            <div className="p-4 border" style={{ background: 'rgba(20,30,20,0.85)', borderColor: '#3a4a3a' }}>
              <div className="text-sm mb-2" style={{ color: '#a5cf6f' }}>FORCE COMPOSITION</div>
              {(['infantry', 'tank', 'apc'] as const).map(k => (
                <div key={k} className="flex items-center justify-between py-1 text-xs">
                  <span className="capitalize">{k}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => adj(k, -1)} className="px-2 border" style={{ borderColor: '#5a6a5a', background: 'rgba(40,50,40,0.8)' }}>−</button>
                    <span style={{ color: '#d4c47a', minWidth: 20, textAlign: 'center' }}>{comp[k]}</span>
                    <button onClick={() => adj(k, +1)} className="px-2 border" style={{ borderColor: '#5a6a5a', background: 'rgba(40,50,40,0.8)' }}>+</button>
                  </div>
                </div>
              ))}
              <div className="text-[10px] mt-2" style={{ color: '#7a8a6a' }}>
                Combined-arms bonus applies when infantry, tanks and APC operate within 90 m of each other.
              </div>
            </div>

            <button
              onClick={() => onStart({ town, composition: comp })}
              className="w-full py-2 border text-sm"
              style={{ background: 'rgba(60,90,50,0.9)', borderColor: '#a5cf6f', color: '#e8f0c8' }}>
              DEPLOY & BEGIN
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeploymentScreen;
