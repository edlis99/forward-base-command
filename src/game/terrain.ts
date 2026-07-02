import { TerrainCell, TerrainType, MapLayoutId } from './types';
import { MAP_COLS, MAP_ROWS, CELL_SIZE } from './constants';

function seededRandom(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function emptyCell(x: number, y: number): TerrainCell {
  return {
    type: 'open',
    x: x * CELL_SIZE,
    y: y * CELL_SIZE,
    coverBonus: 0,
    concealment: 0,
    movementCost: 1,
    elevation: 1,
    blocksLOS: false,
    blocksMovement: false,
    vehicleImpassable: false,
    trampled: false,
    traction: 1.0,
    fatigueRate: 1.0,
  };
}

export function generateTerrain(layout: MapLayoutId = 'farmhouse_complex', seed: number = 42): TerrainCell[][] {
  const rand = seededRandom(seed);
  const grid: TerrainCell[][] = [];
  for (let y = 0; y < MAP_ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < MAP_COLS; x++) grid[y][x] = emptyCell(x, y);
  }

  switch (layout) {
    case 'farmhouse_complex': buildFarmhouseComplex(grid, rand); break;
    case 'village_crossroads': buildVillageCrossroads(grid, rand); break;
    case 'forest_outpost': buildForestOutpost(grid, rand); break;
    case 'desert_road': buildDesertRoad(grid, rand); break;
    case 'leipalingis_region': buildLeipalingisRegion(grid, rand); break;
  }

  applyWaterElevation(grid);
  return grid;
}

// ============================== LAYOUTS ==============================

function buildFarmhouseComplex(grid: TerrainCell[][], rand: () => number) {
  scatterGrass(grid, rand, 0.14);
  for (let x = 0; x < 28; x++) { setTerrain(grid, x, 19, 'road'); setTerrain(grid, x, 20, 'road'); }
  for (let y = 6; y <= 16; y++) setTerrain(grid, 16, y, 'hedgerow');
  for (let y = 22; y <= 34; y++) setTerrain(grid, 16, y, 'hedgerow');
  for (let x = 4; x <= 14; x++) setTerrain(grid, x, 6, 'hedgerow');
  for (let x = 4; x <= 14; x++) setTerrain(grid, x, 34, 'hedgerow');
  for (let y = 10; y <= 14; y++) setTerrain(grid, 42, y, 'hedgerow');
  for (let y = 26; y <= 30; y++) setTerrain(grid, 42, y, 'hedgerow');
  for (let x = 0; x < MAP_COLS; x++) {
    const ry = 27 + Math.round(Math.sin(x * 0.4) * 1);
    if (grid[ry] && grid[ry][x].type === 'open') setTerrain(grid, x, ry, 'water');
  }
  setTerrain(grid, 22, 27, 'gravel'); setTerrain(grid, 22, 28, 'gravel'); setTerrain(grid, 23, 27, 'gravel');
  setTerrain(grid, 40, 27, 'gravel'); setTerrain(grid, 40, 28, 'gravel');
  placeForest(grid, rand, 8, 12, 3);
  placeForest(grid, rand, 8, 26, 3);
  placeForest(grid, rand, 20, 6, 2);
  placeForest(grid, rand, 20, 34, 2);
  placeForest(grid, rand, 50, 10, 4);
  placeForest(grid, rand, 50, 30, 4);
  placeForest(grid, rand, 62, 18, 3);
  placeForest(grid, rand, 75, 22, 3);

  for (let x = 26; x <= 35; x++) {
    if (x !== 30) setTerrain(grid, x, 16, 'wall');
    if (x !== 30 && x !== 31) setTerrain(grid, x, 24, 'wall');
  }
  for (let y = 16; y <= 24; y++) {
    if (y !== 20) setTerrain(grid, 26, y, 'wall');
    if (y !== 20) setTerrain(grid, 35, y, 'wall');
  }
  placeUrbanCluster(grid, rand, 29, 18, 1, 1);
  placeUrbanCluster(grid, rand, 33, 18, 1, 1);
  placeUrbanCluster(grid, rand, 31, 22, 1, 1);
  setTerrain(grid, 29, 16, 'sandbag'); setTerrain(grid, 31, 16, 'sandbag');
  setTerrain(grid, 29, 24, 'sandbag'); setTerrain(grid, 32, 24, 'sandbag');
  for (let x = 25; x <= 36; x++) if (rand() < 0.45) setTerrain(grid, x, 15, 'trench');
  for (let x = 25; x <= 36; x++) if (rand() < 0.45) setTerrain(grid, x, 25, 'trench');
  for (const c of [[24, 18], [25, 22], [27, 17], [36, 19], [37, 21], [22, 14], [38, 25], [19, 20], [39, 17]]) {
    setTerrain(grid, c[0], c[1], 'crater');
  }
  for (let i = 0; i < 18; i++) {
    const x = 10 + Math.floor(rand() * 50);
    const y = 8 + Math.floor(rand() * 28);
    if (grid[y]?.[x]?.type === 'open') setTerrain(grid, x, y, rand() < 0.5 ? 'rubble' : 'sandbag');
  }
  for (let i = 0; i < 14; i++) {
    const x = 5 + Math.floor(rand() * 60);
    const y = 24 + Math.floor(rand() * 5);
    if (grid[y]?.[x]?.type === 'open') setTerrain(grid, x, y, 'mud');
  }
  raiseArea(grid, 50, 20, 5);
  raiseArea(grid, 78, 32, 4);
}

