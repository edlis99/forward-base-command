import { TerrainCell, TerrainType } from './types';
import { MAP_COLS, MAP_ROWS, CELL_SIZE } from './constants';

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
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

export function generateTerrain(): TerrainCell[][] {
  const rand = seededRandom(42);
  const grid: TerrainCell[][] = [];

  for (let y = 0; y < MAP_ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < MAP_COLS; x++) {
      grid[y][x] = emptyCell(x, y);
    }
  }

  // === Tall grass background scatter — concealment without cover
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      if (rand() < 0.1) setTerrain(grid, x, y, 'tall_grass');
    }
  }

  // === MAIN ROADS ===
  for (let x = 0; x < MAP_COLS; x++) {
    setTerrain(grid, x, 19, 'road');
    setTerrain(grid, x, 20, 'road');
  }
  for (let y = 0; y < MAP_ROWS; y++) {
    setTerrain(grid, 30, y, 'road');
  }
  for (let i = 0; i < 15; i++) {
    setTerrain(grid, 10 + i, 5 + i, 'road');
  }
  for (let i = 0; i < 12; i++) {
    setTerrain(grid, 8 + i, 35 - i, 'road');
  }

  // Gravel shoulders next to highways for variety
  for (let x = 0; x < MAP_COLS; x++) {
    if (grid[18]?.[x]?.type === 'open' && rand() < 0.5) setTerrain(grid, x, 18, 'gravel');
    if (grid[21]?.[x]?.type === 'open' && rand() < 0.5) setTerrain(grid, x, 21, 'gravel');
  }

  // === URBAN ZONES ===
  const centralTown = [
    { cx: 28, cy: 18, r: 3 },
    { cx: 32, cy: 18, r: 3 },
    { cx: 30, cy: 22, r: 3 },
  ];
  for (const c of centralTown) placeUrbanCluster(grid, rand, c.cx, c.cy, c.r, 0.7);
  placeUrbanCluster(grid, rand, 12, 20, 2, 0.8);
  placeUrbanCluster(grid, rand, 14, 18, 2, 0.6);
  placeUrbanCluster(grid, rand, 48, 20, 3, 0.75);
  placeUrbanCluster(grid, rand, 50, 18, 2, 0.7);
  placeUrbanCluster(grid, rand, 20, 8, 3, 0.6);
  placeUrbanCluster(grid, rand, 38, 7, 2, 0.65);
  placeUrbanCluster(grid, rand, 25, 32, 4, 0.55);
  placeUrbanCluster(grid, rand, 40, 33, 3, 0.6);

  // === WALLS — chokepoints ===
  for (let x = 25; x <= 35; x++) {
    if (x !== 28 && x !== 32) setTerrain(grid, x, 15, 'wall');
    if (x !== 29 && x !== 33) setTerrain(grid, x, 25, 'wall');
  }
  for (let y = 15; y <= 25; y++) {
    if (y !== 19 && y !== 20) setTerrain(grid, 25, y, 'wall');
    if (y !== 19 && y !== 20) setTerrain(grid, 35, y, 'wall');
  }
  for (let y = 14; y <= 26; y++) {
    if (y !== 19 && y !== 20 && y !== 22) setTerrain(grid, 42, y, 'wall');
  }
  for (let x = 18; x <= 24; x++) if (x !== 21) setTerrain(grid, x, 11, 'wall');

  // === SANDBAGS ===
  placeSandbagLine(grid, 16, 17, 16, 23);
  placeSandbagLine(grid, 18, 16, 22, 16);
  setTerrain(grid, 29, 17, 'sandbag');
  setTerrain(grid, 31, 17, 'sandbag');
  setTerrain(grid, 29, 23, 'sandbag');
  setTerrain(grid, 31, 23, 'sandbag');
  placeSandbagLine(grid, 44, 17, 44, 23);
  placeSandbagLine(grid, 46, 18, 46, 22);
  setTerrain(grid, 20, 10, 'sandbag');
  setTerrain(grid, 22, 10, 'sandbag');
  setTerrain(grid, 25, 30, 'sandbag');
  setTerrain(grid, 27, 30, 'sandbag');

  // === TRENCHES ===
  for (let y = 16; y <= 24; y++) setTerrain(grid, 10, y, 'trench');
  for (let x = 10; x <= 14; x++) setTerrain(grid, x, 24, 'trench');
  for (let x = 22; x <= 25; x++) setTerrain(grid, x, 20, 'trench');
  for (let y = 17; y <= 23; y++) setTerrain(grid, 46, y, 'trench');
  for (let x = 15; x <= 19; x++) setTerrain(grid, x, 12, 'trench');

  // === RUBBLE ===
  const rubbleAreas = [
    { cx: 30, cy: 20, r: 2 }, { cx: 26, cy: 19, r: 1 }, { cx: 34, cy: 21, r: 1 },
    { cx: 20, cy: 8, r: 2 }, { cx: 42, cy: 20, r: 1 },
  ];
  for (const r of rubbleAreas) {
    for (let dy = -r.r; dy <= r.r; dy++) {
      for (let dx = -r.r; dx <= r.r; dx++) {
        if (rand() < 0.4) {
          const gx = r.cx + dx, gy = r.cy + dy;
          if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && (grid[gy][gx].type === 'open' || grid[gy][gx].type === 'tall_grass')) {
            setTerrain(grid, gx, gy, 'rubble');
          }
        }
      }
    }
  }

  // === CRATERS — battle-damaged ground (slow + light cover) ===
  const craterPoints = [
    { cx: 31, cy: 19 }, { cx: 29, cy: 21 }, { cx: 33, cy: 19 },
    { cx: 41, cy: 22 }, { cx: 17, cy: 11 }, { cx: 23, cy: 19 },
    { cx: 38, cy: 14 }, { cx: 27, cy: 27 }, { cx: 47, cy: 22 },
  ];
  for (const c of craterPoints) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= 1 && rand() < 0.7) {
          const gx = c.cx + dx, gy = c.cy + dy;
          if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS) {
            const t = grid[gy][gx].type;
            if (t === 'open' || t === 'tall_grass' || t === 'gravel') setTerrain(grid, gx, gy, 'crater');
          }
        }
      }
    }
  }

  // === FORESTS ===
  placeForest(grid, rand, 6, 10, 4);
  placeForest(grid, rand, 5, 28, 5);
  placeForest(grid, rand, 22, 13, 2);
  placeForest(grid, rand, 36, 14, 3);
  placeForest(grid, rand, 22, 27, 3);
  placeForest(grid, rand, 36, 27, 3);
  placeForest(grid, rand, 52, 10, 3);
  placeForest(grid, rand, 52, 30, 4);
  placeForest(grid, rand, 15, 3, 3);
  placeForest(grid, rand, 45, 3, 2);
  placeForest(grid, rand, 15, 37, 3);
  placeForest(grid, rand, 45, 37, 2);

  // === HEDGEROWS — vehicle barriers, infantry-passable, light concealment ===
  // Bocage-style hedgerows around fields
  for (let y = 6; y <= 14; y++) setTerrain(grid, 27, y, 'hedgerow');
  for (let x = 33; x <= 39; x++) setTerrain(grid, x, 9, 'hedgerow');
  for (let y = 26; y <= 32; y++) setTerrain(grid, 33, y, 'hedgerow');
  for (let x = 4; x <= 9; x++) setTerrain(grid, x, 16, 'hedgerow');
  for (let x = 50; x <= 56; x++) setTerrain(grid, x, 26, 'hedgerow');

  // === MUD — slows everyone, very bad for vehicles ===
  // Soft ground near river
  for (let x = 0; x < MAP_COLS; x++) {
    const muddy = 28 + Math.round(Math.sin(x * 0.4 + 1) * 1);
    if (grid[muddy] && (grid[muddy][x].type === 'open' || grid[muddy][x].type === 'tall_grass')) {
      if (rand() < 0.5) setTerrain(grid, x, muddy, 'mud');
    }
  }
  // Mud patches scattered
  const mudPatches = [
    { cx: 15, cy: 15, r: 2 }, { cx: 38, cy: 27, r: 2 }, { cx: 44, cy: 8, r: 1 },
  ];
  for (const m of mudPatches) {
    for (let dy = -m.r; dy <= m.r; dy++) {
      for (let dx = -m.r; dx <= m.r; dx++) {
        if (rand() < 0.55 && Math.abs(dx) + Math.abs(dy) <= m.r) {
          const gx = m.cx + dx, gy = m.cy + dy;
          if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS) {
            const t = grid[gy][gx].type;
            if (t === 'open' || t === 'tall_grass') setTerrain(grid, gx, gy, 'mud');
          }
        }
      }
    }
  }

  // === WATER — river ===
  for (let x = 0; x < MAP_COLS; x++) {
    const riverY = 30 + Math.round(Math.sin(x * 0.3) * 1.5);
    if (riverY >= 0 && riverY < MAP_ROWS) {
      if (grid[riverY][x].type !== 'road') setTerrain(grid, x, riverY, 'water');
      if (riverY + 1 < MAP_ROWS && grid[riverY + 1][x].type !== 'road') setTerrain(grid, x, riverY + 1, 'water');
    }
  }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.sqrt((dx / 2) ** 2 + dy ** 2);
      if (dist <= 1 && grid[16 + dy] && grid[16 + dy][37 + dx]?.type === 'open') {
        setTerrain(grid, 37 + dx, 16 + dy, 'water');
      }
    }
  }

  // === ELEVATION ===
  const hillAreas = [
    { cx: 8, cy: 8, r: 3 }, { cx: 50, cy: 8, r: 2 },
    { cx: 30, cy: 5, r: 2 }, { cx: 20, cy: 28, r: 2 }, { cx: 40, cy: 28, r: 2 },
  ];
  for (const h of hillAreas) {
    for (let dy = -h.r; dy <= h.r; dy++) {
      for (let dx = -h.r; dx <= h.r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= h.r) {
          const gx = h.cx + dx, gy = h.cy + dy;
          if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS) {
            grid[gy][gx].elevation = 2;
          }
        }
      }
    }
  }
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      if (grid[y][x].type === 'water') grid[y][x].elevation = 0;
    }
  }

  return grid;
}

