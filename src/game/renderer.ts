import { GameState, Unit, UnitType, TerrainCell } from './types';
import { COLORS, CELL_SIZE, MAP_COLS, MAP_ROWS, VETERANCY_NAMES } from './constants';

// Pseudo-3D: shadows are offset down-right; "height" extrudes along same vector.
const LIGHT = { dx: 0.55, dy: 0.55 };

export function render(ctx: CanvasRenderingContext2D, state: GameState, canvasW: number, canvasH: number) {
  const { camera, zoom } = state;

  ctx.save();
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Sky-to-ground gradient backdrop for depth
  const grad = ctx.createLinearGradient(0, 0, 0, canvasH);
  grad.addColorStop(0, '#2a3528');
  grad.addColorStop(1, '#1a221a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.translate(-camera.x * zoom, -camera.y * zoom);
  ctx.scale(zoom, zoom);

  drawTerrain(ctx, state);
  drawTerrainExtrusions(ctx, state);
  drawWreckage(ctx, state);
  drawEffects(ctx, state);
  drawProjectiles(ctx, state);
  drawUnitShadows(ctx, state);
  drawUnits(ctx, state);
  drawDroneLinks(ctx, state);
  drawSelectionBox(ctx, state);
  drawFog(ctx, state);

  ctx.restore();

  drawMinimap(ctx, state, canvasW, canvasH);
  ctx.restore();
}

// ---------- TERRAIN (ground layer, flat) ----------
function drawTerrain(ctx: CanvasRenderingContext2D, state: GameState) {
  const { terrain } = state;
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const cell = terrain[y][x];

      // Ground base color, modulated by elevation
      let base = COLORS.terrain[cell.type];
      ctx.fillStyle = base;
      ctx.fillRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);

      // Elevation tint
      if (cell.elevation === 2) {
        ctx.fillStyle = 'rgba(255,240,200,0.08)';
        ctx.fillRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);
      } else if (cell.elevation === 0) {
        ctx.fillStyle = 'rgba(0,0,30,0.18)';
        ctx.fillRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);
      }

      // Flat ground details (non-extruded terrain)
      switch (cell.type) {
        case 'road': {
          // Dashed center line
          ctx.strokeStyle = 'rgba(230,220,170,0.35)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(cell.x + CELL_SIZE / 2, cell.y);
          ctx.lineTo(cell.x + CELL_SIZE / 2, cell.y + CELL_SIZE);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case 'water': {
          // Wave shimmer
          ctx.strokeStyle = 'rgba(180,220,255,0.25)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          const t = state.time * 1.5 + (cell.x + cell.y) * 0.05;
          for (let i = 0; i < 3; i++) {
            const wy = cell.y + 8 + i * 9 + Math.sin(t + i) * 1.5;
            ctx.moveTo(cell.x + 2, wy);
            ctx.lineTo(cell.x + CELL_SIZE - 2, wy);
          }
          ctx.stroke();
          break;
        }
        case 'trench': {
          // Trench is dug-down: dark inner pit + raised dirt rim handled in extrusions
          ctx.fillStyle = '#2a2015';
          ctx.fillRect(cell.x + 5, cell.y + 5, CELL_SIZE - 10, CELL_SIZE - 10);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(cell.x + 7, cell.y + 7, CELL_SIZE - 14, CELL_SIZE - 14);
          break;
        }
        case 'rubble': {
          ctx.fillStyle = 'rgba(60,55,45,0.35)';
          ctx.fillRect(cell.x + 4, cell.y + 6, CELL_SIZE - 8, CELL_SIZE - 12);
          break;
        }
      }

      // Subtle grid
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);
    }
  }
}

// ---------- TERRAIN EXTRUSIONS (vertical 3D look) ----------
function drawTerrainExtrusions(ctx: CanvasRenderingContext2D, state: GameState) {
  const { terrain } = state;
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const cell = terrain[y][x];
      const h = extrusionHeight(cell);
      if (h <= 0) continue;

      switch (cell.type) {
        case 'urban':
          drawBuilding(ctx, cell, h);
          break;
        case 'wall':
          drawWall(ctx, cell, h);
          break;
        case 'sandbag':
          drawSandbags(ctx, cell, h);
          break;
        case 'forest':
          drawTree(ctx, cell, h, state.time);
          break;
        case 'rubble':
          drawRubble(ctx, cell, h);
          break;
        case 'hedgerow':
          drawHedgerow(ctx, cell, h, state.time);
          break;
      }
    }
  }
}