function buildVillageCrossroads(grid: TerrainCell[][], rand: () => number) {
  scatterGrass(grid, rand, 0.16);
  for (let x = 0; x < MAP_COLS; x++) { setTerrain(grid, x, 19, 'road'); setTerrain(grid, x, 20, 'road'); }
  for (let y = 0; y < MAP_ROWS; y++) setTerrain(grid, 30, y, 'road');
  placeUrbanCluster(grid, rand, 27, 14, 2, 0.8);
  placeUrbanCluster(grid, rand, 33, 14, 2, 0.8);
  placeUrbanCluster(grid, rand, 27, 26, 2, 0.8);
  placeUrbanCluster(grid, rand, 33, 26, 2, 0.8);
  placeUrbanCluster(grid, rand, 22, 19, 1, 0.85);
  placeUrbanCluster(grid, rand, 38, 19, 1, 0.85);
  placeUrbanCluster(grid, rand, 27, 8, 1, 0.7);
  placeUrbanCluster(grid, rand, 33, 8, 1, 0.7);
  placeUrbanCluster(grid, rand, 27, 32, 1, 0.7);
  placeUrbanCluster(grid, rand, 33, 32, 1, 0.7);
  for (let y = 12; y <= 16; y++) setTerrain(grid, 24, y, 'sandbag');
  for (let y = 24; y <= 28; y++) setTerrain(grid, 24, y, 'sandbag');
  for (let x = 25; x <= 35; x++) setTerrain(grid, x, 11, 'sandbag');
  for (let x = 25; x <= 35; x++) setTerrain(grid, x, 29, 'sandbag');
  for (let x = 26; x <= 34; x++) setTerrain(grid, x, 17, 'trench');
  for (let x = 26; x <= 34; x++) setTerrain(grid, x, 23, 'trench');
  for (let x = 25; x <= 35; x++) { if (rand() < 0.4 && grid[13][x].type === 'open') setTerrain(grid, x, 13, 'wall'); }
  for (let x = 25; x <= 35; x++) { if (rand() < 0.4 && grid[27][x].type === 'open') setTerrain(grid, x, 27, 'wall'); }
  for (const c of [[27, 14], [33, 14], [27, 26], [33, 26]]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (rand() < 0.3) setTerrain(grid, c[0] + dx, c[1] + dy, 'rubble');
    }
  }
  for (let i = 0; i < 22; i++) {
    const x = 40 + Math.floor(rand() * 20);
    const y = 8 + Math.floor(rand() * 26);
    if (grid[y]?.[x]?.type === 'open') setTerrain(grid, x, y, rand() < 0.6 ? 'crater' : 'rubble');
  }
  for (let i = 0; i < 30; i++) {
    const x = 40 + Math.floor(rand() * 20);
    const y = Math.floor(rand() * MAP_ROWS);
    if (grid[y]?.[x]?.type === 'open') setTerrain(grid, x, y, 'tall_grass');
  }
  placeForest(grid, rand, 6, 8, 4);
  placeForest(grid, rand, 6, 30, 4);
  placeForest(grid, rand, 12, 4, 2);
  placeForest(grid, rand, 12, 36, 2);
  for (let y = 6; y <= 14; y++) setTerrain(grid, 18, y, 'hedgerow');
  for (let y = 24; y <= 32; y++) setTerrain(grid, 18, y, 'hedgerow');
  raiseArea(grid, 55, 20, 5);
}