function placeUrbanCluster(grid: TerrainCell[][], rand: () => number, cx: number, cy: number, r: number, density: number) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (rand() < density && Math.abs(dx) + Math.abs(dy) <= r + 1) {
        const gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && grid[gy][gx].type !== 'road' && grid[gy][gx].type !== 'water') {
          setTerrain(grid, gx, gy, 'urban');
        }
      }
    }
  }
}

function placeForest(grid: TerrainCell[][], rand: () => number, cx: number, cy: number, r: number) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r && rand() < 0.7) {
        const gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS) {
          const t = grid[gy][gx].type;
          if (t === 'open' || t === 'tall_grass') setTerrain(grid, gx, gy, 'forest');
        }
      }
    }
  }
}

function placeSandbagLine(grid: TerrainCell[][], x1: number, y1: number, x2: number, y2: number) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x1 + (x2 - x1) * (i / Math.max(steps, 1)));
    const y = Math.round(y1 + (y2 - y1) * (i / Math.max(steps, 1)));
    if (x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS) {
      const t = grid[y][x].type;
      if (t === 'open' || t === 'tall_grass') setTerrain(grid, x, y, 'sandbag');
    }
  }
}

function setTerrain(grid: TerrainCell[][], x: number, y: number, type: TerrainType) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return;
  const c = grid[y][x];
  c.type = type;
  // Reset modifiers
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
      c.coverBonus = 0.45;
      c.concealment = 0.1;
      c.movementCost = 1.6;
      c.blocksLOS = true;
      c.vehicleImpassable = true;     // tanks/APCs can't drive through buildings
      c.fatigueRate = 1.2;
      break;
    case 'forest':
      c.coverBonus = 0.2;              // partial hard cover (trunks)
      c.concealment = 0.35;            // strong sight obscurement
      c.movementCost = 1.8;
      c.vehicleImpassable = true;      // dense forest blocks vehicles
      c.fatigueRate = 1.4;
      break;
    case 'road':
      c.coverBonus = 0;
      c.movementCost = 0.6;            // fastest
      c.fatigueRate = 0.7;
      c.traction = 1.1;
      break;
    case 'water':
      c.movementCost = 99;
      c.blocksMovement = true;
      break;
    case 'wall':
      c.coverBonus = 0.65;
      c.movementCost = 99;
      c.blocksLOS = true;
      c.blocksMovement = true;
      break;
    case 'trench':
      c.coverBonus = 0.55;
      c.movementCost = 0.85;           // infantry move easily
      c.vehicleImpassable = true;      // tanks bog down
      c.fatigueRate = 0.9;
      break;
    case 'rubble':
      c.coverBonus = 0.18;
      c.concealment = 0.1;
      c.movementCost = 2.2;
      c.fatigueRate = 1.5;
      c.traction = 0.85;
      break;
    case 'sandbag':
      c.coverBonus = 0.5;
      c.movementCost = 1.3;
      c.vehicleImpassable = true;
      c.fatigueRate = 1.1;
      break;
    case 'mud':
      c.movementCost = 2.6;
      c.traction = 0.4;                // slip / very slow
      c.fatigueRate = 2.0;
      c.concealment = 0.05;
      break;
    case 'crater':
      c.coverBonus = 0.35;             // good infantry cover
      c.movementCost = 1.9;
      c.vehicleImpassable = true;      // tanks have to go around
      c.fatigueRate = 1.3;
      break;
    case 'hedgerow':
      c.coverBonus = 0.3;
      c.concealment = 0.4;
      c.movementCost = 2.0;
      c.vehicleImpassable = true;      // bocage stops vehicles
      c.blocksLOS = true;              // tall hedgerows block sight
      c.fatigueRate = 1.3;
      break;
    case 'tall_grass':
      c.movementCost = 1.05;
      c.concealment = 0.25;            // hides infantry only really
      c.fatigueRate = 1.05;
      break;
    case 'gravel':
      c.movementCost = 0.95;
      c.traction = 0.85;
      c.fatigueRate = 0.9;
      break;
    default:
      c.coverBonus = 0;
      c.movementCost = 1;
  }
}

