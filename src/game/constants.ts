import { UnitStats, UnitType } from './types';

export const MAP_COLS = 60;
export const MAP_ROWS = 40;
export const CELL_SIZE = 32;
export const MAP_WIDTH = MAP_COLS * CELL_SIZE;
export const MAP_HEIGHT = MAP_ROWS * CELL_SIZE;

export const STARTING_CP = 200;
export const CP_RATE = 2; // per second
export const CP_PER_KILL = 25;

export const ENEMY_SPAWN_INTERVAL = 30; // seconds between waves
export const MAX_WAVES = 10;

export const FOG_ALPHA = 0.7;
export const UNEXPLORED_ALPHA = 0.95;

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  infantry: {
    maxHealth: 80,
    speed: 50,
    range: 150,
    damage: 12,
    armor: 5,
    sightRange: 200,
    attackCooldown: 1.0,
    cost: 50,
  },
  tank: {
    maxHealth: 250,
    speed: 35,
    range: 220,
    damage: 40,
    armor: 30,
    sightRange: 180,
    attackCooldown: 2.5,
    cost: 150,
  },
  apc: {
    maxHealth: 150,
    speed: 55,
    range: 130,
    damage: 15,
    armor: 15,
    sightRange: 190,
    attackCooldown: 0.8,
    cost: 100,
  },
  helicopter: {
    maxHealth: 100,
    speed: 80,
    range: 200,
    damage: 25,
    armor: 5,
    sightRange: 280,
    attackCooldown: 1.5,
    cost: 200,
  },
};

// Colors
export const COLORS = {
  background: '#3d4a3a',
  grid: 'rgba(255,255,255,0.05)',
  terrain: {
    open: '#5a6b52',
    urban: '#7a7a72',
    forest: '#3e5a35',
    road: '#8a8578',
    water: '#3a5a7a',
  },
  player: '#4a90d9',
  playerLight: '#6ab0f9',
  enemy: '#d94a4a',
  enemyLight: '#f96a6a',
  selection: 'rgba(74,144,217,0.3)',
  selectionBorder: '#4a90d9',
  health: '#4ad94a',
  healthLow: '#d9d94a',
  healthCritical: '#d94a4a',
  fog: 'rgba(15,20,15,0.7)',
  unexplored: 'rgba(10,15,10,0.92)',
  wreckage: '#555',
  ability: {
    recon_drone: 'rgba(74,144,217,0.25)',
    airstrike: 'rgba(217,120,44,0.4)',
    smoke_screen: 'rgba(200,200,200,0.5)',
  },
};

export const NATO_SYMBOLS: Record<UnitType, string> = {
  infantry: '⬡', // we'll draw custom symbols
  tank: '◆',
  apc: '▬',
  helicopter: '✕',
};

export const PLAYER_SPAWN: { x: number; y: number } = { x: 4, y: 20 };
export const ENEMY_SPAWN: { x: number; y: number } = { x: 55, y: 20 };