function buildForestOutpost(grid: TerrainCell[][], rand: () => number) {
  scatterGrass(grid, rand, 0.28);
  for (let cx = 6; cx < MAP_COLS; cx += 5) {
    for (let cy = 4; cy < MAP_ROWS; cy += 5) {
      if (rand() < 0.7) placeForest(grid, rand, cx + Math.floor(rand() * 4) - 2, cy + Math.floor(rand() * 4) - 2, 2 + Math.floor(rand() * 2));
    }
  }
  let ty = 18;
  for (let x = 0; x < MAP_COLS; x++) {
    setTerrain(grid, x, ty, 'gravel');
    setTerrain(grid, x, ty + 1, 'gravel');
    if (rand() < 0.18) ty += rand() < 0.5 ? 1 : -1;
    ty = Math.max(4, Math.min(MAP_ROWS - 5, ty));
  }
  for (let y = 0; y < MAP_ROWS; y++) {
    const rx = 36 + Math.round(Math.sin(y * 0.4) * 2);
    if (grid[y]?.[rx] && grid[y][rx].type !== 'gravel') setTerrain(grid, rx, y, 'water');
    if (grid[y]?.[rx + 1] && grid[y][rx + 1].type !== 'gravel') setTerrain(grid, rx + 1, y, 'water');
  }
  for (let y = 17; y <= 20; y++) { setTerrain(grid, 36, y, 'gravel'); setTerrain(grid, 37, y, 'gravel'); }
  const posts: Array<[number, number]> = [[20, 10], [35, 28], [48, 14], [62, 30], [78, 16]];
  for (const [cx, cy] of posts) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= 2 && grid[cy + dy]?.[cx + dx]?.type === 'forest') {
        setTerrain(grid, cx + dx, cy + dy, 'open');
      }
    }
    placeUrbanCluster(grid, rand, cx, cy, 1, 0.8);
    setTerrain(grid, cx - 1, cy + 1, 'sandbag');
    setTerrain(grid, cx + 1, cy - 1, 'sandbag');
    setTerrain(grid, cx - 2, cy, 'trench');
    setTerrain(grid, cx + 2, cy, 'trench');
  }
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rand() * MAP_COLS);
    const y = Math.floor(rand() * MAP_ROWS);
    if (grid[y]?.[x]?.type === 'open') setTerrain(grid, x, y, rand() < 0.5 ? 'mud' : 'crater');
  }
  raiseArea(grid, 12, 30, 5);
  raiseArea(grid, 52, 6, 4);
  raiseArea(grid, 82, 36, 4);
}

