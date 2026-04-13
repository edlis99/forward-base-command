export type UnitType = 'infantry' | 'tank' | 'apc' | 'helicopter';
export type Team = 'player' | 'enemy';
export type TerrainType = 'open' | 'urban' | 'forest' | 'road' | 'water';
export type AbilityType = 'recon_drone' | 'airstrike' | 'smoke_screen';

export interface Position {
  x: number;
  y: number;
}

export interface UnitStats {
  maxHealth: number;
  speed: number;
  range: number;
  damage: number;
  armor: number;
  sightRange: number;
  attackCooldown: number;
  cost: number;
  accuracy: number; // 0-1 base hit chance
  critChance: number; // 0-1 critical hit chance
}

export interface Unit {
  id: string;
  type: UnitType;
  team: Team;
  pos: Position;
  targetPos: Position | null;
  attackTarget: string | null;
  health: number;
  maxHealth: number;
  speed: number;
  range: number;
  damage: number;
  armor: number;
  sightRange: number;
  attackCooldown: number;
  attackTimer: number;
  suppression: number; // 0-1, reduces speed/accuracy
  alive: boolean;
  selected: boolean;
  inCover: boolean;
  accuracy: number;
  critChance: number;
  morale: number; // 0-1, affects combat effectiveness
  facing: number; // angle in radians for rotation
  kills: number; // track kills for veterancy/rewards
  veterancy: number; // 0=rookie, 1=regular, 2=veteran, 3=elite
  droneActive: boolean; // whether this unit has launched a drone
  droneTarget: Position | null; // where the drone is scouting
}

export interface TerrainCell {
  type: TerrainType;
  x: number;
  y: number;
  coverBonus: number;
  movementCost: number;
  elevation: number; // 0=low, 1=normal, 2=high — affects range/damage
}

export interface Ability {
  type: AbilityType;
  name: string;
  cooldown: number;
  currentCooldown: number;
  duration: number;
  radius: number;
  description: string;
  key: string;
  requiresUnit: boolean; // drone requires a selected unit to launch
}

export interface ActiveEffect {
  type: AbilityType;
  pos: Position;
  radius: number;
  timeLeft: number;
  delay: number;
  sourceUnitId?: string; // which unit launched this (for drones)
}

export interface Wreckage {
  pos: Position;
  type: UnitType;
  timer: number;
}

export interface EventLog {
  message: string;
  time: number;
  type: 'kill' | 'ability' | 'spawn' | 'info' | 'reward';
}

export interface GameState {
  units: Unit[];
  terrain: TerrainCell[][];
  mapWidth: number;
  mapHeight: number;
  cellSize: number;
  camera: Position;
  zoom: number;
  commandPoints: number;
  commandPointRate: number;
  abilities: Ability[];
  activeEffects: ActiveEffect[];
  wreckage: Wreckage[];
  eventLog: EventLog[];
  fogOfWar: boolean[][];
  revealed: boolean[][];
  selectionBox: { start: Position; end: Position } | null;
  activeAbility: AbilityType | null;
  gameOver: boolean;
  gameResult: 'win' | 'lose' | null;
  wave: number;
  enemySpawnTimer: number;
  time: number;
  killStreak: number; // consecutive kills without losing a unit
  totalKills: number;
  waveBonus: number; // bonus CP for completing a wave
}

export interface InputState {
  keys: Set<string>;
  mousePos: Position;
  mouseWorldPos: Position;
  isDragging: boolean;
  isPanning: boolean;
  dragStart: Position | null;
}
