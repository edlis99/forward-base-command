export type UnitType = 'infantry' | 'tank' | 'apc' | 'helicopter';
export type Team = 'player' | 'enemy';
export type TerrainType =
  | 'open' | 'urban' | 'forest' | 'road' | 'water'
  | 'wall' | 'trench' | 'rubble' | 'sandbag'
  | 'mud' | 'crater' | 'hedgerow' | 'tall_grass' | 'gravel';
export type AbilityType = 'recon_drone' | 'airstrike' | 'smoke_screen';
export type Stance = 'hold_fire' | 'defend' | 'aggressive';
export type OrderType = 'idle' | 'move' | 'attack_move' | 'attack' | 'hold_position' | 'retreat';

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
  accuracy: number;
  critChance: number;
}

export interface Unit {
  id: string;
  type: UnitType;
  team: Team;
  pos: Position;
  vel: Position;            // current velocity (for inertia)
  targetPos: Position | null;
  waypoints: Position[];    // queued movement points (shift-click)
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
  reloadTimer: number;      // mid-burst reload (separate from cycle)
  ammo: number;             // ammo per magazine/clip
  maxAmmo: number;
  suppression: number;
  alive: boolean;
  selected: boolean;
  inCover: boolean;
  accuracy: number;
  critChance: number;
  morale: number;
  facing: number;
  turnRate: number;         // rad/s
  kills: number;
  veterancy: number;
  droneActive: boolean;
  droneTarget: Position | null;
  // Behavior
  stance: Stance;
  order: OrderType;
  homePos: Position;        // hold-position anchor
  fatigue: number;          // 0..1, builds with movement, slows speed
  stuckTimer: number;       // anti-stuck recovery
  lastDamageTime: number;
  // Vehicle / passenger
  passengers: string[];     // unit ids inside (APC)
  insideOf: string | null;  // id of vehicle this unit is in
}

export interface TerrainCell {
  type: TerrainType;
  x: number;
  y: number;
  coverBonus: number;
  movementCost: number;
  elevation: number;
  blocksLOS: boolean;      // blocks line of sight for shooting
  blocksMovement: boolean; // completely impassable (walls)
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
  requiresUnit: boolean;
}

export interface ActiveEffect {
  type: AbilityType;
  pos: Position;
  radius: number;
  timeLeft: number;
  delay: number;
  sourceUnitId?: string;
}

export interface Projectile {
  from: Position;
  to: Position;
  timer: number;
  hit: boolean;
  crit: boolean;
  team: Team;
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
  projectiles: Projectile[];
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
  killStreak: number;
  totalKills: number;
  waveBonus: number;
}

export interface InputState {
  keys: Set<string>;
  mousePos: Position;
  mouseWorldPos: Position;
  isDragging: boolean;
  isPanning: boolean;
  dragStart: Position | null;
}
