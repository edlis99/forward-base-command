import { describe, expect, it } from 'vitest';
import { generateTerrain, hasLineOfSight } from '../game/terrain';
import { findPath } from '../game/pathfinding';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { LEIPALINGIS_ROADS, PLAYABLE_CELLS, MAIN_CELLS } from '../game/maps/leipalingis';
import { SETTLEMENTS } from '../game/maps/settlements';
import { RAAS_CHAINS, RAAS_MAINS, makeLeipalingisRaas } from '../game/maps/raasLeipalingis';
import { geography } from '../game/maps/geography';
import { createMatch, stepMatch, TICK_RATE } from '../game/match';
import { Position, TerrainCell } from '../game/types';

const terrain = generateTerrain('leipalingis_region', 1917);
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
/** Travel time (movement-cost weighted cells) along the path a unit would take. */
function travel(from: Position, to: Position, type: 'infantry' | 'tank' = 'infantry') {
  const path = findPath(terrain, from, to, type);
  if (!path.length) return Infinity;
  let s = 0, p = from;
  for (const q of path) { s += Math.hypot(q.x - p.x, q.y - p.y) / CELL_SIZE * (terrain[Math.floor(q.y / CELL_SIZE)][Math.floor(q.x / CELL_SIZE)].movementCost || 1); p = q; }
  return s;
}
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b);
const town = (id: string) => { const s = SETTLEMENTS.find(t => t.id === id)!; return { x: (s.x + .5) * CELL_SIZE, y: (s.y + .5) * CELL_SIZE }; };
const MAIN_ROADS = ['primary', 'secondary', 'tertiary', 'unclassified', 'primary_link', 'secondary_link'];