export function getTerrainAt(terrain: TerrainCell[][], worldX: number, worldY: number): TerrainCell | null {
  const gx = Math.floor(worldX / CELL_SIZE);
  const gy = Math.floor(worldY / CELL_SIZE);
  if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) return null;
  return terrain[gy][gx];
}

/** True if cell can be entered by this unit type. */
export function isPassable(cell: TerrainCell | null, isVehicle: boolean, isHelicopter: boolean): boolean {
  if (!cell) return false;
  if (isHelicopter) return true;
  if (cell.blocksMovement) return false;
  if (isVehicle && cell.vehicleImpassable) return false;
  return true;
}

/**
 * LOS check. Trampled grass loses concealment. Helicopters always have LOS.
 * Returns { clear, accuracyMod } so concealment stacks gradually.
 */
export function losInfo(
  terrain: TerrainCell[][],
  fromX: number, fromY: number,
  toX: number, toY: number,
  isHelicopter: boolean = false
): { clear: boolean; concealmentSum: number } {
  if (isHelicopter) return { clear: true, concealmentSum: 0 };
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / (CELL_SIZE * 0.5));
  let concealmentSum = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = fromX + dx * t;
    const cy = fromY + dy * t;
    const gx = Math.floor(cx / CELL_SIZE);
    const gy = Math.floor(cy / CELL_SIZE);
    if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) continue;
    const cell = terrain[gy][gx];
    if (cell.blocksLOS) return { clear: false, concealmentSum: 0 };
    concealmentSum += cell.concealment;
  }
  return { clear: true, concealmentSum };
}

export function hasLineOfSight(
  terrain: TerrainCell[][],
  fromX: number, fromY: number,
  toX: number, toY: number,
  isHelicopter: boolean = false
): boolean {
  return losInfo(terrain, fromX, fromY, toX, toY, isHelicopter).clear;
}