function drawHedgerow(ctx: CanvasRenderingContext2D, cell: TerrainCell, h: number, time: number) {
  const sx = LIGHT.dx * h;
  const sy = LIGHT.dy * h;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(cell.x + 2 + sx, cell.y + 2 + sy, CELL_SIZE - 4, CELL_SIZE - 4);
  // Hedge mass
  for (let i = 0; i < 5; i++) {
    const cx = cell.x + 6 + i * 5 + Math.sin(time + i) * 0.5;
    const cy = cell.y + CELL_SIZE / 2 - h * 0.5;
    ctx.fillStyle = '#2c4828';
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3e6235';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(160,200,120,0.3)';
    ctx.beginPath();
    ctx.arc(cx - 1, cy - 1, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Base trunk hint
  ctx.fillStyle = 'rgba(40,30,20,0.5)';
  ctx.fillRect(cell.x + 4, cell.y + CELL_SIZE - 6, CELL_SIZE - 8, 3);
}

function extrusionHeight(cell: TerrainCell): number {
  switch (cell.type) {
    case 'urban': return 18 + (cell.elevation === 2 ? 6 : 0);
    case 'wall': return 12;
    case 'sandbag': return 6;
    case 'forest': return 14;
    case 'rubble': return 4;
    default: return 0;
  }
}

function drawBuilding(ctx: CanvasRenderingContext2D, cell: TerrainCell, h: number) {
  const px = cell.x + 3;
  const py = cell.y + 3;
  const w = CELL_SIZE - 6;
  const d = CELL_SIZE - 6;
  const sx = LIGHT.dx * h;
  const sy = LIGHT.dy * h;

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(px, py + d);
  ctx.lineTo(px + w, py + d);
  ctx.lineTo(px + w + sx, py + d + sy);
  ctx.lineTo(px + sx, py + d + sy);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(px + w, py);
  ctx.lineTo(px + w, py + d);
  ctx.lineTo(px + w + sx, py + d + sy);
  ctx.lineTo(px + w + sx, py + sy);
  ctx.closePath();
  ctx.fill();

  // Side walls (extrusion) — drawn as quads going "up" (negative y) to fake height
  // Right wall
  ctx.fillStyle = '#5a544c';
  ctx.beginPath();
  ctx.moveTo(px + w, py);
  ctx.lineTo(px + w, py + d);
  ctx.lineTo(px + w + 0, py + d - h * 0.0); // base
  ctx.closePath();
  // Better: draw the extruded box top
  // Top face (roof) shifted up by h
  const rx = px;
  const ry = py - h;
  ctx.fillStyle = '#7a7268';
  ctx.fillRect(rx, ry, w, d);
  // Roof border
  ctx.strokeStyle = '#3a342e';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, w, d);

  // Front face (facing down)
  ctx.fillStyle = '#5e574e';
  ctx.beginPath();
  ctx.moveTo(px, py + d);
  ctx.lineTo(px + w, py + d);
  ctx.lineTo(px + w, py + d - h);
  ctx.lineTo(px, py + d - h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2e2a25';
  ctx.stroke();

  // Right face
  ctx.fillStyle = '#4a443c';
  ctx.beginPath();
  ctx.moveTo(px + w, py);
  ctx.lineTo(px + w, py + d);
  ctx.lineTo(px + w, py + d - h);
  ctx.lineTo(px + w, py - h);
  ctx.closePath();
  ctx.fill();

  // Windows on front face
  ctx.fillStyle = 'rgba(120,160,190,0.55)';
  const winRows = 2;
  const winCols = 3;
  const ww = 4, wh = 4;
  for (let r = 0; r < winRows; r++) {
    for (let c = 0; c < winCols; c++) {
      const wx = px + 4 + c * ((w - 8) / (winCols - 1)) - ww / 2;
      const wy = py + d - h + 4 + r * 6;
      ctx.fillRect(wx, wy, ww, wh);
    }
  }
  // Roof detail
  ctx.fillStyle = 'rgba(40,38,32,0.4)';
  ctx.fillRect(rx + 4, ry + 4, w - 8, 3);
  ctx.fillRect(rx + w / 2 - 2, ry + 4, 4, d - 8);
}

function drawWall(ctx: CanvasRenderingContext2D, cell: TerrainCell, h: number) {
  const px = cell.x + 2;
  const py = cell.y + 2;
  const w = CELL_SIZE - 4;
  const d = CELL_SIZE - 4;
  const sx = LIGHT.dx * h;
  const sy = LIGHT.dy * h;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(px, py + d);
  ctx.lineTo(px + w, py + d);
  ctx.lineTo(px + w + sx, py + d + sy);
  ctx.lineTo(px + sx, py + d + sy);
  ctx.closePath();
  ctx.fill();

  // Front face
  ctx.fillStyle = '#4a4540';
  ctx.fillRect(px, py + d - h, w, h);
  ctx.strokeStyle = '#2a2520';
  ctx.lineWidth = 1;
  ctx.strokeRect(px, py + d - h, w, h);

  // Top
  ctx.fillStyle = '#6a6258';
  ctx.fillRect(px, py - h + d - h, w, d - (d - h)); // tiny top strip
  ctx.fillRect(px, py - h, w, d);
  ctx.strokeStyle = '#2e2a25';
  ctx.strokeRect(px, py - h, w, d);

  // Brick pattern
  ctx.strokeStyle = 'rgba(80,70,60,0.4)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(px, py + d - h + i * 4);
    ctx.lineTo(px + w, py + d - h + i * 4);
    ctx.stroke();
  }
}

function drawSandbags(ctx: CanvasRenderingContext2D, cell: TerrainCell, h: number) {
  const sx = LIGHT.dx * h;
  const sy = LIGHT.dy * h;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cell.x + CELL_SIZE / 2 + sx, cell.y + CELL_SIZE / 2 + sy, CELL_SIZE / 2 - 2, CELL_SIZE / 2 - 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stacked sandbags (two rows, raised)
  const colors = ['#7a6f55', '#8a7f65'];
  for (let row = 0; row < 2; row++) {
    const yBase = cell.y + 8 + row * 10 - h * 0.4;
    for (let i = 0; i < 3; i++) {
      const xBase = cell.x + 4 + i * 9 + (row % 2 ? 4 : 0);
      ctx.fillStyle = colors[row];
      ctx.beginPath();
      ctx.ellipse(xBase + 4, yBase, 5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,35,25,0.5)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
}

function drawTree(ctx: CanvasRenderingContext2D, cell: TerrainCell, h: number, time: number) {
  const sx = LIGHT.dx * h;
  const sy = LIGHT.dy * h;
  const cx = cell.x + CELL_SIZE / 2;
  const cy = cell.y + CELL_SIZE / 2;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx + sx, cy + sy + 4, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Trunk
  ctx.fillStyle = '#4a3520';
  ctx.fillRect(cx - 1.5, cy - 2, 3, 6);

  // Canopy (raised up by h to fake height) — sway
  const sway = Math.sin(time * 0.8 + cx * 0.05) * 1.2;
  ctx.fillStyle = '#2a4a22';
  ctx.beginPath();
  ctx.arc(cx + sway, cy - h + 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a6230';
  ctx.beginPath();
  ctx.arc(cx + sway - 4, cy - h - 1, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + sway + 5, cy - h + 4, 5, 0, Math.PI * 2);
  ctx.fill();
  // Highlight
  ctx.fillStyle = 'rgba(180,220,140,0.25)';
  ctx.beginPath();
  ctx.arc(cx + sway - 3, cy - h, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawRubble(ctx: CanvasRenderingContext2D, cell: TerrainCell, h: number) {
  const sx = LIGHT.dx * h;
  const sy = LIGHT.dy * h;
  // Chunks with shadows
  const chunks = [
    { x: 6, y: 10, w: 8, h: 5 },
    { x: 18, y: 16, w: 9, h: 4 },
    { x: 9, y: 20, w: 6, h: 6 },
  ];
  for (const c of chunks) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(cell.x + c.x + sx, cell.y + c.y + sy, c.w, c.h);
    ctx.fillStyle = '#807870';
    ctx.fillRect(cell.x + c.x, cell.y + c.y - h * 0.3, c.w, c.h);
    ctx.strokeStyle = '#3a3530';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cell.x + c.x, cell.y + c.y - h * 0.3, c.w, c.h);
  }
}

// ---------- PROJECTILES ----------
function drawProjectiles(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const proj of state.projectiles) {
    const alpha = Math.min(1, proj.timer * 5);

    if (proj.crit) {
      ctx.strokeStyle = `rgba(255,180,50,${alpha})`;
      ctx.lineWidth = 3;
    } else if (proj.hit) {
      ctx.strokeStyle = proj.team === 'player'
        ? `rgba(200,220,255,${alpha})`
        : `rgba(255,200,150,${alpha})`;
      ctx.lineWidth = 1.5;
    } else {
      ctx.strokeStyle = `rgba(220,220,220,${alpha * 0.4})`;
      ctx.lineWidth = 1;
    }

    ctx.beginPath();
    ctx.moveTo(proj.from.x, proj.from.y);
    ctx.lineTo(proj.to.x, proj.to.y);
    ctx.stroke();

    if (proj.hit && proj.timer < 0.1) {
      const flashSize = proj.crit ? 8 : 4;
      ctx.fillStyle = proj.crit ? `rgba(255,200,50,${alpha})` : `rgba(255,255,200,${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(proj.to.x, proj.to.y, flashSize, 0, Math.PI * 2);
      ctx.fill();
    }

    if (proj.timer > 0.15) {
      ctx.fillStyle = `rgba(255,230,150,${alpha * 0.6})`;
      ctx.beginPath();
      ctx.arc(proj.from.x, proj.from.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- UNIT SHADOWS (drawn separately so all shadows are below all units) ----------
function drawUnitShadows(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const unit of state.units) {
    if (!unit.alive) continue;
    if (unit.team === 'enemy') {
      const gx = Math.floor(unit.pos.x / CELL_SIZE);
      const gy = Math.floor(unit.pos.y / CELL_SIZE);
      if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && state.fogOfWar[gy][gx]) continue;
    }
    const elev = unit.type === 'helicopter' ? 28 : 4;
    const sx = LIGHT.dx * elev;
    const sy = LIGHT.dy * elev;
    ctx.fillStyle = `rgba(0,0,0,${unit.type === 'helicopter' ? 0.28 : 0.4})`;
    ctx.beginPath();
    const rx = unit.type === 'tank' ? 14 : unit.type === 'apc' ? 13 : unit.type === 'helicopter' ? 11 : 7;
    const ry = unit.type === 'tank' ? 8 : unit.type === 'apc' ? 7 : unit.type === 'helicopter' ? 6 : 5;
    ctx.ellipse(unit.pos.x + sx, unit.pos.y + sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- UNITS ----------
function drawUnits(ctx: CanvasRenderingContext2D, state: GameState) {
  // Sort by Y for fake depth
  const sorted = [...state.units].filter(u => u.alive).sort((a, b) => a.pos.y - b.pos.y);
  for (const unit of sorted) {
    if (unit.team === 'enemy') {
      const gx = Math.floor(unit.pos.x / CELL_SIZE);
      const gy = Math.floor(unit.pos.y / CELL_SIZE);
      if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && state.fogOfWar[gy][gx]) continue;
    }

    const isPlayer = unit.team === 'player';
    const color = isPlayer ? COLORS.player : COLORS.enemy;
    const lightColor = isPlayer ? COLORS.playerLight : COLORS.enemyLight;

    if (unit.selected) {
      ctx.strokeStyle = COLORS.selectionBorder;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.ellipse(unit.pos.x, unit.pos.y + 3, 18, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (unit.inCover) {
      ctx.fillStyle = 'rgba(100,200,100,0.18)';
      ctx.beginPath();
      ctx.ellipse(unit.pos.x, unit.pos.y + 3, 16, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawDetailedUnit(ctx, unit, color, lightColor, state);

    // Health bar
    const barW = 26, barH = 3;
    const barX = unit.pos.x - barW / 2;
    const barY = unit.pos.y - (unit.type === 'helicopter' ? 30 : 22);
    const hpRatio = unit.health / unit.maxHealth;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = hpRatio > 0.6 ? COLORS.health : hpRatio > 0.3 ? COLORS.healthLow : COLORS.healthCritical;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    if (unit.morale < 0.8) {
      const moraleW = barW * unit.morale;
      ctx.fillStyle = `rgba(200,180,50,0.6)`;
      ctx.fillRect(barX, barY + barH + 1, moraleW, 2);
    }

    if (unit.veterancy > 0) {
      const vetColor = COLORS.veterancy[unit.veterancy];
      ctx.fillStyle = vetColor;
      ctx.font = '7px monospace';
      const stars = '★'.repeat(unit.veterancy);
      ctx.fillText(stars, unit.pos.x - unit.veterancy * 3.5, barY - 4);
    }

    if (unit.suppression > 0.2) {
      ctx.fillStyle = `rgba(255,200,0,${unit.suppression * 0.7})`;
      ctx.font = '9px monospace';
      ctx.fillText('⚡', unit.pos.x - 4, barY - 10);
    }

    if (unit.droneActive) {
      ctx.fillStyle = 'rgba(74,144,217,0.8)';
      ctx.font = '8px monospace';
      ctx.fillText('🛸', unit.pos.x + 12, barY);
    }

    if (unit.selected) {
      ctx.strokeStyle = `rgba(74,144,217,0.12)`;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(unit.pos.x, unit.pos.y, unit.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (unit.targetPos) {
        ctx.strokeStyle = 'rgba(74,144,217,0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(unit.pos.x, unit.pos.y);
        ctx.lineTo(unit.targetPos.x, unit.targetPos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

// Helper: lighten/darken a hex color
function shade(hex: string, amt: number): string {
  const c = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(c.substring(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(c.substring(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(c.substring(4, 6), 16) + amt));
  return `rgb(${r},${g},${b})`;
}

function drawDetailedUnit(ctx: CanvasRenderingContext2D, unit: Unit, color: string, lightColor: string, state: GameState) {
  const { x, y } = unit.pos;
  const dark = shade(color, -50);
  const mid = shade(color, -20);
  const hi = shade(color, 30);

  ctx.save();
  ctx.translate(x, y);

  switch (unit.type) {
    case 'infantry': {
      // Body (faces movement direction). Top-down 3/4 view.
      ctx.rotate(unit.facing);
      // Backpack
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(-3, 0, 3, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Torso
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Shoulder highlight
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.ellipse(0, -2, 5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Helmet
      ctx.fillStyle = shade(color, -30);
      ctx.beginPath();
      ctx.arc(3, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.7;
      ctx.stroke();
      // Helmet shine
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(4, -1, 1.2, 0, Math.PI * 2);
      ctx.fill();
      // Rifle
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(5, -1);
      ctx.lineTo(13, -2);
      ctx.stroke();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(12, -2.5, 2, 1);
      break;
    }

    case 'tank': {
      ctx.rotate(unit.facing);
      // Tracks (left/right) with segmented look
      ctx.fillStyle = '#1f231d';
      ctx.fillRect(-13, -10, 26, 4);
      ctx.fillRect(-13, 6, 26, 4);
      ctx.strokeStyle = '#0e110d';
      ctx.lineWidth = 0.5;
      for (let i = -12; i < 13; i += 3) {
        ctx.beginPath();
        ctx.moveTo(i, -10); ctx.lineTo(i, -6);
        ctx.moveTo(i, 6); ctx.lineTo(i, 10);
        ctx.stroke();
      }
      // Hull (lower)
      ctx.fillStyle = dark;
      ctx.fillRect(-11, -7, 22, 14);
      // Hull top with bevel
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.moveTo(-9, -6);
      ctx.lineTo(9, -6);
      ctx.lineTo(11, 0);
      ctx.lineTo(9, 6);
      ctx.lineTo(-9, 6);
      ctx.lineTo(-11, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Hull highlight
      ctx.fillStyle = hi;
      ctx.fillRect(-8, -5, 16, 2);

      // Turret base shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(0, 1, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Turret
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.stroke();
      // Turret hatch
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(-2, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // Cannon
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(4, -1.2, 16, 2.4);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(19, -1.6, 2, 3.2);
      // Antenna
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-5, -3);
      ctx.lineTo(-9, -8);
      ctx.stroke();
      break;
    }

    case 'apc': {
      ctx.rotate(unit.facing);
      // Wheels
      ctx.fillStyle = '#181a16';
      for (const wx of [-9, -3, 3, 9]) {
        for (const wy of [-7, 7]) {
          ctx.beginPath();
          ctx.ellipse(wx, wy, 2.5, 3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Hull lower
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-12, -5);
      ctx.lineTo(11, -5);
      ctx.lineTo(14, 0);
      ctx.lineTo(11, 5);
      ctx.lineTo(-12, 5);
      ctx.lineTo(-14, 0);
      ctx.closePath();
      ctx.fill();
      // Hull top
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(9, -4);
      ctx.lineTo(12, 0);
      ctx.lineTo(9, 4);
      ctx.lineTo(-10, 4);
      ctx.lineTo(-12, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Highlight strip
      ctx.fillStyle = hi;
      ctx.fillRect(-9, -3, 17, 1.5);
      // Mini turret
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(2, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      // Gun
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(4, -0.8, 10, 1.6);
      // Rear hatch
      ctx.fillStyle = dark;
      ctx.fillRect(-12, -2, 2, 4);
      break;
    }

    case 'helicopter': {
      // Helicopter is "in the air" — its ground shadow already drawn separately.
      // Render slightly larger and with parallax offset to fake altitude.
      const altOffset = -6;
      ctx.translate(0, altOffset);
      ctx.rotate(unit.facing);

      // Tail boom
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.moveTo(-4, -1.5);
      ctx.lineTo(-18, -0.8);
      ctx.lineTo(-18, 0.8);
      ctx.lineTo(-4, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Tail fin
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-18, -1);
      ctx.lineTo(-21, -4);
      ctx.lineTo(-19, 0);
      ctx.lineTo(-21, 4);
      ctx.lineTo(-18, 1);
      ctx.closePath();
      ctx.fill();

      // Tail rotor
      const tailRot = state.time * 30;
      ctx.strokeStyle = 'rgba(180,180,180,0.6)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-21 + Math.cos(tailRot) * 4, -2 + Math.sin(tailRot) * 4);
      ctx.lineTo(-21 - Math.cos(tailRot) * 4, -2 - Math.sin(tailRot) * 4);
      ctx.stroke();

      // Main body
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.ellipse(2, 0, 9, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Top highlight
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.ellipse(2, -2.5, 7, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cockpit canopy
      const grad = ctx.createLinearGradient(4, -3, 10, 3);
      grad.addColorStop(0, 'rgba(180,220,255,0.85)');
      grad.addColorStop(1, 'rgba(60,90,130,0.7)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(7, 0, 4.5, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // Skids
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-3, -6); ctx.lineTo(8, -6);
      ctx.moveTo(-3, 6); ctx.lineTo(8, 6);
      ctx.stroke();

      // Rotor wash blur (under)
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();

      // Spinning main rotor (motion blur disc)
      const rotorAngle = state.time * 18;
      ctx.fillStyle = 'rgba(180,180,180,0.18)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Two crossed blades
      ctx.strokeStyle = `rgba(220,220,220,0.55)`;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 2; i++) {
        const a = rotorAngle + i * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * -16, Math.sin(a) * -16 * 0.25);
        ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16 * 0.25);
        ctx.stroke();
      }
      // Rotor hub
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

// ---------- DRONE LINKS ----------
function drawDroneLinks(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const effect of state.activeEffects) {
    if (effect.type === 'recon_drone' && effect.sourceUnitId) {
      const unit = state.units.find(u => u.id === effect.sourceUnitId);
      if (unit && unit.alive) {
        ctx.strokeStyle = 'rgba(74,144,217,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(unit.pos.x, unit.pos.y);
        ctx.lineTo(effect.pos.x, effect.pos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

// ---------- EFFECTS ----------
function drawEffects(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const effect of state.activeEffects) {
    if (effect.type === 'recon_drone') {
      ctx.strokeStyle = COLORS.ability.recon_drone;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(effect.pos.x, effect.pos.y, effect.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Drone shadow on ground
      const droneAlt = 18;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(effect.pos.x + LIGHT.dx * droneAlt, effect.pos.y + LIGHT.dy * droneAlt, 5, 2, 0, 0, Math.PI * 2);
      ctx.fill();

      const bobY = Math.sin(state.time * 3) * 2 - droneAlt;
      // Drone body (quadcopter top-down)
      ctx.save();
      ctx.translate(effect.pos.x, effect.pos.y + bobY);
      ctx.rotate(state.time * 0.5);
      // Arms
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-6, -6); ctx.lineTo(6, 6);
      ctx.moveTo(-6, 6); ctx.lineTo(6, -6);
      ctx.stroke();
      // Rotors
      ctx.fillStyle = 'rgba(150,180,220,0.5)';
      for (const [px, py] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) {
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Body
      ctx.fillStyle = '#3a4a5a';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(74,144,217,0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Scan lines
      const scanAngle = state.time * 2;
      ctx.strokeStyle = 'rgba(74,144,217,0.18)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const a = scanAngle + i * Math.PI * 2 / 3;
        ctx.beginPath();
        ctx.moveTo(effect.pos.x, effect.pos.y + bobY);
        ctx.lineTo(effect.pos.x + Math.cos(a) * effect.radius * 0.8, effect.pos.y + bobY + Math.sin(a) * effect.radius * 0.8);
        ctx.stroke();
      }
    } else if (effect.type === 'airstrike') {
      if (effect.delay > 0) {
        const flash = Math.sin(state.time * 10) > 0;
        ctx.strokeStyle = flash ? 'rgba(255,100,50,0.8)' : 'rgba(255,100,50,0.3)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(effect.pos.x, effect.pos.y, effect.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,100,50,0.7)';
        ctx.font = '10px monospace';
        ctx.fillText(`${effect.delay.toFixed(1)}s`, effect.pos.x - 10, effect.pos.y - effect.radius - 5);
      } else {
        const progress = 1 - effect.timeLeft;
        const alpha = Math.max(0, effect.timeLeft);
        // Shockwave ring
        ctx.strokeStyle = `rgba(255,200,100,${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(effect.pos.x, effect.pos.y, effect.radius * (0.5 + progress * 0.7), 0, Math.PI * 2);
        ctx.stroke();
        // Fireball
        const grad = ctx.createRadialGradient(effect.pos.x, effect.pos.y, 2, effect.pos.x, effect.pos.y, effect.radius);
        grad.addColorStop(0, `rgba(255,255,200,${alpha})`);
        grad.addColorStop(0.4, `rgba(255,150,50,${alpha * 0.8})`);
        grad.addColorStop(1, `rgba(80,40,20,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(effect.pos.x, effect.pos.y, effect.radius * (0.5 + progress * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (effect.type === 'smoke_screen') {
      for (let i = 0; i < 7; i++) {
        const offsetX = Math.sin(state.time * 0.5 + i * 1.3) * 18;
        const offsetY = Math.cos(state.time * 0.7 + i * 0.9) * 12;
        const r = effect.radius * (0.4 + i * 0.1);
        const grad = ctx.createRadialGradient(
          effect.pos.x + offsetX, effect.pos.y + offsetY, 0,
          effect.pos.x + offsetX, effect.pos.y + offsetY, r
        );
        grad.addColorStop(0, `rgba(220,220,220,${0.18 - i * 0.018})`);
        grad.addColorStop(1, `rgba(180,180,180,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(effect.pos.x + offsetX, effect.pos.y + offsetY, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ---------- FOG ----------
function drawFog(ctx: CanvasRenderingContext2D, state: GameState) {
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      if (state.fogOfWar[y][x]) {
        ctx.fillStyle = state.revealed[y][x] ? COLORS.fog : COLORS.unexplored;
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
  }
}

// ---------- WRECKAGE ----------
function drawWreckage(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const w of state.wreckage) {
    ctx.save();
    ctx.translate(w.pos.x, w.pos.y);
    const fade = Math.min(1, w.timer / 1.2);
    ctx.globalAlpha = Math.max(0.2, 1 - w.timer / 30);

    // Scorched ground
    ctx.fillStyle = 'rgba(20,15,10,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 16, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hulk
    ctx.fillStyle = '#3a342e';
    ctx.fillRect(-11, -7, 22, 14);
    ctx.strokeStyle = '#1a1612';
    ctx.lineWidth = 1;
    ctx.strokeRect(-11, -7, 22, 14);
    // Burnt detail
    ctx.fillStyle = '#1a1612';
    ctx.fillRect(-6, -3, 12, 6);

    // Smoke plumes
    for (let i = 0; i < 3; i++) {
      const t = w.timer * 1.2 + i;
      const sy = -8 - t * 2;
      const sx = Math.sin(t) * 3;
      const r = 3 + i * 1.5 + t * 0.3;
      const a = Math.max(0, 0.4 - t * 0.04 - i * 0.05);
      ctx.fillStyle = `rgba(60,55,50,${a})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Flame flicker (early)
    if (w.timer < 4) {
      const fa = (4 - w.timer) / 4;
      ctx.fillStyle = `rgba(255,150,40,${fa * 0.7})`;
      ctx.beginPath();
      ctx.arc(Math.sin(w.timer * 8) * 2, -3, 3 + Math.sin(w.timer * 6), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,230,120,${fa * 0.6})`;
      ctx.beginPath();
      ctx.arc(0, -3, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------- SELECTION BOX ----------
function drawSelectionBox(ctx: CanvasRenderingContext2D, state: GameState) {
  if (!state.selectionBox) return;
  const { start, end } = state.selectionBox;
  ctx.strokeStyle = COLORS.selectionBorder;
  ctx.fillStyle = COLORS.selection;
  ctx.lineWidth = 1;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
}

// ---------- MINIMAP ----------
function drawMinimap(ctx: CanvasRenderingContext2D, state: GameState, canvasW: number, canvasH: number) {
  const mmW = 180;
  const mmH = 120;
  const mmX = canvasW - mmW - 10;
  const mmY = canvasH - mmH - 10;
  const scaleX = mmW / (MAP_COLS * CELL_SIZE);
  const scaleY = mmH / (MAP_ROWS * CELL_SIZE);

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.strokeRect(mmX, mmY, mmW, mmH);

  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      if (!state.revealed[y][x]) continue;
      const cell = state.terrain[y][x];
      ctx.fillStyle = COLORS.terrain[cell.type];
      ctx.globalAlpha = state.fogOfWar[y][x] ? 0.3 : 0.7;
      ctx.fillRect(mmX + x * CELL_SIZE * scaleX, mmY + y * CELL_SIZE * scaleY, Math.ceil(CELL_SIZE * scaleX), Math.ceil(CELL_SIZE * scaleY));
    }
  }
  ctx.globalAlpha = 1;

  for (const unit of state.units) {
    if (!unit.alive) continue;
    if (unit.team === 'enemy') {
      const gx = Math.floor(unit.pos.x / CELL_SIZE);
      const gy = Math.floor(unit.pos.y / CELL_SIZE);
      if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && state.fogOfWar[gy][gx]) continue;
    }
    ctx.fillStyle = unit.team === 'player' ? COLORS.player : COLORS.enemy;
    ctx.fillRect(mmX + unit.pos.x * scaleX - 1, mmY + unit.pos.y * scaleY - 1, 3, 3);
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    mmX + state.camera.x * scaleX,
    mmY + state.camera.y * scaleY,
    (canvasW / state.zoom) * scaleX,
    (canvasH / state.zoom) * scaleY
  );
}
