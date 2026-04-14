import { TerrainCell, TerrainType } from './types';
import { MAP_COLS, MAP_ROWS, CELL_SIZE } from './constants';

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateTerrain(): TerrainCell[][] {
  const rand = seededRandom(42);
  const grid: TerrainCell[][] = [];

  // Initialize all as open
  for (let y = 0; y < MAP_ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < MAP_COLS; x++) {
      grid[y][x] = {
        type: 'open',
        x: x * CELL_SIZE,
        y: y * CELL_SIZE,
        coverBonus: 0,
        movementCost: 1,
        elevation: 1,
        blocksLOS: false,
        blocksMovement: false,
      };
    }
  }

  // === MAIN ROADS — important movement corridors ===
  // East-west highway through center
  for (let x = 0; x < MAP_COLS; x++) {
    setTerrain(grid, x, 19, 'road');
    setTerrain(grid, x, 20, 'road');
  }
  // North-south road
  for (let y = 0; y < MAP_ROWS; y++) {
    setTerrain(grid, 30, y, 'road');
  }
  // Secondary road from NW to center
  for (let i = 0; i < 15; i++) {
    setTerrain(grid, 10 + i, 5 + i, 'road');
  }
  // Secondary road from SW
  for (let i = 0; i < 12; i++) {
    setTerrain(grid, 8 + i, 35 - i, 'road');
  }

  // === URBAN COMBAT ZONES — key contested areas ===
  // Central town (main battlefield objective) — dense buildings
  const centralTown = [
    { cx: 28, cy: 18, r: 3 },
    { cx: 32, cy: 18, r: 3 },
    { cx: 30, cy: 22, r: 3 },
  ];
  for (const c of centralTown) {
    placeUrbanCluster(grid, rand, c.cx, c.cy, c.r, 0.7);
  }

  // Western outpost (near player spawn)
  placeUrbanCluster(grid, rand, 12, 20, 2, 0.8);
  placeUrbanCluster(grid, rand, 14, 18, 2, 0.6);

  // Eastern enemy compound
  placeUrbanCluster(grid, rand, 48, 20, 3, 0.75);
  placeUrbanCluster(grid, rand, 50, 18, 2, 0.7);

  // Northern village
  placeUrbanCluster(grid, rand, 20, 8, 3, 0.6);
  placeUrbanCluster(grid, rand, 38, 7, 2, 0.65);

  // Southern industrial zone
  placeUrbanCluster(grid, rand, 25, 32, 4, 0.55);
  placeUrbanCluster(grid, rand, 40, 33, 3, 0.6);

  // === WALLS — impassable barriers creating chokepoints ===
  // Wall compound around central town (with gaps for entry)
  for (let x = 25; x <= 35; x++) {
    if (x !== 28 && x !== 32) setTerrain(grid, x, 15, 'wall'); // north wall with 2 gaps
    if (x !== 29 && x !== 33) setTerrain(grid, x, 25, 'wall'); // south wall with 2 gaps
  }
  for (let y = 15; y <= 25; y++) {
    if (y !== 19 && y !== 20) setTerrain(grid, 25, y, 'wall'); // west wall (road gap)
    if (y !== 19 && y !== 20) setTerrain(grid, 35, y, 'wall'); // east wall (road gap)
  }

  // Eastern defensive wall line
  for (let y = 14; y <= 26; y++) {
    if (y !== 19 && y !== 20 && y !== 22) setTerrain(grid, 42, y, 'wall');
  }

  // Northern wall barriers
  for (let x = 18; x <= 24; x++) {
    if (x !== 21) setTerrain(grid, x, 11, 'wall');
  }

  // === SANDBAG POSITIONS — defensive cover points ===
  // Player-side defensive line
  placeSandbagLine(grid, 16, 17, 16, 23);  // vertical sandbag line
  placeSandbagLine(grid, 18, 16, 22, 16);  // horizontal 

  // Central crossroads defense positions
  setTerrain(grid, 29, 17, 'sandbag');
  setTerrain(grid, 31, 17, 'sandbag');
  setTerrain(grid, 29, 23, 'sandbag');
  setTerrain(grid, 31, 23, 'sandbag');

  // Enemy side sandbags
  placeSandbagLine(grid, 44, 17, 44, 23);
  placeSandbagLine(grid, 46, 18, 46, 22);

  // Flanking route sandbags
  setTerrain(grid, 20, 10, 'sandbag');
  setTerrain(grid, 22, 10, 'sandbag');
  setTerrain(grid, 25, 30, 'sandbag');
  setTerrain(grid, 27, 30, 'sandbag');

  // === TRENCHES — protected movement lanes ===
  // Player-side trench line
  for (let y = 16; y <= 24; y++) {
    setTerrain(grid, 10, y, 'trench');
  }
  for (let x = 10; x <= 14; x++) {
    setTerrain(grid, x, 24, 'trench');
  }

  // Central trench approaching town
  for (let x = 22; x <= 25; x++) {
    setTerrain(grid, x, 20, 'trench');
  }

  // Enemy approach trench
  for (let y = 17; y <= 23; y++) {
    setTerrain(grid, 46, y, 'trench');
  }

  // Northern flanking trench
  for (let x = 15; x <= 19; x++) {
    setTerrain(grid, x, 12, 'trench');
  }

  // === RUBBLE — slows movement, light cover ===
  // Rubble around combat zones (battle damage)
  const rubbleAreas = [
    { cx: 30, cy: 20, r: 2 },
    { cx: 26, cy: 19, r: 1 },
    { cx: 34, cy: 21, r: 1 },
    { cx: 20, cy: 8, r: 2 },
    { cx: 42, cy: 20, r: 1 },
  ];
  for (const r of rubbleAreas) {
    for (let dy = -r.r; dy <= r.r; dy++) {
      for (let dx = -r.r; dx <= r.r; dx++) {
        if (rand() < 0.4) {
          const gx = r.cx + dx, gy = r.cy + dy;
          if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && grid[gy][gx].type === 'open') {
            setTerrain(grid, gx, gy, 'rubble');
          }
        }
      }
    }
  }

  // === FORESTS — concealment and slow movement ===
  // Western forest (player flanking cover)
  placeForest(grid, rand, 6, 10, 4);
  placeForest(grid, rand, 5, 28, 5);

  // Central forests creating sight-blocking corridors
  placeForest(grid, rand, 22, 13, 2);
  placeForest(grid, rand, 36, 14, 3);
  placeForest(grid, rand, 22, 27, 3);
  placeForest(grid, rand, 36, 27, 3);

  // Eastern forests
  placeForest(grid, rand, 52, 10, 3);
  placeForest(grid, rand, 52, 30, 4);

  // Northern and southern edge forests
  placeForest(grid, rand, 15, 3, 3);
  placeForest(grid, rand, 45, 3, 2);
  placeForest(grid, rand, 15, 37, 3);
  placeForest(grid, rand, 45, 37, 2);

  // === WATER — impassable except helicopters ===
  // River running through south
  for (let x = 0; x < MAP_COLS; x++) {
    const riverY = 30 + Math.round(Math.sin(x * 0.3) * 1.5);
    if (riverY >= 0 && riverY < MAP_ROWS) {
      // Don't overwrite roads (bridges)
      if (grid[riverY][x].type !== 'road') {
        setTerrain(grid, x, riverY, 'water');
      }
      if (riverY + 1 < MAP_ROWS && grid[riverY + 1][x].type !== 'road') {
        setTerrain(grid, x, riverY + 1, 'water');
      }
    }
  }

  // Small pond near central town
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.sqrt((dx / 2) ** 2 + dy ** 2);
      if (dist <= 1 && grid[16 + dy] && grid[16 + dy][37 + dx]?.type === 'open') {
        setTerrain(grid, 37 + dx, 16 + dy, 'water');
      }
    }
  }

  // === ELEVATION — high ground advantages ===
  // Hills on the flanks
  const hillAreas = [
    { cx: 8, cy: 8, r: 3 },    // NW hill (player overwatch)
    { cx: 50, cy: 8, r: 2 },   // NE hill (enemy overwatch)
    { cx: 30, cy: 5, r: 2 },   // Northern ridge
    { cx: 20, cy: 28, r: 2 },  // SW elevation
    { cx: 40, cy: 28, r: 2 },  // SE elevation
  ];
  for (const h of hillAreas) {
    for (let dy = -h.r; dy <= h.r; dy++) {
      for (let dx = -h.r; dx <= h.r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= h.r) {
          const gx = h.cx + dx;
          const gy = h.cy + dy;
          if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS) {
            grid[gy][gx].elevation = 2;
          }
        }
      }
    }
  }

  // Water is low elevation
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
        if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && grid[gy][gx].type === 'open') {
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
        if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && grid[gy][gx].type === 'open') {
          setTerrain(grid, gx, gy, 'forest');
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
    if (x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS && grid[y][x].type === 'open') {
      setTerrain(grid, x, y, 'sandbag');
    }
  }
}