describe('Leipalingis map: roads', () => {
  const ends = LEIPALINGIS_ROADS.flatMap((road, i) => [road.points[0], road.points[road.points.length - 1]].map(e => ({ road, e, i })));
  const [px0, py0, px1, py1] = PLAYABLE_CELLS;
  const inPlay = (e: Pt) => e[0] > px0 && e[1] > py0 && e[0] < px1 && e[1] < py1; // scenery border roads may end anywhere
  const loose = ends.filter(({ e, i }) => inPlay(e) &&
    !LEIPALINGIS_ROADS.some((other, j) => j !== i && distToRoad(e, other.points) < .6));
  it('never lets a main road stop in the middle of nowhere', () => {
    expect(loose.filter(l => MAIN_ROADS.includes(l.road.class)).map(l => `${l.road.name || l.road.class} @ ${l.e.map(Math.round)}`)).toEqual([]);
  });
  it('keeps dead ends to the farm and forest tracks and cul-de-sacs real countryside has', () => {
    expect(loose.length / ends.length).toBeLessThan(.15);
  });
  it('forms one network: every other road piece leaves the map', () => {
    const parent = LEIPALINGIS_ROADS.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    LEIPALINGIS_ROADS.forEach((a, i) => LEIPALINGIS_ROADS.forEach((b, j) => {
      if (j <= i || Math.abs(a.points[0][0] - b.points[0][0]) > 200) return;
      if (a.points.some(p => distToRoad(p, b.points) < .7) || b.points.some(p => distToRoad(p, a.points) < .7)) parent[find(i)] = find(j);
    }));
    const size = new Map<number, number>();
    LEIPALINGIS_ROADS.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
    const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const atEdge = (i: number) => LEIPALINGIS_ROADS[i].points.some(p => p[0] <= 1 || p[1] <= 1 || p[0] >= MAP_COLS - 1 || p[1] >= MAP_ROWS - 1);
    // A farm track cut by the river continues across it through a ford.
    const atFord = (i: number) => LEIPALINGIS_ROADS[i].points.some(p => geography.fords.some(f => Math.hypot(p[0] - f[0], p[1] - f[1]) < 6));
    const strays = LEIPALINGIS_ROADS.map((_, i) => i).filter(i => find(i) !== main &&
      !LEIPALINGIS_ROADS.some((_, j) => find(j) === find(i) && (atEdge(j) || atFord(j))));
    expect(strays).toEqual([]);
  }, 60000);
  it('gives every settlement at least two roads in', () => {
    for (const s of SETTLEMENTS) {
      const entering = LEIPALINGIS_ROADS.filter(r => r.points.some(p => ((p[0] - s.x) / s.rx) ** 2 + ((p[1] - s.y) / s.ry) ** 2 <= 1));
      expect(entering.length, s.name).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Leipalingis map: fairness by measurement (not mirrored)', () => {
  it('puts both mains at the same travel time from Leipalingis and Seirijai', () => {
    for (const id of ['leipalingis', 'seirijai']) {
      expect(rel(travel(RAAS_MAINS.player, town(id)), travel(RAAS_MAINS.enemy, town(id))), id).toBeLessThan(.06);
    }
    expect(rel(travel(RAAS_MAINS.player, town('leipalingis'), 'tank'), travel(RAAS_MAINS.enemy, town('leipalingis'), 'tank'))).toBeLessThan(.06);
  }, 60000);
  it('only uses lanes whose matching objectives are equally far from each side', () => {
    expect(RAAS_CHAINS.length).toBeGreaterThanOrEqual(10);
    const cache = new Map<string, number>();
    const T = (side: 'player' | 'enemy', p: Position) => {
      const k = `${side}:${p.x}:${p.y}`;
      if (!cache.has(k)) cache.set(k, travel(RAAS_MAINS[side], p));
      return cache.get(k)!;
    };
    for (const c of RAAS_CHAINS) {
      const [w1, w2, mid, e2, e1] = c.objectives.map(o => o.pos);
      expect(rel(T('player', w1), T('enemy', e1)), `${c.name} first`).toBeLessThan(.18);
      expect(rel(T('player', w2), T('enemy', e2)), `${c.name} second`).toBeLessThan(.18);
      expect(rel(T('player', mid), T('enemy', mid)), `${c.name} middle`).toBeLessThan(.12);
      expect(T('player', w1)).toBeLessThan(T('enemy', w1)); // each side's points lie on its own side
      expect(T('enemy', e1)).toBeLessThan(T('player', e1));
    }
  }, 120000);
  it('lets tanks reach every objective from their own main', () => {
    for (const c of RAAS_CHAINS) for (const o of c.objectives) {
      expect(findPath(terrain, RAAS_MAINS.player, o.pos, 'tank').length, o.name).toBeGreaterThan(0);
      expect(findPath(terrain, RAAS_MAINS.enemy, o.pos, 'tank').length, o.name).toBeGreaterThan(0);
    }
  }, 120000);
  it('shares the high ground fairly between the west and east halves', () => {
    const land = terrain.flat().filter(c => c.type !== 'water' && !c.blocksMovement);
    const avg = (cells: TerrainCell[]) => cells.reduce((s, c) => s + c.elevation, 0) / cells.length;
    expect(rel(avg(land.filter(c => c.x / CELL_SIZE < MAP_COLS / 2)), avg(land.filter(c => c.x / CELL_SIZE >= MAP_COLS / 2)))).toBeLessThan(.1);
  });
});

describe('Leipalingis map: terrain that changes the fight', () => {
  it('has rolling hills', () => {
    const e = terrain.flat().filter(c => c.type !== 'water').map(c => c.elevation);
    expect(e.reduce((a, b) => Math.max(a, b)) - e.reduce((a, b) => Math.min(a, b))).toBeGreaterThan(1.5);
  });
  it('lets a ridge hide troops behind it', () => {
    const y = 160, x0 = 100, x1 = 116;
    const saved = terrain[y].slice(x0, x1 + 1).map(c => c.elevation);
    terrain[y].slice(x0, x1 + 1).forEach(c => { c.elevation = 1; });
    const a = { x: (x0 + .5) * CELL_SIZE, y: (y + .5) * CELL_SIZE }, b = { x: (x1 + .5) * CELL_SIZE, y: (y + .5) * CELL_SIZE };
    const clear = hasLineOfSight(terrain, a.x, a.y, b.x, b.y);
    terrain[y][x0 + 8].elevation = 2;
    const blocked = !hasLineOfSight(terrain, a.x, a.y, b.x, b.y);
    terrain[y].slice(x0, x1 + 1).forEach((c, i) => { c.elevation = saved[i]; });
    expect(clear).toBe(true);
    expect(blocked).toBe(true);
  });
  it('has a river crossed by several bridges and a few fords', () => {
    const river = geography.streams[0];
    const crossings = LEIPALINGIS_ROADS.filter(r => r.class !== 'track' && r.points.some(p => river.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 2.5)));
    expect(crossings.length).toBeGreaterThanOrEqual(4);
    expect(geography.fords.length).toBeGreaterThanOrEqual(4);
    expect(terrain.flat().filter(c => c.type === 'water').length).toBeGreaterThan(3000);
  });
  it('makes wood edges the best natural fighting positions', () => {
    const forest = terrain.flat().filter(c => c.type === 'forest');
    expect(forest.length / (MAP_COLS * MAP_ROWS)).toBeGreaterThan(.18);
    const edge = forest.filter(c => c.coverBonus >= .38), deep = forest.filter(c => c.coverBonus < .38);
    expect(edge.length).toBeGreaterThan(1000);
    expect(edge[0].concealment).toBeGreaterThan(deep[0].concealment);
  });
  it('lines fields with hedgerows and scatters farmsteads in the countryside', () => {
    expect(terrain.flat().filter(c => c.type === 'hedgerow').length).toBeGreaterThan(1000);
    expect(terrain.flat().filter(c => c.type === 'urban' && !c.settlementId).length).toBeGreaterThan(300);
  });
  it('mixes building types: blocks and brick in the towns, wooden houses and barns elsewhere', () => {
    const kinds = new Set(terrain.flat().filter(c => c.type === 'urban').map(c => c.buildingKind));
    for (const k of ['house', 'brick', 'block', 'barn', 'workshop', 'church']) expect(kinds.has(k as TerrainCell['buildingKind'])).toBe(true);
  });
});

describe('Leipalingis map: house placement', () => {
  const urban = terrain.flat().filter(c => c.type === 'urban');
  const at = (c: TerrainCell, dx: number, dy: number) => terrain[Math.floor(c.y / CELL_SIZE) + dy]?.[Math.floor(c.x / CELL_SIZE) + dx];
  const ring = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => [dx, dy])).filter(([dx, dy]) => dx || dy);
  const size = (c: TerrainCell) => SETTLEMENTS.find(s => s.id === c.settlementId)?.size;
  it('never puts a house on the shore', () => {
    expect(urban.filter(c => ring.some(([dx, dy]) => at(c, dx, dy)?.type === 'water')).length).toBe(0);
  });
  it('keeps a garden cell between houses in villages, hamlets and farmsteads', () => {
    const spaced = urban.filter(c => !size(c) || size(c) === 'village' || size(c) === 'hamlet');
    // A farm at the edge of a town may touch the town's last house at a corner; nothing else.
    const townHouse = (n?: TerrainCell) => !!n && n.type === 'urban' && (size(n) === 'town' || size(n) === 'centre');
    expect(spaced.filter(c => ring.some(([dx, dy]) => at(c, dx, dy)?.type === 'urban' && !(townHouse(at(c, dx, dy)) && dx && dy))).length).toBe(0);
  });
  it('lets town houses touch only at the corners', () => {
    const towns = urban.filter(c => size(c) === 'town');
    expect(towns.filter(c => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(c, dx, dy)?.type === 'urban')).length).toBe(0);
  });
});

