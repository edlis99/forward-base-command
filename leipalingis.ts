import { geography as snapshot, GEOGRAPHIC_SCALE, PLAYABLE_CELLS, MAIN_CELLS } from './geography';
export { PLAYABLE_CELLS, MAIN_CELLS };
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
  const width = /primary|secondary/.test(road.class) ? 1.35 : road.class === 'track' ? .38 : .88;
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
    for (let k = 0; k <= n; k++) paintDisc(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, .95, 'water');
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
  const deterministic = (x: number, y: number) => Math.abs(Math.sin(x * 71.17 + y * 31.63) * 43758.5) % 1;
  const building = (x: number, y: number, angle: number) => {
    const town = settlementAt(x + .5, y + .5);
    if (!free(x, y)) return false;
    if (town && (count[town.id] ?? 0) >= (town.size === 'centre' ? 320 : town.size === 'town' ? 160 : 110)) return false;
    set(grid, x, y, 'urban');
    const c = grid[y][x]; c.propAngle = angle; c.settlementId = town?.id;
    c.buildingKind = town?.id === 'didziasalis' && deterministic(x, y) > .65 ? 'barn' : 'house';
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
    building(x, y, angle);
  }
  // Representative frontage fills coarse-grid omissions beside real roads.
  // These are stylised buildings, not a claim about exact real-world footprints.
  for (const town of SETTLEMENTS) {
    for (let y = Math.floor(town.y - town.ry); y <= town.y + town.ry; y++) {
      for (let x = Math.floor(town.x - town.rx); x <= town.x + town.rx; x++) {
        if (settlementAt(x + .5, y + .5)?.id !== town.id || !free(x, y)) continue;
        if ((count[town.id] ?? 0) >= (town.size === 'centre' ? 180 : town.size === 'hamlet' ? 30 : 60)) continue;
        const nearStreet = [-2, -1, 1, 2].some(d => grid[y]?.[x + d]?.type === 'road' || grid[y + d]?.[x]?.type === 'road');
        if (nearStreet && deterministic(x, y) > .3) building(x, y, 0);
      }
    }
    const candidates = grid.flat().filter(c => c.type === 'urban' && c.settlementId === town.id)
      .sort((a, b) => Math.hypot(a.x / CELL_SIZE - town.x, a.y / CELL_SIZE - town.y) - Math.hypot(b.x / CELL_SIZE - town.x, b.y / CELL_SIZE - town.y));
    if (candidates[0]) candidates[0].buildingKind = town.landmark;
  }

  // Adjacent gardens and service yards leave entrances open. Add after houses
  // so cover props never consume the limited building placement space.
  for (const row of grid) for (const house of row) {
    if (house.type !== 'urban' || !house.settlementId) continue;
    const x = house.x / CELL_SIZE, y = house.y / CELL_SIZE;
    const offsets = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const first = Math.floor(deterministic(x, y) * offsets.length);
    for (let k = 0; k < offsets.length; k++) {
      const [dx, dy] = offsets[(first + k) % offsets.length];
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
    c.prop = undefined;
  }
}