function setTerrain(grid: TerrainCell[][], x: number, y: number, type: TerrainType) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return;
  grid[y][x].type = type;
  grid[y][x].blocksLOS = false;
  grid[y][x].blocksMovement = false;
  switch (type) {
    case 'urban':
      grid[y][x].coverBonus = 0.4;
      grid[y][x].movementCost = 1.5;
      grid[y][x].blocksLOS = true; // buildings block line of sight
      break;
    case 'forest':
      grid[y][x].coverBonus = 0.25;
      grid[y][x].movementCost = 1.8;
      break;
    case 'road':
      grid[y][x].coverBonus = 0;
      grid[y][x].movementCost = 0.7;
      break;
    case 'water':
      grid[y][x].coverBonus = 0;
      grid[y][x].movementCost = 99;
      grid[y][x].blocksMovement = true;
      break;
    case 'wall':
      grid[y][x].coverBonus = 0.6;
      grid[y][x].movementCost = 99;
      grid[y][x].blocksLOS = true;
      grid[y][x].blocksMovement = true;
      break;
    case 'trench':
      grid[y][x].coverBonus = 0.5;
      grid[y][x].movementCost = 0.9; // trenches are easy to move through
      break;
    case 'rubble':
      grid[y][x].coverBonus = 0.15;
      grid[y][x].movementCost = 2.2;
      break;
    case 'sandbag':
      grid[y][x].coverBonus = 0.45;
      grid[y][x].movementCost = 1.3;
      break;
    default:
      grid[y][x].coverBonus = 0;
      grid[y][x].movementCost = 1;
  }
}

