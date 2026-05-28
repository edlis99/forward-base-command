import { UnitStats, UnitType } from './types';

export const MAP_COLS = 60;
export const MAP_ROWS = 40;
export const CELL_SIZE = 32;
export const MAP_WIDTH = MAP_COLS * CELL_SIZE;
export const MAP_HEIGHT = MAP_ROWS * CELL_SIZE;

export const VETERANCY_THRESHOLDS = [0, 2, 5, 10];
export const VETERANCY_NAMES = ['Rookie', 'Regular', 'Veteran', 'Elite'];
export const VETERANCY_BONUSES = [1.0, 1.1, 1.2, 1.35];

export const UNIT_STATS: Record<UnitType, UnitStats & { turnRate: number; ammo: number; reloadTime: number }> = {
  infantry: {
    maxHealth: 80, speed: 50, range: 150, damage: 12, armor: 5,
    sightRange: 220, attackCooldown: 1.0, cost: 50, accuracy: 0.7, critChance: 0.08,
    turnRate: 6, ammo: 30, reloadTime: 2.5,
  },
  tank: {
    maxHealth: 250, speed: 35, range: 240, damage: 40, armor: 30,
    sightRange: 200, attackCooldown: 2.5, cost: 150, accuracy: 0.85, critChance: 0.05,
    turnRate: 1.4, ammo: 6, reloadTime: 4.0,
  },
  apc: {
    maxHealth: 150, speed: 55, range: 140, damage: 15, armor: 15,
    sightRange: 210, attackCooldown: 0.8, cost: 100, accuracy: 0.65, critChance: 0.1,
    turnRate: 2.2, ammo: 50, reloadTime: 3.0,
  },
  helicopter: {
    maxHealth: 100, speed: 80, range: 220, damage: 25, armor: 5,
    sightRange: 320, attackCooldown: 1.5, cost: 200, accuracy: 0.75, critChance: 0.12,
    turnRate: 3.0, ammo: 8, reloadTime: 3.5,
  },
};

export const STATIONARY_ACC_BONUS = 1.12;
export const MOVING_ACC_PENALTY = 0.7;

// Defense mission only
export const CP_PER_KILL = 25;
