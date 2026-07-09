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
  leipalingis:  { x: 125, y: 80 },   // main objective, centre-east
  jovaisiai:    { x: 62,  y: 30 },   // NW
  didziasalis:  { x: 180, y: 30 },   // NE
  versiai:      { x: 180, y: 130 },  // SE
  straciunai:   { x: 62,  y: 130 },  // SW
  seirijai:     { x: 15,  y: 80 },   // far west (long approach)
};

function buildLeipalingisRegion(grid: TerrainCell[][], rand: () => number) {
  // Base ground: patchy fields with scattered tall grass
  scatterGrass(grid, rand, 0.11);

  // ---------- Large forest belts (concealment / no-vehicle zones) ----------
  const forestBlobs: Array<[number, number, number]> = [
    // NW belt
    [28, 55, 9], [40, 70, 8], [52, 85, 7], [30, 40, 6], [45, 50, 5],
    // NE belt
    [150, 15, 6], [165, 45, 8], [195, 55, 6], [175, 70, 7], [200, 90, 6],
    // SE belt
    [155, 105, 8], [170, 118, 7], [140, 115, 6], [190, 115, 5],
    // SW belt
    [55, 110, 7], [40, 100, 6], [80, 118, 6], [25, 115, 5],
    // Central pockets
    [95, 45, 5], [105, 105, 5], [80, 65, 4], [115, 55, 4], [140, 65, 4],
    [90, 90, 4], [125, 40, 5], [70, 45, 4], [155, 85, 4],
    // Edge blobs
    [10, 20, 6], [10, 140, 6], [210, 20, 5], [210, 140, 5],
  ];
  for (const [x, y, r] of forestBlobs) placeForest(grid, rand, x, y, r);

  // ---------- Rivers and lakes (movement blockers, need bridges) ----------
  // Winding north-south river west of Leipalingis
  for (let y = 0; y < MAP_ROWS; y++) {
    const rx = 34 + Math.round(Math.sin(y * 0.09) * 5 + Math.sin(y * 0.24) * 2);
    setTerrain(grid, rx, y, 'water');
    setTerrain(grid, rx + 1, y, 'water');
  }
  // Meandering east-west stream south of Leipalingis
  for (let x = 60; x < 210; x++) {
    const ry = 108 + Math.round(Math.sin(x * 0.11) * 3 + Math.cos(x * 0.19) * 2);
    if (grid[ry]?.[x]?.type !== 'water') setTerrain(grid, x, ry, 'water');
    if (grid[ry + 1]?.[x]?.type !== 'water') setTerrain(grid, x + 1, ry + 1, 'water');
  }
  // Lakes (irregular)
  const lakes: Array<[number, number, number]> = [
    [92, 55, 5], [160, 40, 4], [70, 118, 4], [175, 95, 3], [50, 65, 3],
  ];
  for (const [cx, cy, r] of lakes) {
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy) + (rand() - 0.5) * 0.9;
      if (d <= r) setTerrain(grid, cx + dx, cy + dy, 'water');
    }
  }
  // Marshland fringes
  for (let i = 0; i < 220; i++) {
    const x = Math.floor(rand() * MAP_COLS);
    const y = Math.floor(rand() * MAP_ROWS);
    const c = grid[y]?.[x];
    if (!c) continue;
    // near water?
    let nearWater = false;
    for (let dy = -1; dy <= 1 && !nearWater; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (grid[y + dy]?.[x + dx]?.type === 'water') { nearWater = true; break; }
    }
    if (nearWater && c.type === 'open') setTerrain(grid, x, y, 'mud');
  }

  // ---------- Curved road network (no straight-line roads) ----------
  const paintRoad = (x: number, y: number) => {
    const cell = grid[y]?.[x];
    if (!cell) return;
    if (cell.type === 'water') {
      setTerrain(grid, x, y, 'gravel'); // bridge / causeway
    } else if (cell.type !== 'urban' && cell.type !== 'wall') {
      setTerrain(grid, x, y, 'road');
    }
  };
  // Curve a path between two anchors using two seeded perpendicular offsets
  // to produce an S-curve; then rasterize with a 2-cell-wide brush that shifts
  // to follow the tangent (so it never looks like a ruled line).
  // Sample a cubic Bezier between two points with two control offsets
  const rasterCubic = (ax: number, ay: number, bx: number, by: number,
                       c1x: number, c1y: number, c2x: number, c2y: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(80, Math.round(len * 2.5));
    let prevGx = -1, prevGy = -1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, it = 1 - t;
      const px = it * it * it * ax + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t * t * t * bx;
      const py = it * it * it * ay + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t * t * t * by;
      const tx = 3 * it * it * (c1x - ax) + 6 * it * t * (c2x - c1x) + 3 * t * t * (bx - c2x);
      const ty = 3 * it * it * (c1y - ay) + 6 * it * t * (c2y - c1y) + 3 * t * t * (by - c2y);
      const tl = Math.max(0.001, Math.hypot(tx, ty));
      const px2 = -ty / tl, py2 = tx / tl;
      const gx = Math.round(px), gy = Math.round(py);
      if (gx === prevGx && gy === prevGy) continue;
      prevGx = gx; prevGy = gy;
      paintRoad(gx, gy);
      paintRoad(Math.round(px + px2), Math.round(py + py2));
      if (Math.abs(t - 0.5) < 0.08 || rand() < 0.06) paintRoad(Math.round(px - px2), Math.round(py - py2));
      if (rand() < 0.08) {
        const jx = Math.round(px + px2 * 1.6);
        const jy = Math.round(py + py2 * 1.6);
        if (grid[jy]?.[jx]?.type === 'open' || grid[jy]?.[jx]?.type === 'tall_grass') {
          setTerrain(grid, jx, jy, 'gravel');
        }
      }
    }
  };

  // Multi-waypoint curved road. Inserts intermediate waypoints offset
  // perpendicular to the straight line so the route weaves organically,
  // and forces an angled final approach so roads never enter a village head-on.
  const curveRoad = (ax: number, ay: number, bx: number, by: number, curviness = 1) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len, ny = dx / len;
    const segs = len > 60 ? 3 : 2;
    const pts: Array<[number, number]> = [[ax, ay]];
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      const side = (s % 2 === 0 ? 1 : -1) * (rand() < 0.5 ? 1 : -1);
      const mag = len * (0.12 + rand() * 0.14) * curviness * side;
      const along = t + (rand() - 0.5) * 0.08;
      pts.push([ax + dx * along + nx * mag, ay + dy * along + ny * mag]);
    }
    const approachSide = (rand() < 0.5 ? 1 : -1);
    const approachMag = len * 0.09 * curviness * approachSide;
    pts.push([ax + dx * 0.88 + nx * approachMag, ay + dy * 0.88 + ny * approachMag]);
    pts.push([bx, by]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [px1, py1] = pts[i];
      const [px2, py2] = pts[i + 1];
      const sdx = px2 - px1, sdy = py2 - py1;
      const slen = Math.max(1, Math.hypot(sdx, sdy));
      const snx = -sdy / slen, sny = sdx / slen;
      const off1 = (rand() * 2 - 1) * slen * 0.22 * curviness;
      const off2 = -(rand() * 2 - 1) * slen * 0.22 * curviness;
      const c1x = px1 + sdx * 0.33 + snx * off1;
      const c1y = py1 + sdy * 0.33 + sny * off1;
      const c2x = px1 + sdx * 0.66 + snx * off2;
      const c2y = py1 + sdy * 0.66 + sny * off2;
      rasterCubic(px1, py1, px2, py2, c1x, c1y, c2x, c2y);
    }
  };

  const A = LEIPALINGIS_ANCHORS;
  // Radial main roads into Leipalingis — all curved, none straight
  curveRoad(A.jovaisiai.x, A.jovaisiai.y, A.leipalingis.x, A.leipalingis.y, 1.3);
  curveRoad(A.didziasalis.x, A.didziasalis.y, A.leipalingis.x, A.leipalingis.y, 1.2);
  curveRoad(A.versiai.x, A.versiai.y, A.leipalingis.x, A.leipalingis.y, 1.4);
  curveRoad(A.straciunai.x, A.straciunai.y, A.leipalingis.x, A.leipalingis.y, 1.3);
  curveRoad(A.seirijai.x, A.seirijai.y, A.jovaisiai.x, A.jovaisiai.y, 1.4);
  curveRoad(A.seirijai.x, A.seirijai.y, A.straciunai.x, A.straciunai.y, 1.3);
  curveRoad(A.jovaisiai.x, A.jovaisiai.y, A.didziasalis.x, A.didziasalis.y, 1.1);
  curveRoad(A.straciunai.x, A.straciunai.y, A.versiai.x, A.versiai.y, 1.2);
  curveRoad(A.didziasalis.x, A.didziasalis.y, A.versiai.x, A.versiai.y, 1.3);

  // Dirt tracks (flanking cover-y routes)
  const dirtTrack = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const nx = -dy / len, ny = dx / len;
    const off = (rand() * 2 - 1) * len * 0.22;
    const cx = (ax + bx) / 2 + nx * off;
    const cy = (ay + by) / 2 + ny * off;
    const steps = Math.round(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, it = 1 - t;
      const px = it * it * ax + 2 * it * t * cx + t * t * bx;
      const py = it * it * ay + 2 * it * t * cy + t * t * by;
      const gx = Math.round(px), gy = Math.round(py);
      const cell = grid[gy]?.[gx];
      if (!cell || cell.type === 'water' || cell.type === 'road' || cell.type === 'urban') continue;
      setTerrain(grid, gx, gy, 'gravel');
    }
  };
  dirtTrack(A.jovaisiai.x + 8, A.jovaisiai.y + 10, A.leipalingis.x - 20, A.leipalingis.y - 25);
  dirtTrack(A.versiai.x - 8, A.versiai.y - 10, A.leipalingis.x + 10, A.leipalingis.y + 15);
  dirtTrack(A.straciunai.x + 15, A.straciunai.y - 8, A.leipalingis.x - 15, A.leipalingis.y + 8);
  dirtTrack(A.didziasalis.x - 10, A.didziasalis.y + 12, A.leipalingis.x + 5, A.leipalingis.y - 15);

  // ---------- Hedgerow-lined fields between villages ----------
  const hedgeCurve = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const nx = -dy / len, ny = dx / len;
    const off = (rand() * 2 - 1) * len * 0.12;
    const cx = (ax + bx) / 2 + nx * off;
    const cy = (ay + by) / 2 + ny * off;
    const steps = Math.round(len * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, it = 1 - t;
      const px = it * it * ax + 2 * it * t * cx + t * t * bx;
      const py = it * it * ay + 2 * it * t * cy + t * t * by;
      const gx = Math.round(px), gy = Math.round(py);
      const c = grid[gy]?.[gx];
      if (c && (c.type === 'open' || c.type === 'tall_grass')) setTerrain(grid, gx, gy, 'hedgerow');
    }
  };
  hedgeCurve(70, 48, 110, 50);
  hedgeCurve(85, 70, 118, 72);
  hedgeCurve(85, 92, 118, 95);
  hedgeCurve(138, 55, 168, 58);
  hedgeCurve(138, 92, 168, 90);
  hedgeCurve(70, 100, 100, 108);
  hedgeCurve(50, 45, 60, 60);

  // ---------- Elevation hills (LOS advantage) ----------
  raiseArea(grid, 100, 45, 6);
  raiseArea(grid, 148, 75, 7);
  raiseArea(grid, 80, 100, 5);
  raiseArea(grid, 185, 108, 6);
  raiseArea(grid, 50, 95, 5);
  raiseArea(grid, 200, 45, 5);

  // ---------- Isolated farmhouses / barns as cover ----------
  const farms: Array<[number, number]> = [
    [78, 42], [98, 68], [110, 48], [125, 105], [148, 55],
    [162, 75], [170, 118], [70, 75], [55, 55], [190, 60],
    [115, 25], [135, 118], [80, 25], [95, 118], [45, 78],
    [175, 45], [140, 95], [100, 90], [58, 108], [155, 118],
  ];
  for (const [x, y] of farms) {
    if (grid[y]?.[x]?.type === 'open' || grid[y]?.[x]?.type === 'tall_grass') {
      placeUrbanCluster(grid, rand, x, y, 1, 0.7);
      if (rand() < 0.7) setTerrain(grid, x + 2, y, 'wall');
      if (rand() < 0.7) setTerrain(grid, x - 2, y, 'wall');
      if (rand() < 0.5) setTerrain(grid, x, y + 2, 'hedgerow');
    }
  }

  // ---------- Deployment villages (irregular clusters) ----------
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
    // yard walls & orchards (hedgerow) around edges
    for (let d = -size - 1; d <= size + 1; d++) {
      if (rand() < 0.4) setTerrain(grid, cx + d, cy - size - 1, 'wall');
      if (rand() < 0.4) setTerrain(grid, cx + d, cy + size + 1, 'wall');
      if (rand() < 0.35) setTerrain(grid, cx - size - 2, cy + d, 'hedgerow');
      if (rand() < 0.35) setTerrain(grid, cx + size + 2, cy + d, 'hedgerow');
    }
  };
  village(A.jovaisiai.x, A.jovaisiai.y, 3);
  village(A.didziasalis.x, A.didziasalis.y, 3);
  village(A.versiai.x, A.versiai.y, 3);
  village(A.straciunai.x, A.straciunai.y, 3);
  village(A.seirijai.x, A.seirijai.y, 4); // larger, farthest

  // ---------- LEIPALINGIS — main objective town (dense) ----------
  const L = A.leipalingis;
  // outer perimeter wall / hedgerow (irregular gaps for entry)
  for (let d = -14; d <= 14; d++) {
    if (Math.abs(d) < 3 || rand() < 0.15) continue;
    setTerrain(grid, L.x + d, L.y - 14, rand() < 0.5 ? 'wall' : 'hedgerow');
    setTerrain(grid, L.x + d, L.y + 14, rand() < 0.5 ? 'wall' : 'hedgerow');
    setTerrain(grid, L.x - 14, L.y + d, rand() < 0.5 ? 'wall' : 'hedgerow');
    setTerrain(grid, L.x + 14, L.y + d, rand() < 0.5 ? 'wall' : 'hedgerow');
  }
  // central admin block
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setTerrain(grid, L.x + dx, L.y + dy, 'urban');
  // residential blocks
  for (const [ox, oy] of [[-9, -7], [-9, 7], [9, -7], [9, 7], [0, -9], [0, 9], [-7, 0], [7, 0], [-5, -5], [5, 5], [-5, 5], [5, -5]] as [number, number][]) {
    placeUrbanCluster(grid, rand, L.x + ox, L.y + oy, 2, 0.75);
  }
  // defensive rings
  for (let dy = -10; dy <= 10; dy++) {
    if (rand() < 0.35) setTerrain(grid, L.x - 12, L.y + dy, 'sandbag');
    if (rand() < 0.35) setTerrain(grid, L.x + 12, L.y + dy, 'sandbag');
  }
  for (let dx = -10; dx <= 10; dx++) {
    if (rand() < 0.35) setTerrain(grid, L.x + dx, L.y - 12, 'sandbag');
    if (rand() < 0.35) setTerrain(grid, L.x + dx, L.y + 12, 'sandbag');
  }
  // enemy trench segments on all 4 approaches
  for (let d = -7; d <= 7; d++) {
    if (Math.abs(d) < 2) continue;
    if (rand() < 0.7) setTerrain(grid, L.x + d, L.y - 16, 'trench');
    if (rand() < 0.7) setTerrain(grid, L.x + d, L.y + 16, 'trench');
    if (rand() < 0.7) setTerrain(grid, L.x - 16, L.y + d, 'trench');
    if (rand() < 0.7) setTerrain(grid, L.x + 16, L.y + d, 'trench');
  }
  // craters and rubble from prior shelling
  for (let i = 0; i < 55; i++) {
    const x = L.x - 22 + Math.floor(rand() * 44);
    const y = L.y - 22 + Math.floor(rand() * 44);
    if (grid[y]?.[x]?.type === 'open' || grid[y]?.[x]?.type === 'tall_grass') {
      setTerrain(grid, x, y, rand() < 0.5 ? 'crater' : 'rubble');
    }
  }

  // Scatter tall_grass for concealment
  for (let i = 0; i < 700; i++) {
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
  if (isFootprintPassable(terrain, gx, gy, isVehicle, false)) return { x: worldX, y: worldY };
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
