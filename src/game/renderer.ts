import { GameState, Unit, UnitType } from './types';
import { COLORS, CELL_SIZE, MAP_COLS, MAP_ROWS, VETERANCY_NAMES } from './constants';

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
  drawDroneLinks(ctx, state);
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

      // Elevation shading
      if (cell.elevation === 2) {
        ctx.fillStyle = 'rgba(255,255,200,0.08)';
        ctx.fillRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);
      } else if (cell.elevation === 0) {
        ctx.fillStyle = 'rgba(0,0,30,0.1)';
        ctx.fillRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);
      }

      if (cell.type === 'urban') {
        ctx.fillStyle = 'rgba(90,85,80,0.7)';
        ctx.fillRect(cell.x + 4, cell.y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
        ctx.strokeStyle = 'rgba(60,55,50,0.5)';
        ctx.strokeRect(cell.x + 4, cell.y + 4, CELL_SIZE - 8, CELL_SIZE - 8);
        // Windows
        ctx.fillStyle = 'rgba(40,50,60,0.4)';
        ctx.fillRect(cell.x + 8, cell.y + 8, 4, 4);
        ctx.fillRect(cell.x + 20, cell.y + 8, 4, 4);
        ctx.fillRect(cell.x + 8, cell.y + 20, 4, 4);
        ctx.fillRect(cell.x + 20, cell.y + 20, 4, 4);
      }

      if (cell.type === 'forest') {
        ctx.fillStyle = 'rgba(30,70,25,0.5)';
        ctx.beginPath();
        ctx.arc(cell.x + CELL_SIZE / 2, cell.y + CELL_SIZE / 2, 10, 0, Math.PI * 2);
        ctx.fill();
        // Extra tree detail
        ctx.fillStyle = 'rgba(20,55,18,0.4)';
        ctx.beginPath();
        ctx.arc(cell.x + 10, cell.y + 10, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cell.x + 22, cell.y + 22, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = COLORS.grid;
      ctx.strokeRect(cell.x, cell.y, CELL_SIZE, CELL_SIZE);
    }
  }
}

