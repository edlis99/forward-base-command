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

  for (let y = 0; y < MAP_ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < MAP_COLS; x++) {
      grid[y][x] = {
        type: 'open',
        x: x * CELL_SIZE,
        y: y * CELL_SIZE,
        coverBonus: 0,
        movementCost: 1,
      };
    }
  }

  // Roads - horizontal main road
  for (let x = 0; x < MAP_COLS; x++) {
    setTerrain(grid, x, 19, 'road');
    setTerrain(grid, x, 20, 'road');
  }
  // Vertical road
  for (let y = 0; y < MAP_ROWS; y++) {
    setTerrain(grid, 30, y, 'road');
  }

  // Urban areas (clusters of buildings)
  const urbanClusters = [
    { cx: 15, cy: 10, r: 4 },
    { cx: 25, cy: 25, r: 3 },
    { cx: 40, cy: 12, r: 5 },
    { cx: 45, cy: 30, r: 3 },
    { cx: 20, cy: 32, r: 3 },
    { cx: 35, cy: 8, r: 2 },
  ];
  for (const c of urbanClusters) {
    for (let dy = -c.r; dy <= c.r; dy++) {
      for (let dx = -c.r; dx <= c.r; dx++) {
        if (rand() < 0.6 && Math.abs(dx) + Math.abs(dy) <= c.r + 1) {
          setTerrain(grid, c.cx + dx, c.cy + dy, 'urban');
        }
      }
    }
  }

  // Forests
  const forestAreas = [
    { cx: 8, cy: 8, r: 5 },
    { cx: 50, cy: 5, r: 4 },
    { cx: 10, cy: 30, r: 6 },
    { cx: 52, cy: 32, r: 4 },
    { cx: 28, cy: 15, r: 3 },
  ];
  for (const f of forestAreas) {
    for (let dy = -f.r; dy <= f.r; dy++) {
      for (let dx = -f.r; dx <= f.r; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= f.r && rand() < 0.7) {
          const gx = f.cx + dx;
          const gy = f.cy + dy;
          if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && grid[gy][gx].type === 'open') {
            setTerrain(grid, gx, gy, 'forest');
          }
        }
      }
    }
  }

  // Water (small lake)
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const dist = Math.sqrt((dx / 3) ** 2 + (dy / 2) ** 2);
      if (dist <= 1) {
        setTerrain(grid, 35 + dx, 20 + dy, 'water');
      }
    }
  }

  return grid;
}

function setTerrain(grid: TerrainCell[][], x: number, y: number, type: TerrainType) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return;
  grid[y][x].type = type;
  switch (type) {
    case 'urban':
      grid[y][x].coverBonus = 0.4;
      grid[y][x].movementCost = 1.5;
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