function buildDesertRoad(grid: TerrainCell[][], rand: () => number) {
  scatterGrass(grid, rand, 0.06);
  for (let x = 0; x < MAP_COLS; x++) {
    setTerrain(grid, x, 19, 'road');
    setTerrain(grid, x, 20, 'road');
    if (rand() < 0.6) setTerrain(grid, x, 18, 'gravel');
    if (rand() < 0.6) setTerrain(grid, x, 21, 'gravel');
  }
  for (let cx = 6; cx < MAP_COLS; cx += 4) {
    raiseArea(grid, cx + Math.floor(rand() * 3), 8 + Math.floor(rand() * 3), 2);
    raiseArea(grid, cx + Math.floor(rand() * 3), 28 + Math.floor(rand() * 3), 2);
  }
  for (let x = 8; x <= 80; x++) { if (rand() < 0.4) setTerrain(grid, x, 5 + Math.floor(rand() * 2), 'rubble'); }
  for (let x = 8; x <= 80; x++) { if (rand() < 0.4) setTerrain(grid, x, 32 + Math.floor(rand() * 2), 'rubble'); }
  for (const c of [[22, 17], [28, 22], [35, 18], [42, 21], [50, 19], [58, 22], [66, 18], [72, 21]]) setTerrain(grid, c[0], c[1], 'crater');
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * MAP_COLS);
    const y = 9 + Math.floor(rand() * 4);
    if (grid[y]?.[x]?.type === 'open') setTerrain(grid, x, y, 'tall_grass');
    const y2 = 26 + Math.floor(rand() * 4);
    if (grid[y2]?.[x]?.type === 'open') setTerrain(grid, x, y2, 'tall_grass');
  }
  for (const c of [[26, 12], [38, 28], [44, 10], [20, 27], [55, 9], [62, 30], [72, 12], [80, 28]]) placeUrbanCluster(grid, rand, c[0], c[1], 1, 0.9);
  for (const c of [[18, 8], [44, 30], [62, 8], [78, 30]]) {
    setTerrain(grid, c[0], c[1], 'sandbag');
    setTerrain(grid, c[0] + 1, c[1], 'sandbag');
  }
  raiseArea(grid, 18, 8, 4);
  raiseArea(grid, 44, 30, 4);
  raiseArea(grid, 70, 8, 3);
}

// ============================== LEIPALINGIS REGION ==============================
/**
 * Large-scale Lithuanian rural region for the Recapture Leipalingis operation.
 * 160x120 cells. Central town Leipalingis is the objective; five deployment
 * villages spread around it, connected by roads and separated by forests,
 * lakes, hedgerow-lined fields and hills. All terrain has tactical meaning.
 */
export const LEIPALINGIS_ANCHORS = {
  leipalingis:  { x: 90, y: 60 },   // main objective, dead centre-east
  jovaisiai:    { x: 45, y: 22 },   // NW
  didziasalis:  { x: 130, y: 22 },  // NE
  versiai:      { x: 130, y: 98 },  // SE
  straciunai:   { x: 45, y: 98 },   // SW
  seirijai:     { x: 12, y: 60 },   // far west (long approach)
};