export function getTerrainAt(terrain: TerrainCell[][], worldX: number, worldY: number): TerrainCell | null {
  const gx = Math.floor(worldX / CELL_SIZE);
  const gy = Math.floor(worldY / CELL_SIZE);
  if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) return null;
  return terrain[gy][gx];
}

/**
 * Check line of sight between two world positions.
 * Returns true if LOS is clear (no blocking terrain in the way).
 * Helicopters always have LOS (flying above terrain).
 */
export function hasLineOfSight(
  terrain: TerrainCell[][],
  fromX: number, fromY: number,
  toX: number, toY: number,
  isHelicopter: boolean = false
): boolean {
  if (isHelicopter) return true; // helicopters fly above obstacles
  
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(dist / (CELL_SIZE * 0.5)); // check every half-cell
  
  for (let i = 1; i < steps; i++) { // skip start and end cells
    const t = i / steps;
    const checkX = fromX + dx * t;
    const checkY = fromY + dy * t;
    const gx = Math.floor(checkX / CELL_SIZE);
    const gy = Math.floor(checkY / CELL_SIZE);
    if (gx < 0 || gx >= MAP_COLS || gy < 0 || gy >= MAP_ROWS) continue;
    if (terrain[gy][gx].blocksLOS) return false;
  }
  return true;
}
