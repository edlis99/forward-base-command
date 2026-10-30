import { geography as snapshot, GEOGRAPHIC_SCALE, PLAYABLE_CELLS, MAIN_CELLS, mapHeightAt } from './geography';
export { PLAYABLE_CELLS, MAIN_CELLS };
/** How far (elevation units) a water surface sits below its shore. */
const WATER_BELOW_SHORE = .06;
import { TerrainCell, TerrainType } from '../types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../constants';
import { SETTLEMENTS, settlementAt } from './settlements';

type Point = number[];
export interface MapRoad { class: string; id: number; name: string; ref: string; paved: boolean; width: number; points: Point[]; }
export const MAP_ATTRIBUTION = snapshot.source;
export const MAP_SOURCE_DATE = snapshot.downloaded;

// Clip imported ways at the campaign boundary. Their OSM endpoints can lie
// many kilometres outside the downloaded box. Coordinates are grid units.
function clipSegment(a: Point, b: Point): [Point, Point] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let lo = 0, hi = 1;
  for (const [p, q] of [[-dx, a[0]], [dx, MAP_COLS - a[0]], [-dy, a[1]], [dy, MAP_ROWS - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
    if (lo > hi) return null;
  }
  return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
}

export const LEIPALINGIS_ROADS: MapRoad[] = snapshot.roads.flatMap(road => {
  const sections: Point[][] = [];
  let current: Point[] = [];
  for (let i = 1; i < road.points.length; i++) {
    const segment = clipSegment(road.points[i - 1], road.points[i]);
    if (!segment) { if (current.length > 1) sections.push(current); current = []; continue; }
    if (current.length && Math.hypot(current[current.length - 1][0] - segment[0][0], current[current.length - 1][1] - segment[0][1]) > 0.01) {
      sections.push(current); current = [];
    }
    if (!current.length) current.push(segment[0]);
    current.push(segment[1]);
  }
  if (current.length > 1) sections.push(current);
  // Designed map: real proportions next to the houses (a village street is narrower than a house).
  const width = snapshot.designed
    ? (/primary/.test(road.class) ? .7 : /secondary/.test(road.class) ? .6 : road.class === 'track' ? .26 : road.class === 'residential' ? .42 : .5)
    : /primary|secondary/.test(road.class) ? 1.35 : road.class === 'track' ? .38 : .88;
  return sections.map(points => ({ ...road, width, points }));
});

function place(name: string) {
  const p = snapshot.places.find(p => p.name === name)!;
  return { x: Math.round(p.point[0]), y: Math.round(p.point[1]) };
}
// Seirijai itself is outside this local crop. The fifth staging position is
// explicitly the northern 180 approach, not a fictional placement of the town.
const northRoad = LEIPALINGIS_ROADS.filter(r => r.ref === '180').flatMap(r => r.points)
  .filter(p => p[1] >= 4 * GEOGRAPHIC_SCALE && p[1] < 16 * GEOGRAPHIC_SCALE).sort((a, b) => a[1] - b[1])[0];
export const LEIPALINGIS_ANCHORS = {
  leipalingis: place('Leipalingis'), jovaisiai: place('Jovaišiai'),
  didziasalis: place('Didžiasalis'), versiai: place('Veršiai'), straciunai: place('Stračiūnai'),
  seirijai: { x: Math.round(northRoad?.[0] ?? 97 * GEOGRAPHIC_SCALE), y: Math.round(northRoad?.[1] ?? 8 * GEOGRAPHIC_SCALE) },
};

/** Stage on an actual road outside the town, never clear the centre to spawn. */
export const STAGING_AREAS = Object.fromEntries(
  Object.entries(LEIPALINGIS_ANCHORS).filter(([id]) => id !== 'leipalingis').map(([id, anchor]) => {
    if (id === 'seirijai') return [id, anchor];
    const town = SETTLEMENTS.find(s => s.id === id)!;
    const dx = town.x - LEIPALINGIS_ANCHORS.leipalingis.x, dy = town.y - LEIPALINGIS_ANCHORS.leipalingis.y;
    const length = Math.hypot(dx, dy);
    const desired = [town.x + dx / length * (town.rx + 4), town.y + dy / length * (town.ry + 4)];
    let best = { ...anchor, score: Infinity };
    for (const road of LEIPALINGIS_ROADS.filter(r => r.class !== 'track')) {
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (let j = 0; j <= steps; j++) {
          const x = a[0] + (b[0] - a[0]) * j / steps, y = a[1] + (b[1] - a[1]) * j / steps;
          if (x < 4 || x > MAP_COLS - 5 || y < 4 || y > MAP_ROWS - 5) continue;
          if (SETTLEMENTS.some(s => ((x - s.x) / (s.rx + 3)) ** 2 + ((y - s.y) / (s.ry + 3)) ** 2 < 1)) continue;
          const score = Math.hypot(x - desired[0], y - desired[1]);
          if (score < best.score) best = { x: Math.floor(x), y: Math.floor(y), score };
        }
      }
    }
    return [id, { x: best.x, y: best.y }];
  })
) as Record<Exclude<keyof typeof LEIPALINGIS_ANCHORS, 'leipalingis'>, { x: number; y: number }>;

