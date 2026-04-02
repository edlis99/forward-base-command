import { GameState, Unit, UnitType, ActiveEffect } from './types';
import { COLORS, CELL_SIZE, MAP_COLS, MAP_ROWS } from './constants';

export function render(ctx: CanvasRenderingContext2D, state: GameState, canvasW: number, canvasH: number) {
  const { camera, zoom } = state;

  ctx.save();
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.save();
  ctx.translate(-camera.x * zoom, -camera.y * zoom);
  ctx.scale(zoom, zoom);

  drawTerrain(ctx, state);
  drawWreckage(ctx, state);
  drawEffects(ctx, state);
  drawUnits(ctx, state);
  drawSelectionBox(ctx, state);
  drawFog(ctx, state);

  ctx.restore();

  drawMinimap(ctx, state, canvasW, canvasH);
  ctx.restore();
}

function drawTerrain(ctx: CanvasRenderingContext2D, state: GameState) {
  const { terrain } = state;
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 0; x < MAP_COLS; x++) {
      const cell = terrain[y][x];
      ctx.fillStyle = COLORS.terrain[cell.type];
      ctx.fillRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);

      // Urban buildings
      if (cell.type === 'urban') {
        ctx.fillStyle = 'rgba(90,85,80,0.7)';
        ctx.fillRect(cell.x + 4, cell.y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
        ctx.strokeStyle = 'rgba(60,55,50,0.5)';
        ctx.strokeRect(cell.x + 4, cell.y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
      }

      // Forest trees
      if (cell.type === 'forest') {
        ctx.fillStyle = 'rgba(30,70,25,0.5)';
        ctx.beginPath();
        ctx.arc(cell.x + CELL_SIZE / 2, cell.y + CELL_SIZE / 2, 10, 0, Math.PI * 2);
        ctx.fill();
      }

      // Grid
      ctx.strokeStyle = COLORS.grid;
      ctx.strokeRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);
    }
  }
}

function drawUnits(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const unit of state.units) {
    if (!unit.alive) continue;

    // Don't draw enemies in fog
    if (unit.team === 'enemy') {
      const gx = Math.floor(unit.pos.x / CELL_SIZE);
      const gy = Math.floor(unit.pos.y / CELL_SIZE);
      if (gx >= 0 && gx < MAP_COLS && gy >= 0 && gy < MAP_ROWS && state.fogOfWar[gy][gx]) continue;
    }

    const isPlayer = unit.team === 'player';
    const color = isPlayer ? COLORS.player : COLORS.enemy;
    const lightColor = isPlayer ? COLORS.playerLight : COLORS.enemyLight;

    // Selection ring
    if (unit.selected) {
      ctx.strokeStyle = COLORS.selectionBorder;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(unit.pos.x, unit.pos.y, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cover indicator
    if (unit.inCover) {
      ctx.fillStyle = 'rgba(100,200,100,0.2)';
      ctx.beginPath();
      ctx.arc(unit.pos.x, unit.pos.y, 16, 0, Math.PI * 2);
      ctx.fill();
    }

    // Unit body
    drawNATOSymbol(ctx, unit, color, lightColor);

    // Health bar
    const barW = 24;
    const barH = 3;
    const barX = unit.pos.x - barW / 2;
    const barY = unit.pos.y - 20;
    const hpRatio = unit.health / unit.maxHealth;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = hpRatio > 0.6 ? COLORS.health : hpRatio > 0.3 ? COLORS.healthLow : COLORS.healthCritical;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Suppression indicator
    if (unit.suppression > 0.2) {
      ctx.fillStyle = `rgba(255,200,0,${unit.suppression * 0.6})`;
      ctx.font = '8px monospace';
      ctx.fillText('!', unit.pos.x - 2, unit.pos.y - 24);
    }

    // Range circle for selected units
    if (unit.selected) {
      ctx.strokeStyle = `rgba(74,144,217,0.15)`;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(unit.pos.x, unit.pos.y, unit.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Movement target line
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

function drawNATOSymbol(ctx: CanvasRenderingContext2D, unit: Unit, color: string, lightColor: string) {
  const { x, y } = unit.pos;
  const s = 12;

  ctx.fillStyle = color;
  ctx.strokeStyle = lightColor;
  ctx.lineWidth = 1.5;

  switch (unit.type) {
    case 'infantry':
      // Rectangle with X
      ctx.fillRect(x - s, y - s * 0.6, s * 2, s * 1.2);
      ctx.strokeRect(x - s, y - s * 0.6, s * 2, s * 1.2);
      ctx.beginPath();
      ctx.moveTo(x - s, y - s * 0.6);
      ctx.lineTo(x + s, y + s * 0.6);
      ctx.moveTo(x + s, y - s * 0.6);
      ctx.lineTo(x - s, y + s * 0.6);
      ctx.stroke();
      break;
    case 'tank':
      // Rectangle with diagonal
      ctx.fillRect(x - s, y - s * 0.6, s * 2, s * 1.2);
      ctx.strokeRect(x - s, y - s * 0.6, s * 2, s * 1.2);
      ctx.beginPath();
      ctx.moveTo(x - s, y + s * 0.6);
      ctx.lineTo(x + s, y - s * 0.6);
      ctx.stroke();
      // Diamond inside
      ctx.fillStyle = lightColor;
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
      break;
    case 'apc':
      // Rectangle with single diagonal
      ctx.fillRect(x - s, y - s * 0.6, s * 2, s * 1.2);
      ctx.strokeRect(x - s, y - s * 0.6, s * 2, s * 1.2);
      ctx.beginPath();
      ctx.moveTo(x - s, y + s * 0.6);
      ctx.lineTo(x + s, y - s * 0.6);
      ctx.stroke();
      break;
    case 'helicopter':
      // Circle with cross
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.lineTo(x + s, y);
      ctx.moveTo(x, y - s);
      ctx.lineTo(x, y + s);
      ctx.stroke();
      break;
  }
}

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
      // Drone icon
      ctx.fillStyle = 'rgba(74,144,217,0.6)';
      ctx.font = '14px monospace';
      ctx.fillText('◎', effect.pos.x - 5, effect.pos.y + 5);
    } else if (effect.type === 'airstrike') {
      if (effect.delay > 0) {
        // Warning indicator
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
        // Explosion
        ctx.fillStyle = COLORS.ability.airstrike;
        ctx.beginPath();
        ctx.arc(effect.pos.x, effect.pos.y, effect.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (effect.type === 'smoke_screen') {
      ctx.fillStyle = COLORS.ability.smoke_screen;
      ctx.beginPath();
      ctx.arc(effect.pos.x, effect.pos.y, effect.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

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

function drawWreckage(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const w of state.wreckage) {
    ctx.fillStyle = COLORS.wreckage;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(w.pos.x - 8, w.pos.y - 5, 16, 10);
    ctx.globalAlpha = 1;
  }
}

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

function drawMinimap(ctx: CanvasRenderingContext2D, state: GameState, canvasW: number, canvasH: number) {
  const mmW = 180;
  const mmH = 120;
  const mmX = canvasW - mmW - 10;
  const mmY = canvasH - mmH - 10;
  const scaleX = mmW / (MAP_COLS * CELL_SIZE);
  const scaleY = mmH / (MAP_ROWS * CELL_SIZE);

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.strokeRect(mmX, mmY, mmW, mmH);

  // Terrain
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

  // Units
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

  // Camera viewport
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    mmX + state.camera.x * scaleX,
    mmY + state.camera.y * scaleY,
    (canvasW / state.zoom) * scaleX,
    (canvasH / state.zoom) * scaleY
  );
}
