import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../game/terrain';
import { findPath } from '../game/pathfinding';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { LEIPALINGIS_ROADS, PLAYABLE_CELLS, MAIN_CELLS } from '../game/maps/leipalingis';
import { SETTLEMENTS } from '../game/maps/settlements';
import { RAAS_CHAINS, RAAS_MAINS, makeLeipalingisRaas } from '../game/maps/raasLeipalingis';
import { createMatch, stepMatch, TICK_RATE } from '../game/match';
import { Position } from '../game/types';

const terrain = generateTerrain('leipalingis_region', 1917);
const H = MAP_ROWS;
type Pt = number[];
function distToRoad(p: Pt, points: Pt[]) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / L2));
    best = Math.min(best, Math.hypot(ax + vx * t - p[0], ay + vy * t - p[1]));
  }
  return best;
}
const pathLength = (from: Position, path: Position[]) => path.reduce((s, p, i) => s + Math.hypot(p.x - (i ? path[i - 1] : from).x, p.y - (i ? path[i - 1] : from).y), 0);
const mirrorWorld = (p: Position): Position => ({ x: p.x, y: H * CELL_SIZE - p.y });

describe('designed Leipalingis map: roads', () => {
  it('has no loose road ends: every road ends on another road, closes on itself or leaves the map', () => {
    const loose: string[] = [];
    // Farm lanes deliberately end in their farmyard, like a real driveway.
    const atFarmyard = (e: Pt) => terrain.flat().some(c => c.type === 'urban' && !c.settlementId && Math.hypot(c.x / CELL_SIZE + .5 - e[0], c.y / CELL_SIZE + .5 - e[1]) < 4);
    LEIPALINGIS_ROADS.forEach((road, i) => {
      const ends = [road.points[0], road.points[road.points.length - 1]];
      if (Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) < .01) return; // ring street
      for (const e of ends) {
        const atEdge = e[0] <= .01 || e[1] <= .01 || e[0] >= MAP_COLS - .01 || e[1] >= MAP_ROWS - .01;
        const onRoad = LEIPALINGIS_ROADS.some((other, j) => j !== i && distToRoad(e, other.points) < .6);
        if (!atEdge && !onRoad && !(road.name === 'Sodybos keliukas' && atFarmyard(e))) loose.push(`${road.name} @ ${e.map(Math.round)}`);
      }
    });
    expect(loose).toEqual([]);
  });
  it('forms one connected road network', () => {
    const parent = LEIPALINGIS_ROADS.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    LEIPALINGIS_ROADS.forEach((a, i) => LEIPALINGIS_ROADS.forEach((b, j) => {
      if (j <= i) return;
      const touch = a.points.some(p => distToRoad(p, b.points) < .7) || b.points.some(p => distToRoad(p, a.points) < .7);
      if (touch) parent[find(i)] = find(j);
    }));
    expect(new Set(LEIPALINGIS_ROADS.map((_, i) => find(i))).size).toBe(1);
  });
  it('gives every settlement at least two separate roads in', () => {
    for (const s of SETTLEMENTS) {
      // Back lanes inside a village do not count as separate ways in.
      const entering = LEIPALINGIS_ROADS.filter(r => !r.name.endsWith('galas') &&
        r.points.some(p => ((p[0] - s.x) / s.rx) ** 2 + ((p[1] - s.y) / s.ry) ** 2 <= 1));
      expect(entering.length, s.name).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('designed Leipalingis map: fairness', () => {
  it('pairs every settlement with a mirror twin of the same size', () => {
    for (const s of SETTLEMENTS) {
      const twin = SETTLEMENTS.find(t => Math.abs(t.x - s.x) <= 1 && Math.abs(t.y - (H - s.y)) <= 1);
      expect(twin, s.name).toBeDefined();
      expect(twin!.size).toBe(s.size);
      const count = (id: string) => terrain.flat().filter(c => c.type === 'urban' && c.settlementId === id).length;
      expect(Math.abs(count(s.id) - count(twin!.id)) / Math.max(1, count(s.id)), s.name).toBeLessThan(.12);
    }
  });
  it('makes every RAAS chain a mirror image of itself', () => {
    for (const c of RAAS_CHAINS) {
      const o = c.objectives;
      for (let i = 0; i < o.length; i++) {
        const m = mirrorWorld(o[o.length - 1 - i].pos);
        expect(Math.hypot(o[i].pos.x - m.x, o[i].pos.y - m.y), `${c.name} #${i}`).toBeLessThan(CELL_SIZE * 1.5);
      }
    }
  });
  it('lets both sides reach every objective, over routes of near-equal length', () => {
    const seen = new Map<string, Position>();
    for (const c of RAAS_CHAINS) for (const o of c.objectives) seen.set(o.id, o.pos);
    for (const type of ['infantry', 'tank'] as const) for (const [id, pos] of seen) {
      const north = findPath(terrain, RAAS_MAINS.player, pos, type);
      const south = findPath(terrain, RAAS_MAINS.enemy, mirrorWorld(pos), type);
      expect(north.length, `${type} north -> ${id}`).toBeGreaterThan(0);
      expect(south.length, `${type} south -> ${id}`).toBeGreaterThan(0);
      const a = pathLength(RAAS_MAINS.player, north), b = pathLength(RAAS_MAINS.enemy, south);
      expect(Math.abs(a - b) / Math.max(a, b), `${type} ${id}`).toBeLessThan(.05);
    }
  }, 60000);
});

describe('designed Leipalingis map: countryside', () => {
  it('has streams that only roads (bridges) and fords cross, mirrored on both sides', () => {
    const water = terrain.flat().filter(c => c.type === 'water');
    const mud = terrain.flat().filter(c => c.type === 'mud');
    expect(water.length).toBeGreaterThan(800);
    expect(mud.length).toBeGreaterThan(40);
    const northWater = water.filter(c => c.y / CELL_SIZE < H / 2).length, southWater = water.length - northWater;
    expect(Math.abs(northWater - southWater) / water.length).toBeLessThan(.1);
  });
  it('lines the fields with hedgerows that leave gaps, and keeps them off roads', () => {
    const hedges = terrain.flat().filter(c => c.type === 'hedgerow');
    expect(hedges.length).toBeGreaterThan(2000);
    expect(hedges.every(c => !c.roadName)).toBe(true);
  });
  it('scatters farmsteads in the countryside', () => {
    const farm = terrain.flat().filter(c => c.type === 'urban' && !c.settlementId);
    expect(farm.length).toBeGreaterThan(60);
  });
});

describe('designed Leipalingis map: board edge and woods', () => {
  it('keeps units inside the playable area and the mains inside it', () => {
    const [x0, y0, x1, y1] = PLAYABLE_CELLS;
    for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (!inside) expect(terrain[y][x].blocksMovement).toBe(true);
    }
    for (const m of [MAIN_CELLS.north, MAIN_CELLS.south]) {
      expect(m[0] > x0 && m[0] < x1 && m[1] > y0 && m[1] < y1).toBe(true);
      expect(terrain[Math.floor(m[1])][Math.floor(m[0])].blocksMovement).toBe(false);
    }
  });
  it('keeps woods out of village and town cores', () => {
    for (const s of SETTLEMENTS) {
      let forest = 0, total = 0;
      for (let y = Math.floor(s.y - s.ry / 2); y <= s.y + s.ry / 2; y++) for (let x = Math.floor(s.x - s.rx / 2); x <= s.x + s.rx / 2; x++) {
        total++; if (terrain[y][x].type === 'forest') forest++;
      }
      expect(forest / total, s.name).toBeLessThan(.05);
    }
  });
});

describe('RAAS on the designed map', () => {
  it('runs an AI-versus-AI match: both sides move on their objectives', () => {
    const m = createMatch(makeLeipalingisRaas(5), { seed: 5, controllers: { player: 'ai', enemy: 'ai' } });
    const start = m.state.units.map(u => ({ ...u.pos }));
    for (let i = 0; i < 90 * TICK_RATE && !m.state.gameOver; i++) stepMatch(m);
    const moved = m.state.units.filter((u, i) => Math.hypot(u.pos.x - start[i].x, u.pos.y - start[i].y) > 6 * CELL_SIZE);
    expect(moved.some(u => u.team === 'player')).toBe(true);
    expect(moved.some(u => u.team === 'enemy')).toBe(true);
    expect(m.state.objectives[0].description).toContain('Tickets');
  }, 60000);
});