function inside(x: number, y: number, ring: Point[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

type Setter = (grid: TerrainCell[][], x: number, y: number, type: TerrainType) => void;

/** Real geographic topology; widened roads and representative buildings for play. */
export function buildLeipalingis(grid: TerrainCell[][], rand: () => number, set: Setter) {
  // Fields, forests and water are OSM polygons, not random circular blobs.
  for (const area of [...snapshot.areas].sort((a, b) =>
    ['field', 'forest', 'water'].indexOf(a.kind) - ['field', 'forest', 'water'].indexOf(b.kind))) {
    const minX = Math.max(0, Math.floor(Math.min(...area.points.map(p => p[0]))));
    const maxX = Math.min(MAP_COLS - 1, Math.ceil(Math.max(...area.points.map(p => p[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...area.points.map(p => p[1]))));
    const maxY = Math.min(MAP_ROWS - 1, Math.ceil(Math.max(...area.points.map(p => p[1]))));
    const holes: Point[][] = 'holes' in area ? area.holes : [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (!inside(x + 0.5, y + 0.5, area.points) || holes.some(h => inside(x + 0.5, y + 0.5, h))) continue;
      set(grid, x, y, area.kind === 'field' ? (rand() < 0.24 ? 'tall_grass' : 'open') : area.kind as TerrainType);
    }
  }

  // Designed map: streams (crossed by bridges where roads pass, and by muddy fords).
  const designed = snapshot.designed;
  const paintDisc = (cx: number, cy: number, radius: number, type: TerrainType) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (grid[y]?.[x] && Math.hypot(x + .5 - cx, y + .5 - cy) <= radius) set(grid, x, y, type);
    }
  };
  for (const stream of snapshot.streams) for (let i = 1; i < stream.length; i++) {
    const [a, b] = [stream[i - 1], stream[i]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
    for (let k = 0; k <= n; k++) paintDisc(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, snapshot.streamWidth, 'water');
  }
  for (const [fx, fy] of snapshot.fords) paintDisc(fx, fy, 2.2, 'mud');

  // Road shoulders remain traversable for the calibrated vehicle footprint. Tracks are slower and do not acquire asphalt bonuses.
  const paintSegment = (a: Point, b: Point, radius: number, type: TerrainType, name?: string) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length * 3));
    for (let i = 0; i <= steps; i++) {
      const x = a[0] + (b[0] - a[0]) * i / steps, y = a[1] + (b[1] - a[1]) * i / steps;
      for (let cy = Math.floor(y - radius); cy <= Math.ceil(y + radius); cy++) {
        for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
          if (!grid[cy]?.[cx] || Math.hypot(cx + 0.5 - x, cy + 0.5 - y) > radius + 0.36) continue;
          if (type !== 'road' && grid[cy][cx].type === 'road') continue;
          set(grid, cx, cy, type);
          grid[cy][cx].roadName = name;
        }
      }
    }
  };
  for (const road of LEIPALINGIS_ROADS) for (let i = 1; i < road.points.length; i++) {
    // Widen only vehicular routes. Clearing every forest track as a road
    // shoulder would erase most woodland at this campaign scale.
    if (road.class !== 'track') paintSegment(road.points[i - 1], road.points[i], road.width / 2 + .45, 'open', road.name);
  }
  for (const road of LEIPALINGIS_ROADS) for (let i = 1; i < road.points.length; i++) {
    paintSegment(road.points[i - 1], road.points[i], road.width / 2 + .12, 'gravel', road.name);
  }
  for (const road of LEIPALINGIS_ROADS) for (let i = 1; i < road.points.length; i++) {
    paintSegment(road.points[i - 1], road.points[i], road.width / 2, road.paved ? 'road' : 'gravel', road.name);
  }
  // Irregular meadow patches fill unsurveyed agricultural ground. These are
  // gameplay vegetation, not additional claimed geographic features.
  for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
    const c = grid[y][x];
    if (!designed && c.type === 'open' && !c.roadName && Math.sin(x * .31) + Math.cos(y * .27) + Math.sin((x + y) * .19) > .9) {
      set(grid, x, y, 'tall_grass');
    }
  }

  // Designed map: hedgerows and tree lines along field edges (with gaps to pass through).
  for (const hedge of snapshot.hedges) for (let i = 1; i < hedge.length; i++) {
    const [a, b] = [hedge[i - 1], hedge[i]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(a[0] + (b[0] - a[0]) * k / n), y = Math.floor(a[1] + (b[1] - a[1]) * k / n);
      const c = grid[y]?.[x];
      if (c && !c.roadName && (c.type === 'open' || c.type === 'tall_grass')) set(grid, x, y, 'hedgerow');
    }
  }

  const free = (x: number, y: number) => {
    const c = grid[y]?.[x];
    return c && !c.yard && !c.roadName && (c.type === 'open' || c.type === 'tall_grass');
  };
  const placeProp = (x: number, y: number, prop: NonNullable<TerrainCell['prop']>, angle: number) => {
    if (!free(x, y)) return;
    set(grid, x, y, 'sandbag');
    const cell = grid[y][x];
    cell.prop = prop; cell.propAngle = angle;
    cell.coverBonus = { logs: 0.48, hay: 0.22, stone_wall: 0.62, wreck: 0.58, barricade: 0.52, boulder: 0.45, scrub: 0.08 }[prop];
    cell.concealment = prop === 'scrub' ? 0.5 : prop === 'hay' ? 0.38 : 0.12;
  };

  // Dense named centres and sparse intervening farms: the earlier uniform
  // scatter erased the distinction between a village and the countryside.
  const count: Record<string, number> = {};
  /** Designed map: apartment blocks and brick houses in town centres, wooden houses and barns elsewhere. */
  const designedKind = (town: ReturnType<typeof settlementAt>, x: number, y: number): NonNullable<TerrainCell['buildingKind']> => {
    const r = deterministic(x + 17, y + 41);
    if (!town) return r < .45 ? 'barn' : r < .52 ? 'workshop' : 'house';
    const q = ((x + .5 - town.x) / town.rx) ** 2 + ((y + .5 - town.y) / town.ry) ** 2;
    // Dzūkija villages are mostly timber homes, with a few granaries, barns
    // and brick civic buildings. Apartment blocks belong only in town cores.
    if (town.size === 'centre') return q < .18 && r < .18 ? 'block'
      : q < .58 && r < .57 ? 'brick' : r < .055 ? 'workshop'
      : r < .13 ? 'barn' : 'house';
    if (town.size === 'town') return q < .23 && r < .12 ? 'brick'
      : r < .09 ? 'workshop' : r < .24 ? 'barn' : 'house';
    return r < .21 ? 'barn' : r < .25 ? 'workshop' : 'house';
  };
  const deterministic = (x: number, y: number) => Math.abs(Math.sin(x * 71.17 + y * 31.63) * 43758.5) % 1;
  /** Turn a building so its front (door side) faces the nearest street; footprint angle kept modulo 90°. */
  const faceStreet = (x: number, y: number, angle: number) => {
    let best: [number, number] | null = null, bestD = Infinity;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const n = grid[y + dy]?.[x + dx];
      if (!n || !(n.type === 'road' || n.type === 'gravel') || (dx === 0 && dy === 0)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = [dx, dy]; }
    }
    if (!best) return angle;
    const len = Math.hypot(best[0], best[1]), fx = best[0] / len, fz = best[1] / len;
    // Front is local +z; rotation `a` maps it to (-sin a, cos a). Pick the quarter turn that faces the road.
    let choice = angle, score = -Infinity;
    for (let k = 0; k < 4; k++) {
      const a = angle + k * Math.PI / 2, s = -Math.sin(a) * fx + Math.cos(a) * fz;
      if (s > score) { score = s; choice = a; }
    }
    return choice;
  };
  /** Direction of the road segment nearest to a point (cells), for lining houses up along curved streets. */
  const roadBoxes = LEIPALINGIS_ROADS.map(r => {
    const xs = r.points.map(p => p[0]), ys = r.points.map(p => p[1]);
    return { r, x0: Math.min(...xs) - 3, x1: Math.max(...xs) + 3, y0: Math.min(...ys) - 3, y1: Math.max(...ys) + 3 };
  });
  const localRoadAngle = (px: number, py: number): number | null => {
    let best = 3, angle: number | null = null;
    for (const { r, x0, x1, y0, y1 } of roadBoxes) {
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      for (let i = 1; i < r.points.length; i++) {
        const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i];
        const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
        const d = Math.hypot(ax + vx * t - px, ay + vy * t - py);
        if (d < best) { best = d; angle = Math.atan2(vy, vx); }
      }
    }
    return angle;
  };
  const building = (x: number, y: number, angle: number, offset?: [number, number]) => {
    const town = settlementAt(x + .5, y + .5);
    if (!free(x, y)) return false;
    if (designed && town) {
      // Houses stand on streets: no settlement house more than 2 cells from one.
      let street = false;
      for (let dy = -2; dy <= 2 && !street; dy++) for (let dx = -2; dx <= 2; dx++) {
        const n = grid[y + dy]?.[x + dx];
        if (n && (n.type === 'road' || n.type === 'gravel')) { street = true; break; }
      }
      if (!street) return false;
      // Houses line up with the street they stand on (rows follow curved roads).
      const along = localRoadAngle(x + .5, y + .5);
      if (along !== null) angle = along + (deterministic(x + 2, y + 7) - .5) * .06;
    }
    if (designed) {
      const at = (dx: number, dy: number) => grid[y + dy]?.[x + dx];
      const ring = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => [dx, dy])).filter(([dx, dy]) => dx || dy);
      // No houses on the shore: a cell of bank between any building and water.
      if (ring.some(([dx, dy]) => at(dx, dy)?.type === 'water')) return false;
      // Spacing: villages and farms keep a garden cell between houses; towns
      // may touch only at the corners; only big-town centres are built solid.
      const q = town ? ((x + .5 - town.x) / town.rx) ** 2 + ((y + .5 - town.y) / town.ry) ** 2 : 1;
      const solid = town?.size === 'centre' && q < .3;
      // Houses are drawn at about half a cell (BUILDING_SCALE), so neighbouring
      // cells in a street already leave a garden between them. Lone farmsteads
      // keep a free cell round them so a farm reads as one yard.
      if (!solid && !town && ring.some(([dx, dy]) => at(dx, dy)?.type === 'urban')) return false;
    }
    if (town && (count[town.id] ?? 0) >= (town.size === 'centre' ? 320 : town.size === 'town' ? 160 : 110)) return false;
    set(grid, x, y, 'urban');
    const c = grid[y][x]; c.settlementId = town?.id;
    c.propAngle = designed ? faceStreet(x, y, angle) : angle;
    if (designed && offset) c.buildingOffset = [Math.max(-.28, Math.min(.28, offset[0])), Math.max(-.28, Math.min(.28, offset[1]))];
    c.buildingKind = designed ? designedKind(town, x, y) : town?.id === 'didziasalis' && deterministic(x, y) > .65 ? 'barn' : 'house';
    if (town) count[town.id] = (count[town.id] ?? 0) + 1;
    // Yard details are added after all buildings, so props cannot erase frontage.
    return true;
  };
  for (const [bx, by, angle] of snapshot.buildings) {
    let x = Math.floor(bx), y = Math.floor(by);
    if (!grid[y]?.[x]) continue;
    const town = settlementAt(bx, by);
    // The OSM import thinned its rural buildings; the designed map places farmsteads on purpose.
    if (!town && !designed && deterministic(bx, by) > .055) continue;
    if (!free(x, y)) {
      if (!town) continue;
      let best: { x: number; y: number; d: number } | null = null;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (!free(x + dx, y + dy) || settlementAt(x + dx, y + dy)?.id !== town.id) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x: x + dx, y: y + dy, d };
      }
      if (!best) continue;
      x = best.x; y = best.y;
    }
    if (!town && [-2, 0, 2].some(dy => [-2, 0, 2].some(dx => grid[y + dy]?.[x + dx]?.type === 'urban'))) continue;
    // Keep where the real building stands inside its cell (only when it was not moved to a free neighbour).
    building(x, y, angle, x === Math.floor(bx) && y === Math.floor(by) ? [bx - x - .5, by - y - .5] : undefined);
  }
  // Representative frontage fills coarse-grid omissions beside real roads.
  // These are stylised buildings, not a claim about exact real-world footprints.
  for (const town of SETTLEMENTS) {
    for (let y = Math.floor(town.y - town.ry); y <= town.y + town.ry; y++) {
      for (let x = Math.floor(town.x - town.rx); x <= town.x + town.rx; x++) {
        if (settlementAt(x + .5, y + .5)?.id !== town.id || !free(x, y)) continue;
        if ((count[town.id] ?? 0) >= (town.size === 'centre' ? 180 : town.size === 'hamlet' ? 30 : 60)) continue;
        const nearStreet = [-2, -1, 1, 2].some(d => grid[y]?.[x + d]?.type === 'road' || grid[y + d]?.[x]?.type === 'road');
        // Roadside houses in small villages are spaced by garden plots and
        // fenced yards; only the two town cores have continuous frontage.
        const density = town.size === 'centre' ? .30 : town.size === 'town' ? .48 : town.size === 'village' ? .35 : .40;
        if (nearStreet && deterministic(x, y) > density) building(x, y,
          designed ? (deterministic(x + 5, y) - .5) * .14 : 0,
          designed ? [(deterministic(x, y + 8) - .5) * .28, (deterministic(x + 8, y) - .5) * .28] : undefined);
      }
    }
    if (designed && (town.size === 'centre' || town.size === 'town')) {
      // Blocks behind the street frontage: big towns are built up, not one row deep.
      const target = town.size === 'centre' ? 240 : 95;
      for (let y = Math.floor(town.y - town.ry); y <= town.y + town.ry; y++) for (let x = Math.floor(town.x - town.rx); x <= town.x + town.rx; x++) {
        if ((count[town.id] ?? 0) >= target) break;
        const q = ((x + .5 - town.x) / town.rx) ** 2 + ((y + .5 - town.y) / town.ry) ** 2;
        if (q > .8 || settlementAt(x + .5, y + .5)?.id !== town.id || !free(x, y)) continue;
        const lot = town.size === 'centre' ? x % 3 !== 0 : (x + y) % 2 === 0;
        if (lot && deterministic(x + 3, y + 9) > .3) building(x, y, (deterministic(x, y) - .5) * .3,
          [(deterministic(x, y + 4) - .5) * .4, (deterministic(x + 4, y) - .5) * .4]);
      }
    }
    const candidates = grid.flat().filter(c => c.type === 'urban' && c.settlementId === town.id)
      .sort((a, b) => Math.hypot(a.x / CELL_SIZE - town.x, a.y / CELL_SIZE - town.y) - Math.hypot(b.x / CELL_SIZE - town.x, b.y / CELL_SIZE - town.y));
    if (candidates[0]) candidates[0].buildingKind = town.landmark;
  }

  // Farmsteads: one modest granary or barn BEHIND selected timber houses,
  // not randomly scattered in front of the street. Historic Dzūkija plots
  // combine the roadside pirkia with yard, svirnas, shed and garden.
  if (designed) {
    const homes = grid.flat().filter(c => c.type === 'urban' &&
      c.buildingKind === 'house' && c.settlementId);
    for (const home of homes) {
      const hx = home.x / CELL_SIZE, hy = home.y / CELL_SIZE;
      if (deterministic(hx + 173, hy + 59) > .22) continue;
      const settlement = SETTLEMENTS.find(t => t.id === home.settlementId);
      if (!settlement || settlement.size === 'centre') continue;
      const a = home.propAngle ?? 0;
      // Snap orientation to one cardinal neighbour: roads can bend at
      // arbitrary angles, but game cover/yard logic uses four-cell adjacency.
      const dxRoad = Math.sin(a), dyRoad = -Math.cos(a);
      const eastWest = Math.abs(dxRoad) > Math.abs(dyRoad);
      const backX = eastWest ? Math.sign(dxRoad) : 0;
      const backY = eastWest ? 0 : Math.sign(dyRoad);
      const sideX = -backY, sideY = backX;
      // Two-cell gap leaves a usable yard/footpath between structures.
      const candidates: [number, number][] = [
        [hx + backX * 2, hy + backY * 2],
        [hx + backX * 2 + sideX, hy + backY * 2 + sideY],
        [hx + backX * 2 - sideX, hy + backY * 2 - sideY],
      ];
      for (const [xx, yy] of candidates) {
        if (!free(xx, yy) || settlementAt(xx + .5, yy + .5)?.id !== home.settlementId) continue;
        if (building(xx, yy, a)) {
          grid[yy][xx].buildingKind = 'barn';
          grid[yy][xx].propAngle = a;
          break;
        }
      }
    }
  }

  // Adjacent gardens and service yards leave entrances open. Add after houses
  // so cover props never consume the limited building placement space.
  for (const row of grid) for (const house of row) {
    if (house.type !== 'urban' || !house.settlementId) continue;
    const x = house.x / CELL_SIZE, y = house.y / CELL_SIZE;
    const a = house.propAngle ?? 0;
    const dxRoad = Math.sin(a), dyRoad = -Math.cos(a);
    const eastWest = Math.abs(dxRoad) > Math.abs(dyRoad);
    const backX = eastWest ? Math.sign(dxRoad) : 0;
    const backY = eastWest ? 0 : Math.sign(dyRoad);
    const sideX = -backY, sideY = backX;
    // Prefer the rear garden, then side yards, never block a street entrance
    // unless no other cell is available.
    const offsets = [[backX, backY], [sideX, sideY], [-sideX, -sideY],
      [-backX, -backY]]; 
    for (const [dx, dy] of offsets) {
      const xx = x + dx, yy = y + dy;
      if (!free(xx, yy) || settlementAt(xx + .5, yy + .5)?.id !== house.settlementId) continue;
      set(grid, xx, yy, 'open');
      const yard = grid[yy][xx];
      yard.yard = house.buildingKind === 'workshop' || house.buildingKind === 'barn' ? 'courtyard'
        : deterministic(xx, yy) > .7 ? 'orchard' : 'garden';
      yard.settlementId = house.settlementId;
      yard.propAngle = house.propAngle;
      yard.concealment = yard.yard === 'orchard' ? .18 : .08;
      if (deterministic(x + 2, y) > .45) placeProp(xx + dx, yy + dy, house.buildingKind === 'barn' ? 'hay' : 'stone_wall', house.propAngle ?? 0);
      break;
    }
  }

  // Forest edges, field boundaries and road pull-offs supply intermediate
  // fighting positions, with gaps for flanking and machinery.
  for (let y = 3; y < MAP_ROWS - 3; y++) for (let x = 3; x < MAP_COLS - 3; x++) {
    if (!free(x, y)) continue;
    const forestEdge = grid[y - 1][x].type === 'forest' || grid[y + 1][x].type === 'forest';
    const roadEdge = grid[y][x - 2].roadName || grid[y][x + 2].roadName;
    if (designed) {
      // Designed map: a few log piles at wood edges and the odd field stone; hay stays by the barns.
      if (forestEdge && rand() < 0.025) placeProp(x, y, 'logs', rand() * Math.PI);
      else if (!roadEdge && deterministic(x + 431, y + 919) < .0025) placeProp(x, y, 'boulder', deterministic(x, y + 55) * Math.PI);
      continue;
    }
    if (forestEdge && rand() < 0.15) placeProp(x, y, 'logs', rand() * Math.PI);
    else if (roadEdge && rand() < 0.07) {
      placeProp(x, y, rand() < 0.4 ? 'wreck' : 'barricade', Math.PI / 2);
    } else if (!designed && (x % 18 === 0 || y % 16 === 0) && rand() < 0.28) {
      if (rand() < 0.5) set(grid, x, y, 'hedgerow'); else placeProp(x, y, 'hay', 0);
    } else if (deterministic(x + 431, y + 919) < .009) {
      placeProp(x, y, deterministic(x + 88, y) < .5 ? 'boulder' : 'scrub', deterministic(x, y + 55) * Math.PI);
    }
  }

  // Staging clearings belong on outskirts. Protect all settlement centres.
  for (const a of Object.values(STAGING_AREAS)) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const c = grid[a.y + dy]?.[a.x + dx];
      if (c && !c.roadName && c.type !== 'water' && !settlementAt(a.x + dx, a.y + dy)) set(grid, a.x + dx, a.y + dy, 'open');
    }
  }
  const L = LEIPALINGIS_ANCHORS.leipalingis;
  for (const [dx, dy] of [[-4, -18], [4, -18], [-4, 18], [4, 18], [-18, -3], [-18, 3], [18, -3], [18, 3]]) {
    const ox = Math.round(dx * GEOGRAPHIC_SCALE), oy = Math.round(dy * GEOGRAPHIC_SCALE);
    let dug = false;
    for (let r = 0; r <= 4 && !dug; r++) {
      for (let sy = -r; sy <= r && !dug; sy++) for (let sx = -r; sx <= r && !dug; sx++) {
        if (!free(L.x + ox + sx, L.y + oy + sy)) continue;
        for (let d = -1; d <= 1; d++) if (free(L.x + ox + sx + d, L.y + oy + sy)) {
          set(grid, L.x + ox + sx + d, L.y + oy + sy, 'trench');
        }
        dug = true;
      }
    }
  }

  // Scenery border: rendered like the rest of the map, but out of bounds for
  // every unit, so the board edge never sits next to the fighting.
  const [x0, y0, x1, y1] = PLAYABLE_CELLS;
  for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
    if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
    const c = grid[y][x];
    c.blocksMovement = true; c.vehicleImpassable = true;
    c.prop = undefined; c.yard = undefined;
  }

  if (designed) {
    // Hills: elevation from the designed height map (water stays at 0).
    for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
      const c = grid[y][x];
      if (c.type !== 'water') c.elevation = 1 + mapHeightAt(x + .5, y + .5);
    }
    // Water sits just below its shore, not at the bottom of a pit: one flat level
    // per lake (a little under its lower banks); the river follows its banks.
    const seen = new Uint8Array(MAP_COLS * MAP_ROWS);
    const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let sy = 0; sy < MAP_ROWS; sy++) for (let sx = 0; sx < MAP_COLS; sx++) {
      if (grid[sy][sx].type !== 'water' || seen[sy * MAP_COLS + sx]) continue;
      const cells: [number, number][] = [], queue: [number, number][] = [[sx, sy]];
      seen[sy * MAP_COLS + sx] = 1;
      while (queue.length) {
        const [x, y] = queue.pop()!; cells.push([x, y]);
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_COLS || ny >= MAP_ROWS || seen[ny * MAP_COLS + nx] || grid[ny][nx].type !== 'water') continue;
          seen[ny * MAP_COLS + nx] = 1; queue.push([nx, ny]);
        }
      }
      const isRiver = cells.some(([x, y]) => x <= 0 || y <= 0 || x >= MAP_COLS - 1 || y >= MAP_ROWS - 1);
      if (!isRiver) {
        const shore: number[] = [];
        for (const [x, y] of cells) for (const [dx, dy] of N4) {
          const n = grid[y + dy]?.[x + dx];
          if (n && n.type !== 'water') shore.push(n.elevation);
        }
        shore.sort((a, b) => a - b);
        const level = (shore.length ? shore[Math.floor(shore.length * .4)] : 1) - WATER_BELOW_SHORE;
        for (const [x, y] of cells) grid[y][x].elevation = level;
      } else {
        const level = new Map<number, number>();
        for (const [x, y] of cells) {
          const banks: number[] = [];
          for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const n = grid[y + dy]?.[x + dx];
            if (n && n.type !== 'water' && !n.blocksMovement) banks.push(n.elevation);
          }
          banks.sort((a, b) => a - b);
          if (banks.length) level.set(y * MAP_COLS + x, banks[Math.floor(banks.length * .35)] - WATER_BELOW_SHORE);
        }
        const known = [...level.values()], fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
        for (const [x, y] of cells) if (!level.has(y * MAP_COLS + x)) level.set(y * MAP_COLS + x, fallback);
        for (let pass = 0; pass < 3; pass++) for (const [x, y] of cells) {
          let sum = level.get(y * MAP_COLS + x)!, n = 1;
          for (const [dx, dy] of N4) { const v = level.get((y + dy) * MAP_COLS + x + dx); if (v !== undefined) { sum += v; n++; } }
          level.set(y * MAP_COLS + x, sum / n);
        }
        for (const [x, y] of cells) grid[y][x].elevation = level.get(y * MAP_COLS + x)!;
      }
    }
    // Wood edges are the best fighting positions: trunks for cover, undergrowth
    // for concealment, open ground in front. Deep woods hide well but slow you.
    for (let y = 1; y < MAP_ROWS - 1; y++) for (let x = 1; x < MAP_COLS - 1; x++) {
      const c = grid[y][x];
      if (c.type !== 'forest') continue;
      const edge = [grid[y - 1][x], grid[y + 1][x], grid[y][x - 1], grid[y][x + 1]].some(n => n.type !== 'forest');
      if (edge) { c.coverBonus = .38; c.concealment = .52; }
      else { c.coverBonus = .25; c.concealment = .45; }
    }
  }
}
