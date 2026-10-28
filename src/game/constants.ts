import { UnitStats, UnitType } from './types';

export const MAP_COLS = 440;
export const MAP_ROWS = 320;
export const CELL_SIZE = 32;
export const MAP_WIDTH = MAP_COLS * CELL_SIZE;
export const MAP_HEIGHT = MAP_ROWS * CELL_SIZE;

export const VETERANCY_THRESHOLDS = [0, 2, 5, 10];
export const VETERANCY_NAMES = ['Rookie', 'Regular', 'Veteran', 'Elite'];
export const VETERANCY_BONUSES = [1.0, 1.1, 1.2, 1.35];

export const UNIT_STATS: Record<UnitType, UnitStats & { turnRate: number; ammo: number; reloadTime: number }> = {
  infantry: {
    maxHealth: 80, speed: 28, range: 150, damage: 12, armor: 5,
    sightRange: 220, attackCooldown: 1.0, cost: 50, accuracy: 0.7, critChance: 0.08,
    turnRate: 5, ammo: 30, reloadTime: 2.5,
  },
  tank: {
    maxHealth: 250, speed: 22, range: 240, damage: 40, armor: 30,
    sightRange: 200, attackCooldown: 2.5, cost: 150, accuracy: 0.85, critChance: 0.05,
    turnRate: 1.1, ammo: 6, reloadTime: 4.0,
  },
  apc: {
    maxHealth: 150, speed: 36, range: 140, damage: 15, armor: 15,
    sightRange: 210, attackCooldown: 0.8, cost: 100, accuracy: 0.65, critChance: 0.1,
    turnRate: 1.8, ammo: 50, reloadTime: 3.0,
  },
  helicopter: {
    maxHealth: 100, speed: 55, range: 220, damage: 25, armor: 5,
    sightRange: 320, attackCooldown: 1.5, cost: 200, accuracy: 0.75, critChance: 0.12,
    turnRate: 2.5, ammo: 8, reloadTime: 3.5,
  },
};

export const STATIONARY_ACC_BONUS = 1.12;
export const MOVING_ACC_PENALTY = 0.7;

// Defense mission only
export const CP_PER_KILL = 25;


// ---- Engagement tuning ----
/** How often (s) a unit may reconsider its automatically chosen target. */
export const RETARGET_INTERVAL = 0.4;
/** A new target must outscore the current one by this much to cause a switch. */
export const RETARGET_HYSTERESIS = 0.3;
/** Longest continuous stand-and-fight before an attack-move unit pushes on (s). */
export const MAX_ENGAGE_TIME = 20;
/** How long a unit that broke contact keeps advancing before it may halt again (s). */
export const DISENGAGE_GRACE = 5;
/** Share of weapon range an ordered attacker tries to close to before firing. */
export const CHASE_STANDOFF = 0.75;
/** Seconds an ordered target may stay out of sight before the attack order lapses. */
export const TARGET_LOST_TIMEOUT = 10;
/** Relative threat of each unit type when choosing what to shoot first. */
export const TARGET_THREAT: Record<UnitType, number> = { tank: 1.0, helicopter: 0.9, apc: 0.55, infantry: 0.45 };
/** How strongly each target type is shaken by suppressive fire (infantry = 1). */
export const SUPPRESSION_RESIST: Record<UnitType, number> = { infantry: 1, apc: 0.45, tank: 0.3, helicopter: 0.35 };
/** Small arms barely rattle armour; heavy weapons (damage >= this) fully suppress. */
export const HEAVY_WEAPON_DAMAGE = 25;
export const SMALL_ARMS_VS_VEHICLE = 0.3;