function buildLeipalingisRegion(grid: TerrainCell[][], rand: () => number) {
  // Base ground: patchy fields with scattered tall grass
  scatterGrass(grid, rand, 0.10);

  // ---------- Large forest belts (concealment / no-vehicle zones) ----------
  const forestBlobs: Array<[number, number, number]> = [
    [22, 45, 8], [28, 75, 9], [60, 15, 7], [65, 90, 8],
    [105, 12, 6], [115, 45, 7], [110, 80, 8], [140, 60, 7],
    [78, 35, 5], [78, 85, 5], [35, 60, 6], [55, 55, 4],
    [95, 25, 4], [95, 100, 5], [125, 75, 5], [18, 30, 5],
    [18, 90, 5], [148, 25, 4], [148, 95, 4],
  ];
  for (const [x, y, r] of forestBlobs) placeForest(grid, rand, x, y, r);

  // ---------- Rivers and lakes (movement blockers, need bridges) ----------
  // North-south winding river east of Seirijai
  for (let y = 0; y < MAP_ROWS; y++) {
    const rx = 25 + Math.round(Math.sin(y * 0.12) * 4);
    setTerrain(grid, rx, y, 'water');
    setTerrain(grid, rx + 1, y, 'water');
  }
  // East-west stream south of Leipalingis
  for (let x = 55; x < 145; x++) {
    const ry = 78 + Math.round(Math.sin(x * 0.18) * 2);
    if (grid[ry]?.[x]?.type !== 'water') setTerrain(grid, x, ry, 'water');
    if (grid[ry + 1]?.[x]?.type !== 'water') setTerrain(grid, x, ry + 1, 'water');
  }
  // Two lakes
  const lakes: Array<[number, number, number]> = [[70, 40, 4], [118, 30, 3], [50, 88, 3]];
  for (const [cx, cy, r] of lakes) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) setTerrain(grid, cx + dx, cy + dy, 'water');
    }
  }

  // ---------- Road network (fast travel; also ambush zones) ----------
  const roadBetween = (ax: number, ay: number, bx: number, by: number) => {
    // simple Bresenham-style painted road, 2 cells wide, with a bridge (gravel) over water
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(ax + (bx - ax) * t);
      const y = Math.round(ay + (by - ay) * t);
      const cell = grid[y]?.[x];
      if (!cell) continue;
      if (cell.type === 'water') {
        setTerrain(grid, x, y, 'gravel'); // bridge / causeway
        if (grid[y]?.[x + 1]?.type === 'water') setTerrain(grid, x + 1, y, 'gravel');
      } else {
        setTerrain(grid, x, y, 'road');
        if (grid[y]?.[x + 1]) setTerrain(grid, x + 1, y, 'road');
      }
    }
  };
  const A = LEIPALINGIS_ANCHORS;
  roadBetween(A.seirijai.x, A.seirijai.y, A.jovaisiai.x, A.jovaisiai.y);
  roadBetween(A.seirijai.x, A.seirijai.y, A.straciunai.x, A.straciunai.y);
  roadBetween(A.jovaisiai.x, A.jovaisiai.y, A.leipalingis.x, A.leipalingis.y);
  roadBetween(A.didziasalis.x, A.didziasalis.y, A.leipalingis.x, A.leipalingis.y);
  roadBetween(A.versiai.x, A.versiai.y, A.leipalingis.x, A.leipalingis.y);
  roadBetween(A.straciunai.x, A.straciunai.y, A.leipalingis.x, A.leipalingis.y);
  roadBetween(A.jovaisiai.x, A.jovaisiai.y, A.didziasalis.x, A.didziasalis.y);
  roadBetween(A.straciunai.x, A.straciunai.y, A.versiai.x, A.versiai.y);

  // Dirt tracks (gravel = slower, cover-y flanking routes)
  const dirtBetween = (ax: number, ay: number, bx: number, by: number) => {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(ax + (bx - ax) * t);
      const y = Math.round(ay + (by - ay) * t);
      const cell = grid[y]?.[x];
      if (!cell || cell.type === 'water' || cell.type === 'road' || cell.type === 'urban') continue;
      setTerrain(grid, x, y, 'gravel');
    }
  };
  dirtBetween(A.jovaisiai.x + 5, A.jovaisiai.y + 6, A.leipalingis.x - 15, A.leipalingis.y - 20);
  dirtBetween(A.versiai.x - 5, A.versiai.y - 6, A.leipalingis.x + 5, A.leipalingis.y + 12);
  dirtBetween(A.straciunai.x + 10, A.straciunai.y - 6, A.leipalingis.x - 10, A.leipalingis.y + 5);

  // ---------- Hedgerow-lined fields between villages ----------
  const hedgeLine = (ax: number, ay: number, bx: number, by: number) => {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(ax + (bx - ax) * t);
      const y = Math.round(ay + (by - ay) * t);
      const c = grid[y]?.[x];
      if (c && (c.type === 'open' || c.type === 'tall_grass')) setTerrain(grid, x, y, 'hedgerow');
    }
  };
  hedgeLine(50, 35, 78, 35);
  hedgeLine(60, 50, 82, 50);
  hedgeLine(60, 70, 88, 70);
  hedgeLine(102, 42, 122, 42);
  hedgeLine(102, 68, 122, 68);
  hedgeLine(50, 65, 65, 75);

  // ---------- Elevation hills (LOS advantage) ----------
  raiseArea(grid, 75, 30, 5);
  raiseArea(grid, 108, 55, 6);
  raiseArea(grid, 60, 85, 5);
  raiseArea(grid, 135, 80, 5);
  raiseArea(grid, 38, 70, 4);

  // ---------- Isolated farmhouses / barns as cover ----------
  const farms: Array<[number, number]> = [
    [55, 30], [70, 55], [82, 45], [95, 78], [110, 40],
    [120, 55], [125, 85], [50, 55], [38, 40], [140, 45],
    [85, 20], [100, 90], [58, 22], [72, 90], [30, 55],
  ];
  for (const [x, y] of farms) {
    if (grid[y]?.[x]?.type === 'open' || grid[y]?.[x]?.type === 'tall_grass') {
      placeUrbanCluster(grid, rand, x, y, 1, 0.7);
      if (rand() < 0.7) setTerrain(grid, x + 2, y, 'wall');
      if (rand() < 0.7) setTerrain(grid, x - 2, y, 'wall');
    }
  }

  // ---------- Deployment villages (small, walkable, defended-friendly) ----------
  const village = (cx: number, cy: number, size: number) => {
    for (let dy = -size; dy <= size; dy++) for (let dx = -size; dx <= size; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > size + 1) continue;
      const x = cx + dx, y = cy + dy;
      const cell = grid[y]?.[x];
      if (!cell) continue;
      if (cell.type === 'road' || cell.type === 'water') continue;
      if (rand() < 0.55) setTerrain(grid, x, y, 'urban');
      else if (rand() < 0.4) setTerrain(grid, x, y, 'wall');
    }
    // yard walls
    for (let d = -size - 1; d <= size + 1; d++) {
      if (rand() < 0.5) setTerrain(grid, cx + d, cy - size - 1, 'wall');
      if (rand() < 0.5) setTerrain(grid, cx + d, cy + size + 1, 'wall');
    }
  };
  village(A.jovaisiai.x, A.jovaisiai.y, 3);
  village(A.didziasalis.x, A.didziasalis.y, 3);
  village(A.versiai.x, A.versiai.y, 3);
  village(A.straciunai.x, A.straciunai.y, 3);
  village(A.seirijai.x, A.seirijai.y, 4); // larger, farthest

  // ---------- LEIPALINGIS — main objective town (dense) ----------
  const L = A.leipalingis;
  // outer perimeter wall / hedgerow
  for (let d = -12; d <= 12; d++) {
    if (Math.abs(d) < 3) continue;
    setTerrain(grid, L.x + d, L.y - 12, rand() < 0.5 ? 'wall' : 'hedgerow');
    setTerrain(grid, L.x + d, L.y + 12, rand() < 0.5 ? 'wall' : 'hedgerow');
    setTerrain(grid, L.x - 12, L.y + d, rand() < 0.5 ? 'wall' : 'hedgerow');
    setTerrain(grid, L.x + 12, L.y + d, rand() < 0.5 ? 'wall' : 'hedgerow');
  }
  // central admin block
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setTerrain(grid, L.x + dx, L.y + dy, 'urban');
  // residential blocks
  for (const [ox, oy] of [[-8, -6], [-8, 6], [8, -6], [8, 6], [0, -8], [0, 8], [-6, 0], [6, 0]] as [number, number][]) {
    placeUrbanCluster(grid, rand, L.x + ox, L.y + oy, 2, 0.8);
  }
  // defensive rings
  for (let dy = -8; dy <= 8; dy++) {
    if (rand() < 0.35) setTerrain(grid, L.x - 10, L.y + dy, 'sandbag');
    if (rand() < 0.35) setTerrain(grid, L.x + 10, L.y + dy, 'sandbag');
  }
  for (let dx = -8; dx <= 8; dx++) {
    if (rand() < 0.35) setTerrain(grid, L.x + dx, L.y - 10, 'sandbag');
    if (rand() < 0.35) setTerrain(grid, L.x + dx, L.y + 10, 'sandbag');
  }
  // enemy trench segments on all 4 approaches
  for (let d = -6; d <= 6; d++) {
    if (Math.abs(d) < 2) continue;
    if (rand() < 0.7) setTerrain(grid, L.x + d, L.y - 14, 'trench');
    if (rand() < 0.7) setTerrain(grid, L.x + d, L.y + 14, 'trench');
    if (rand() < 0.7) setTerrain(grid, L.x - 14, L.y + d, 'trench');
    if (rand() < 0.7) setTerrain(grid, L.x + 14, L.y + d, 'trench');
  }
  // craters and rubble from prior shelling
  for (let i = 0; i < 40; i++) {
    const x = L.x - 20 + Math.floor(rand() * 40);
    const y = L.y - 20 + Math.floor(rand() * 40);
    if (grid[y]?.[x]?.type === 'open' || grid[y]?.[x]?.type === 'tall_grass') {
      setTerrain(grid, x, y, rand() < 0.5 ? 'crater' : 'rubble');
    }
  }
  // mud strips near river
  for (let i = 0; i < 60; i++) {
    const x = 25 + Math.floor(rand() * 4);
    const y = Math.floor(rand() * MAP_ROWS);
    if (grid[y]?.[x]?.type === 'open') setTerrain(grid, x, y, 'mud');
  }

  // Scatter tall_grass and gravel for concealment / ambush spots along routes
  for (let i = 0; i < 400; i++) {
    const x = Math.floor(rand() * MAP_COLS);
    const y = Math.floor(rand() * MAP_ROWS);
    const c = grid[y]?.[x];
    if (c?.type === 'open' && rand() < 0.5) setTerrain(grid, x, y, 'tall_grass');
  }
}

