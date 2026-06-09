// ============================================================
// Tactical scoring API (Stage 2, read-only)
// ------------------------------------------------------------
// A unified surface other systems (AI, debug overlay, future
// squad brain) can query without duplicating cell-by-cell math.
//
// Everything here is pure: it reads GameState / terrain and
// returns numbers or positions. No mutation.
// ============================================================

import { GameState, Position, TerrainCell, Team, Unit } from './types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from './constants';
import { hasLineOfSight, isPassable } from './terrain';

/** Combined "how protected from incoming fire is this cell" in 0..1. */
export function cellCoverScore(cell: TerrainCell): number {
  // coverBonus is the dominant factor; concealment helps a bit.
  return Math.min(1, cell.coverBonus + cell.concealment * 0.4);
}

/** "How hard to spot something here" in 0..1. */
export function cellConcealmentScore(cell: TerrainCell): number {
  return Math.min(1, cell.concealment + cell.coverBonus * 0.25);
}

/** Mobility friendliness 0..1 (1 = fastest). */
export function cellMobilityScore(cell: TerrainCell): number {
  if (cell.blocksMovement) return 0;
  // movementCost typical range ~0.6..2.6
  return Math.max(0, Math.min(1, 1.4 - cell.movementCost * 0.5));
}

/**
 * Tactical score for a unit *standing* in this cell.
 * Higher = better defensive / firing position.
 * Pure heuristic; safe to call per-frame at low resolution.
 */
export function cellTacticalScore(
  cell: TerrainCell,
  opts: { elevationWeight?: number } = {},
): number {
  const cover = cellCoverScore(cell);
  const conceal = cellConcealmentScore(cell);
  const mobility = cellMobilityScore(cell);
  const elev = (cell.elevation - 1) * (opts.elevationWeight ?? 0.15);
  // Trenches / sandbags / walls dominate; open ground scores near 0.
  return Math.max(0, cover * 0.6 + conceal * 0.25 + mobility * 0.1 + elev);
}

export type DebugLayer = 'cover' | 'concealment' | 'tactical' | 'mobility';

/** Sample the chosen scalar field for every cell. Used by the debug overlay. */
export function sampleField(
  state: GameState,
  layer: DebugLayer,
): Float32Array {
  const out = new Float32Array(MAP_COLS * MAP_ROWS);
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const c = state.terrain[y][x];
      let v = 0;
      switch (layer) {
        case 'cover': v = cellCoverScore(c); break;
        case 'concealment': v = cellConcealmentScore(c); break;
        case 'tactical': v = cellTacticalScore(c); break;
        case 'mobility': v = cellMobilityScore(c); break;
      }
      out[y * MAP_COLS + x] = v;
    }
  }
  return out;
}

/** Best tactical cell within `radius` cells of `from`, optionally requiring LOS to `losTo`. */
export function findBestTacticalCell(
  state: GameState,
  from: Position,
  opts: {
    radius?: number;
    isVehicle?: boolean;
    isHelicopter?: boolean;
    losTo?: Position | null;
    minScore?: number;
  } = {},
): Position | null {
  const radius = opts.radius ?? 6;
  const minScore = opts.minScore ?? 0.2;
  const gx = Math.floor(from.x / CELL_SIZE);
  const gy = Math.floor(from.y / CELL_SIZE);
  let best: { score: number; pos: Position } | null = null;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = gx + dx, ty = gy + dy;
      if (tx < 0 || tx >= MAP_COLS || ty < 0 || ty >= MAP_ROWS) continue;
      const cell = state.terrain[ty][tx];
      if (!isPassable(cell, !!opts.isVehicle, !!opts.isHelicopter)) continue;
      const s = cellTacticalScore(cell);
      if (s < minScore) continue;
      const cx = tx * CELL_SIZE + CELL_SIZE / 2;
      const cy = ty * CELL_SIZE + CELL_SIZE / 2;
      if (opts.losTo) {
        if (!hasLineOfSight(state.terrain, cx, cy, opts.losTo.x, opts.losTo.y, !!opts.isHelicopter)) continue;
      }
      const distPenalty = Math.hypot(dx, dy) * 0.04;
      const score = s - distPenalty;
      if (!best || score > best.score) best = { score, pos: { x: cx, y: cy } };
    }
  }
  return best?.pos ?? null;
}

/** Quick "is this position currently in cover?" used by HUD/AI. */
export function isInCover(state: GameState, pos: Position, threshold = 0.25): boolean {
  const gx = Math.floor(pos.x / CELL_SIZE);
  const gy = Math.floor(pos.y / CELL_SIZE);
  if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) return false;
  return cellCoverScore(state.terrain[gy][gx]) >= threshold;
}

/** Effective exposure of `unit` to enemy `from` (lower = safer). 0..1. */
export function exposureTo(state: GameState, unit: Unit, from: Position): number {
  const cell = state.terrain[Math.floor(unit.pos.y / CELL_SIZE)]?.[Math.floor(unit.pos.x / CELL_SIZE)];
  if (!cell) return 1;
  const cover = cellCoverScore(cell);
  const prone = unit.prone ? 0.25 : 0;
  return Math.max(0, 1 - cover - prone);
}

/** Map a 0..1 score to an RGB triple for debug overlays (blue→green→yellow→red). */
export function scoreToColor(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  // 4-stop gradient
  if (t < 0.33) {
    const k = t / 0.33;
    return [0.15 + k * 0.0, 0.35 + k * 0.45, 0.7 - k * 0.4];
  } else if (t < 0.66) {
    const k = (t - 0.33) / 0.33;
    return [0.15 + k * 0.75, 0.8, 0.3 - k * 0.2];
  } else {
    const k = (t - 0.66) / 0.34;
    return [0.9, 0.8 - k * 0.6, 0.1];
  }
}

export const _ignored = (s: GameState, t: Team) => s.units.length + (t === 'player' ? 0 : 0);
