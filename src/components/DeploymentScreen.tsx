import React, { useState } from 'react';
import { MissionDef, DeploymentTownId, DeploymentContext, DeploymentTown } from '../game/types';

interface Props {
  mission: MissionDef;
  onStart: (ctx: DeploymentContext) => void;
  onBack: () => void;
}

const riskColor: Record<'low' | 'med' | 'high', string> = {
  low: '#8adc7a', med: '#e4c46a', high: '#e07a5a',
};

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
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-baseline justify-between mb-2">
          <h1 className="text-2xl" style={{ color: '#a5cf6f' }}>DEPLOYMENT — SILVER BIRCH</h1>
          <button onClick={onBack} className="px-3 py-1 border text-xs"
            style={{ background: 'rgba(60,40,40,0.7)', borderColor: '#7a5a5a', color: '#e0a0a0' }}>
            ← Briefing
          </button>
        </div>
        <div className="text-xs mb-5" style={{ color: '#7a8a6a' }}>
          Choose your staging village and force composition. Each axis offers a different route, terrain and risk.
        </div>

        <div className="grid grid-cols-[1fr_320px] gap-5">
          {/* Left: town list */}
          <div className="space-y-2">
            {towns.map(t => {
              const active = t.id === town;
              return (
                <button key={t.id} onClick={() => setTown(t.id)}
                  className="w-full text-left p-3 border transition-colors"
                  style={{
                    background: active ? 'rgba(50,80,50,0.8)' : 'rgba(20,30,20,0.75)',
                    borderColor: active ? '#a5cf6f' : '#3a4a3a',
                  }}>
                  <div className="flex items-baseline justify-between">
                    <div className="text-base" style={{ color: '#e0eac8' }}>{t.name}</div>
                    <div className="text-xs flex gap-3">
                      <span style={{ color: '#a5cf6f' }}>{t.distanceKm} km to Leipalingis</span>
                      <span style={{ color: riskColor[t.risk] }}>risk: {t.risk}</span>
                    </div>
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: '#8a9a7a' }}>{t.approach}</div>
                  <div className="text-[11px] mt-1" style={{ color: '#6a7a6a' }}>Terrain: {t.terrainNote}</div>
                  <div className="text-[11px] mt-1" style={{ color: '#a5cf6f' }}>Advantage: {t.advantage}</div>
                </button>
              );
            })}
          </div>

          {/* Right: composition + start */}
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
              Combined-arms bonus applies when infantry, tanks and APC operate within 90m of each other.
            </div>

            <div className="mt-4 pt-3" style={{ borderTop: '1px solid #3a4a3a' }}>
              <div className="text-xs mb-1" style={{ color: '#a5cf6f' }}>SELECTED AXIS</div>
              <div className="text-sm" style={{ color: '#e0eac8' }}>{chosen?.name ?? '—'}</div>
              <div className="text-[11px]" style={{ color: '#8a9a7a' }}>{chosen?.approach}</div>
            </div>

            <button
              onClick={() => onStart({ town, composition: comp })}
              className="mt-5 w-full py-2 border text-sm"
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
