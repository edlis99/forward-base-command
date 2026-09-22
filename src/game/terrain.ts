import { TerrainCell, TerrainType, MapLayoutId } from './types';
import { MAP_COLS, MAP_ROWS, CELL_SIZE } from './constants';
import { buildLeipalingis } from './maps/leipalingis';
export { LEIPALINGIS_ANCHORS } from './maps/leipalingis';

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
    case 'leipalingis_region': buildLeipalingis(grid, rand, setTerrain); break;
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
  delete c.prop; delete c.propAngle; delete c.roadName;
  c.exposure = 1;
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
      c.movementCost = 0.72; c.fatigueRate = 0.7; c.traction = 1.05; c.exposure = 1.5; break;
    case 'water':
      c.movementCost = 99; c.blocksMovement = true; break;
    case 'wall':
      c.coverBonus = 0.65; c.movementCost = 99;
      c.blocksLOS = true; c.blocksMovement = true; break;
    case 'trench':
      // Infantry fighting positions: strong ballistic cover and concealment,
      // but still traversable on foot. Vehicles must route around them.
      c.coverBonus = 0.72; c.concealment = 0.42; c.movementCost = 0.85;
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

/** Footprint-aware passability. Vehicles need clearance in a neighborhood, not just one cell. */
export function isFootprintPassable(
  terrain: TerrainCell[][],
  gx: number, gy: number,
  isVehicle: boolean, isHelicopter: boolean,
  radius?: number,
): boolean {
  if (isHelicopter) return true;
  const r = radius ?? (isVehicle ? 1 : 0);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) return false;
      if (!isPassable(terrain[ny][nx], isVehicle, isHelicopter)) return false;
    }
  }
  return true;
}

/** BFS-nearest passable cell (footprint aware). Returns world-space center of that cell. */
export function findNearestPassableWorld(
  terrain: TerrainCell[][],
  worldX: number, worldY: number,
  isVehicle: boolean, isHelicopter: boolean,
  maxRadius = 8,
): { x: number; y: number } {
  if (isHelicopter) return { x: worldX, y: worldY };
  const gx = Math.max(0, Math.min(MAP_COLS - 1, Math.floor(worldX / CELL_SIZE)));
  const gy = Math.max(0, Math.min(MAP_ROWS - 1, Math.floor(worldY / CELL_SIZE)));
  if (isFootprintPassable(terrain, gx, gy, isVehicle, false)) return {
    x: Math.max(0, Math.min(MAP_COLS * CELL_SIZE - 1, worldX)),
    y: Math.max(0, Math.min(MAP_ROWS * CELL_SIZE - 1, worldY)),
  };
  let best: { x: number; y: number; d: number } | null = null;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = gx + dx, ny = gy + dy;
        if (isFootprintPassable(terrain, nx, ny, isVehicle, false)) {
          const d = dx * dx + dy * dy;
          if (!best || d < best.d) best = { x: nx, y: ny, d };
        }
      }
    }
    if (best) break;
  }
  if (!best) return { x: worldX, y: worldY };
  return { x: best.x * CELL_SIZE + CELL_SIZE / 2, y: best.y * CELL_SIZE + CELL_SIZE / 2 };
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
    // Occupants fire from a building's windows or the edge of a hedge.
    // Intermediate buildings still block fire in both directions.
    const endpoint = (gx === Math.floor(fromX / CELL_SIZE) && gy === Math.floor(fromY / CELL_SIZE)) ||
      (gx === Math.floor(toX / CELL_SIZE) && gy === Math.floor(toY / CELL_SIZE));
    if (cell.blocksLOS && !endpoint) return { clear: false, concealmentSum: 0 };
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