// ============================== HELPERS ==============================


function scatterGrass(grid: TerrainCell[][], rand: () => number, density: number) {
  for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
    if (rand() < density) setTerrain(grid, x, y, 'tall_grass');
  }
}

function raiseArea(grid: TerrainCell[][], cx: number, cy: number, r: number) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.sqrt(dx * dx + dy * dy) > r) continue;
    const gx = cx + dx, gy = cy + dy;
    if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS) grid[gy][gx].elevation = 2;
  }
}

function applyWaterElevation(grid: TerrainCell[][]) {
  for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) {
    if (grid[y][x].type === 'water') grid[y][x].elevation = 0;
  }
}

function placeUrbanCluster(grid: TerrainCell[][], rand: () => number, cx: number, cy: number, r: number, density: number) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (rand() < density && Math.abs(dx) + Math.abs(dy) <= r + 1) {
      const gx = cx + dx, gy = cy + dy;
      if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && grid[gy][gx].type !== 'road' && grid[gy][gx].type !== 'water') {
        setTerrain(grid, gx, gy, 'urban');
      }
    }
  }
}

function placeForest(grid: TerrainCell[][], rand: () => number, cx: number, cy: number, r: number) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.sqrt(dx * dx + dy * dy) > r) continue;
    if (rand() < 0.7) {
      const gx = cx + dx, gy = cy + dy;
      if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS) {
        const t = grid[gy][gx].type;
        if (t === 'open' || t === 'tall_grass') setTerrain(grid, gx, gy, 'forest');
      }
    }
  }
}