describe('Leipalingis map: board edge and settlements', () => {
  it('keeps units inside the playable area and the mains inside it', () => {
    const [x0, y0, x1, y1] = PLAYABLE_CELLS;
    for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
      if (!(x >= x0 && x < x1 && y >= y0 && y < y1)) expect(terrain[y][x].blocksMovement).toBe(true);
    }
    for (const m of [MAIN_CELLS.north, MAIN_CELLS.south]) expect(terrain[Math.floor(m[1])][Math.floor(m[0])].blocksMovement).toBe(false);
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
  it('has two large towns to fight over', () => {
    const big = SETTLEMENTS.filter(s => s.size === 'centre').map(s => s.name);
    expect(big).toEqual(['Leipalingis', 'Seirijai']);
  });
});

describe('RAAS on the Leipalingis map', () => {
  it('runs an AI-versus-AI match: both sides move on their objectives', () => {
    const m = createMatch(makeLeipalingisRaas(5), { seed: 5, controllers: { player: 'ai', enemy: 'ai' } });
    const start = m.state.units.map(u => ({ ...u.pos }));
    for (let i = 0; i < 90 * TICK_RATE && !m.state.gameOver; i++) stepMatch(m);
    const moved = m.state.units.filter((u, i) => i < start.length && Math.hypot(u.pos.x - start[i].x, u.pos.y - start[i].y) > 6 * CELL_SIZE);
    expect(moved.some(u => u.team === 'player')).toBe(true);
    expect(moved.some(u => u.team === 'enemy')).toBe(true);
  }, 60000);
});
