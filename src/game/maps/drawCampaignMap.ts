import { TerrainCell } from '../types';
import { MAP_COLS, MAP_ROWS } from '../constants';
import { LEIPALINGIS_ROADS } from './leipalingis';
import { SETTLEMENTS } from './settlements';
import { paintRoadNetwork } from './roadSurface';

const COLORS: Record<string, string> = { open: '#62724a', forest: '#2e4935', water: '#325a70', tall_grass: '#77824e',
  urban: '#d3c3a2', gravel: '#9a9178', road: '#485151', trench: '#5c523b', hedgerow: '#435c37', sandbag: '#a79875', mud: '#6d654c', crater: '#655842' };
/** Identical geography, road widths and town extents in deployment and play. */
export function drawCampaignMap(ctx: CanvasRenderingContext2D, terrain: TerrainCell[][], width: number, height: number, labels = false) {
  ctx.save(); ctx.setTransform(width / MAP_COLS, 0, 0, height / MAP_ROWS, 0, 0);
  ctx.fillStyle = COLORS.open; ctx.fillRect(0, 0, MAP_COLS, MAP_ROWS);
  terrain.forEach((row, y) => row.forEach((c, x) => {
    ctx.fillStyle = COLORS[c.roadName ? 'open' : c.type] ?? COLORS.open;
    ctx.fillRect(x, y, 1, 1);
  }));
  for (const town of SETTLEMENTS) {
    ctx.beginPath(); ctx.ellipse(town.x, town.y, town.rx, town.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d3bb7723'; ctx.fill();
    ctx.strokeStyle = '#d5be83'; ctx.lineWidth = .22; ctx.setLineDash([.8, .65]); ctx.stroke();
  }
  ctx.setLineDash([]); paintRoadNetwork(ctx, LEIPALINGIS_ROADS);
  // Buildings stay distinct from roads even at tactical-map scale.
  terrain.forEach((row, y) => row.forEach((c, x) => {
    if (c.type !== 'urban') return;
    ctx.fillStyle = c.buildingKind === 'church' ? '#fae6a7' : '#e2d1ad';
    ctx.fillRect(x + .14, y + .14, .72, .72);
  }));
  if (labels) {
    ctx.font = '4px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const town of SETTLEMENTS) {
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#17271c'; ctx.strokeText(town.name, town.x, town.y - town.ry - 1);
      ctx.fillStyle = '#f2e9cc'; ctx.fillText(town.name, town.x, town.y - town.ry - 1);
    }
  }
  ctx.restore();
}