export function setTerrain(grid: TerrainCell[][], x: number, y: number, type: TerrainType) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return;
  const c = grid[y][x];
  c.type = type;
  c.coverBonus = 0;
  c.concealment = 0;
  c.movementCost = 1;
  c.blocksLOS = false;
  c.blocksMovement = false;
  c.vehicleImpassable = false;
  c.traction = 1.0;
  c.fatigueRate = 1.0;

  switch (type) {
    case 'urban':
      c.coverBonus = 0.45; c.concealment = 0.1; c.movementCost = 1.6;
      c.blocksLOS = true; c.vehicleImpassable = true; c.fatigueRate = 1.2; break;
    case 'forest':
      c.coverBonus = 0.2; c.concealment = 0.35; c.movementCost = 1.8;
      c.vehicleImpassable = true; c.fatigueRate = 1.4; break;
    case 'road':
      c.movementCost = 0.6; c.fatigueRate = 0.7; c.traction = 1.1; break;
    case 'water':
      c.movementCost = 99; c.blocksMovement = true; break;
    case 'wall':
      c.coverBonus = 0.65; c.movementCost = 99;
      c.blocksLOS = true; c.blocksMovement = true; break;
    case 'trench':
      c.coverBonus = 0.55; c.movementCost = 0.85;
      c.vehicleImpassable = true; c.fatigueRate = 0.9; break;
    case 'rubble':
      c.coverBonus = 0.18; c.concealment = 0.1; c.movementCost = 2.2;
      c.fatigueRate = 1.5; c.traction = 0.85; break;
    case 'sandbag':
      c.coverBonus = 0.5; c.movementCost = 1.3;
      c.vehicleImpassable = true; c.fatigueRate = 1.1; break;
    case 'mud':
      c.movementCost = 2.6; c.traction = 0.4; c.fatigueRate = 2.0; c.concealment = 0.05; break;
    case 'crater':
      c.coverBonus = 0.35; c.movementCost = 1.9;
      c.vehicleImpassable = true; c.fatigueRate = 1.3; break;
    case 'hedgerow':
      c.coverBonus = 0.3; c.concealment = 0.4; c.movementCost = 2.0;
      c.vehicleImpassable = true; c.blocksLOS = true; c.fatigueRate = 1.3; break;
    case 'tall_grass':
      c.movementCost = 1.05; c.concealment = 0.25; c.fatigueRate = 1.05; break;
    case 'gravel':
      c.movementCost = 0.95; c.traction = 0.85; c.fatigueRate = 0.9; break;
    default:
      c.coverBonus = 0; c.movementCost = 1;
  }
}

