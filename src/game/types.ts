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
}

export interface TerrainCell {
  type: TerrainType;
  x: number;
  y: number;
  coverBonus: number;
  movementCost: number;
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
}

export interface ActiveEffect {
  type: AbilityType;
  pos: Position;
  radius: number;
  timeLeft: number;
  delay: number; // for airstrike delay
}

export interface Wreckage {
  pos: Position;
  type: UnitType;
  timer: number;
}

export interface EventLog {
  message: string;
  time: number;
  type: 'kill' | 'ability' | 'spawn' | 'info';
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
}

export interface InputState {
  keys: Set<string>;
  mousePos: Position;
  mouseWorldPos: Position;
  isDragging: boolean;
  isPanning: boolean;
  dragStart: Position | null;
}