function drawUnits(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const unit of state.units) {
    if (!unit.alive) continue;

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
      ctx.arc(unit.pos.x, unit.pos.y, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cover indicator
    if (unit.inCover) {
      ctx.fillStyle = 'rgba(100,200,100,0.15)';
      ctx.beginPath();
      ctx.arc(unit.pos.x, unit.pos.y, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw detailed unit model with rotation
    drawDetailedUnit(ctx, unit, color, lightColor, state);

    // Health bar
    const barW = 26;
    const barH = 3;
    const barX = unit.pos.x - barW / 2;
    const barY = unit.pos.y - 22;
    const hpRatio = unit.health / unit.maxHealth;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = hpRatio > 0.6 ? COLORS.health : hpRatio > 0.3 ? COLORS.healthLow : COLORS.healthCritical;
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    // Morale bar (thin, below health)
    if (unit.morale < 0.8) {
      const moraleW = barW * unit.morale;
      ctx.fillStyle = `rgba(200,180,50,${0.6})`;
      ctx.fillRect(barX, barY + barH + 1, moraleW, 2);
    }

    // Veterancy stars
    if (unit.veterancy > 0) {
      const vetColor = COLORS.veterancy[unit.veterancy];
      ctx.fillStyle = vetColor;
      ctx.font = '7px monospace';
      const stars = '★'.repeat(unit.veterancy);
      ctx.fillText(stars, unit.pos.x - unit.veterancy * 3.5, unit.pos.y - 26);
    }

    // Suppression indicator
    if (unit.suppression > 0.2) {
      ctx.fillStyle = `rgba(255,200,0,${unit.suppression * 0.7})`;
      ctx.font = '9px monospace';
      ctx.fillText('⚡', unit.pos.x - 4, unit.pos.y - 30);
    }

    // Drone indicator
    if (unit.droneActive) {
      ctx.fillStyle = 'rgba(74,144,217,0.8)';
      ctx.font = '8px monospace';
      ctx.fillText('🛸', unit.pos.x + 12, unit.pos.y - 14);
    }

    // Range circle for selected units
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

function drawDetailedUnit(ctx: CanvasRenderingContext2D, unit: Unit, color: string, lightColor: string, state: GameState) {
  const { x, y } = unit.pos;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(unit.facing);

  ctx.fillStyle = color;
  ctx.strokeStyle = lightColor;
  ctx.lineWidth = 1.5;

  switch (unit.type) {
    case 'infantry': {
      // Body (rounded rectangle shape)
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Helmet/head
      ctx.beginPath();
      ctx.arc(5, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Rifle barrel
      ctx.strokeStyle = lightColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, -1);
      ctx.lineTo(15, -1);
      ctx.stroke();
      // X marking (NATO infantry symbol on body)
      ctx.strokeStyle = lightColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, -3);
      ctx.lineTo(2, 3);
      ctx.moveTo(2, -3);
      ctx.lineTo(-4, 3);
      ctx.stroke();
      break;
    }
    case 'tank': {
      // Tracks
      ctx.fillStyle = 'rgba(60,70,55,0.8)';
      ctx.fillRect(-12, -9, 24, 5);
      ctx.fillRect(-12, 4, 24, 5);
      // Hull
      ctx.fillStyle = color;
      ctx.fillRect(-10, -6, 20, 12);
      ctx.strokeRect(-10, -6, 20, 12);
      // Turret
      ctx.fillStyle = lightColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Main gun barrel
      ctx.strokeStyle = lightColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(18, 0);
      ctx.stroke();
      // Muzzle brake
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(17, 0);
      ctx.lineTo(19, 0);
      ctx.stroke();
      break;
    }
    case 'apc': {
      // Wheels
      ctx.fillStyle = 'rgba(50,60,45,0.7)';
      ctx.beginPath();
      ctx.arc(-8, 7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(8, 7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-8, -7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(8, -7, 3, 0, Math.PI * 2);
      ctx.fill();
      // Hull (angular)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-11, -5);
      ctx.lineTo(11, -5);
      ctx.lineTo(13, -2);
      ctx.lineTo(13, 2);
      ctx.lineTo(11, 5);
      ctx.lineTo(-11, 5);
      ctx.lineTo(-13, 2);
      ctx.lineTo(-13, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Turret (small gun)
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
      break;
    }
    case 'helicopter': {
      // Tail boom
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(-16, 0);
      ctx.stroke();
      // Tail rotor
      ctx.strokeStyle = lightColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-16, -5);
      ctx.lineTo(-16, 5);
      ctx.stroke();
      // Body (teardrop)
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(2, 0, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Cockpit
      ctx.fillStyle = 'rgba(100,180,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(7, 0, 4, 3, 0, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      // Main rotor (animated)
      const rotorAngle = state.time * 12;
      ctx.strokeStyle = `rgba(200,200,200,0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(rotorAngle) * -14, Math.sin(rotorAngle) * -14);
      ctx.lineTo(Math.cos(rotorAngle) * 14, Math.sin(rotorAngle) * 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(Math.cos(rotorAngle + Math.PI / 2) * -14, Math.sin(rotorAngle + Math.PI / 2) * -14);
      ctx.lineTo(Math.cos(rotorAngle + Math.PI / 2) * 14, Math.sin(rotorAngle + Math.PI / 2) * 14);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

function drawDroneLinks(ctx: CanvasRenderingContext2D, state: GameState) {
  // Draw lines from units to their active drones
  for (const effect of state.activeEffects) {
    if (effect.type === 'recon_drone' && effect.sourceUnitId) {
      const unit = state.units.find(u => u.id === effect.sourceUnitId);
      if (unit && unit.alive) {
        ctx.strokeStyle = 'rgba(74,144,217,0.2)';
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
      // Animated drone icon
      const bobY = Math.sin(state.time * 3) * 3;
      ctx.fillStyle = 'rgba(74,144,217,0.7)';
      ctx.beginPath();
      ctx.moveTo(effect.pos.x, effect.pos.y + bobY - 5);
      ctx.lineTo(effect.pos.x + 6, effect.pos.y + bobY);
      ctx.lineTo(effect.pos.x, effect.pos.y + bobY + 3);
      ctx.lineTo(effect.pos.x - 6, effect.pos.y + bobY);
      ctx.closePath();
      ctx.fill();
      // Scan lines
      const scanAngle = state.time * 2;
      ctx.strokeStyle = 'rgba(74,144,217,0.15)';
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
        // Explosion with shockwave
        const progress = 1 - effect.timeLeft;
        const alpha = Math.max(0, effect.timeLeft);
        ctx.fillStyle = `rgba(255,150,50,${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(effect.pos.x, effect.pos.y, effect.radius * (0.5 + progress * 0.5), 0, Math.PI * 2);
        ctx.fill();
        // Inner fireball
        ctx.fillStyle = `rgba(255,230,100,${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(effect.pos.x, effect.pos.y, effect.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (effect.type === 'smoke_screen') {
      // Billowing smoke with multiple circles
      for (let i = 0; i < 5; i++) {
        const offsetX = Math.sin(state.time * 0.5 + i * 1.3) * 15;
        const offsetY = Math.cos(state.time * 0.7 + i * 0.9) * 10;
        const r = effect.radius * (0.4 + i * 0.12);
        ctx.fillStyle = `rgba(180,180,180,${0.12 - i * 0.015})`;
        ctx.beginPath();
        ctx.arc(effect.pos.x + offsetX, effect.pos.y + offsetY, r, 0, Math.PI * 2);
        ctx.fill();
      }
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
    ctx.save();
    ctx.translate(w.pos.x, w.pos.y);
    ctx.globalAlpha = Math.min(0.5, w.timer / 10);
    
    // Burning wreckage
    ctx.fillStyle = '#444';
    ctx.fillRect(-10, -6, 20, 12);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(-10, -6, 20, 12);
    
    // Smoke wisps
    if (w.timer > 5) {
      const smokeY = -8 - Math.sin(w.timer * 2) * 3;
      ctx.fillStyle = 'rgba(100,100,100,0.3)';
      ctx.beginPath();
      ctx.arc(0, smokeY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.restore();
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

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
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