export function getTerrainAt(terrain: TerrainCell[][], worldX: number, worldY: number): TerrainCell | null {
  const gx = Math.floor(worldX / CELL_SIZE);
  const gy = Math.floor(worldY / CELL_SIZE);
  if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) return null;
  return terrain[gy][gx];
}

/** Returns true if a unit standing here can dig a trench (open-ish ground). */
export function canDigHere(cell: TerrainCell | null): boolean {
  if (!cell) return false;
  return cell.type === 'open' || cell.type === 'tall_grass' || cell.type === 'mud' || cell.type === 'gravel' || cell.type === 'crater';
}

export function digTrench(terrain: TerrainCell[][], worldX: number, worldY: number): boolean {
  const gx = Math.floor(worldX / CELL_SIZE);
  const gy = Math.floor(worldY / CELL_SIZE);
  if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) return false;
  if (!canDigHere(terrain[gy][gx])) return false;
  setTerrain(terrain, gx, gy, 'trench');
  return true;
}

export function isPassable(cell: TerrainCell | null, isVehicle: boolean, isHelicopter: boolean): boolean {
  if (!cell) return false;
  if (isHelicopter) return true;
  if (cell.blocksMovement) return false;
  if (isVehicle && cell.vehicleImpassable) return false;
  return true;
}

export function losInfo(
  terrain: TerrainCell[][],
  fromX: number, fromY: number, toX: number, toY: number,
  isHelicopter: boolean = false
): { clear: boolean; concealmentSum: number } {
  if (isHelicopter) return { clear: true, concealmentSum: 0 };
  const dx = toX - fromX, dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / (CELL_SIZE * 0.5));
  let concealmentSum = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = fromX + dx * t, cy = fromY + dy * t;
    const gx = Math.floor(cx / CELL_SIZE), gy = Math.floor(cy / CELL_SIZE);
    if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) continue;
    const cell = terrain[gy][gx];
    if (cell.blocksLOS) return { clear: false, concealmentSum: 0 };
    concealmentSum += cell.concealment;
  }
  return { clear: true, concealmentSum };
}

export function hasLineOfSight(
  terrain: TerrainCell[][],
  fromX: number, fromY: number, toX: number, toY: number,
  isHelicopter: boolean = false
): boolean {
  return losInfo(terrain, fromX, fromY, toX, toY, isHelicopter).clear;
}
