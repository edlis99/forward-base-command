export type UnitType = 'infantry' | 'tank' | 'apc' | 'helicopter';
export type Team = 'player' | 'enemy';
export type TerrainType =
  | 'open' | 'urban' | 'forest' | 'road' | 'water'
  | 'wall' | 'trench' | 'rubble' | 'sandbag'
  | 'mud' | 'crater' | 'hedgerow' | 'tall_grass' | 'gravel';
export type Stance = 'hold_fire' | 'tight' | 'defend' | 'aggressive';
export type OrderType = 'idle' | 'move' | 'attack_move' | 'attack' | 'hold_position' | 'retreat' | 'patrol';
export type MissionId = 'assault' | 'defend' | 'recon' | 'ambush';
export type ObjectiveStatus = 'active' | 'complete' | 'failed';
export type MapLayoutId = 'farmhouse_complex' | 'village_crossroads' | 'forest_outpost' | 'desert_road';

export interface Position { x: number; y: number; }

export interface UnitStats {
  maxHealth: number; speed: number; range: number; damage: number; armor: number;
  sightRange: number; attackCooldown: number; cost: number; accuracy: number; critChance: number;
}

export interface Unit {
  id: string;
  type: UnitType;
  team: Team;
  pos: Position;
  vel: Position;
  targetPos: Position | null;
  path: Position[];          // A* path (smoothed waypoints toward targetPos)
  waypoints: Position[];     // queued user waypoints
  attackTarget: string | null;
  health: number; maxHealth: number;
  speed: number; range: number; damage: number; armor: number;
  sightRange: number;
  attackCooldown: number; attackTimer: number;
  reloadTimer: number; ammo: number; maxAmmo: number;
  suppression: number;
  alive: boolean;
  selected: boolean;
  inCover: boolean;
  accuracy: number; critChance: number;
  morale: number;
  facing: number; turnRate: number;
  kills: number; veterancy: number;
  stance: Stance; order: OrderType;
  homePos: Position;
  patrolPoints?: Position[];  // for patrol orders
  patrolIndex?: number;
  fatigue: number;
  stuckTimer: number;
  lastDamageTime: number;
  passengers: string[]; insideOf: string | null;
  // movement
  finalDest: Position | null;        // true destination for re-path
  lastProgressDist: number;          // distance to current targetPos at last progress check
  lastProgressTime: number;          // sim time of last progress
  // behavior
  reactionDelay: number;             // seconds until allowed to act on new contact
  prone: boolean;                    // suppressed/pinned visual + accuracy
  ambushReady: boolean;              // hold-fire ambush trigger consumed?
  rallyUntil: number;                // sim time until rally complete
  // awareness
  spottedByEnemy: boolean;    // is this unit currently visible to opposing team
  detectionLevel: number;     // 0..1 builds toward 1 = fully spotted
  lastKnownPos: Position | null; // for ghost markers when LOS lost
  lastKnownTime: number;
}

export interface TerrainCell {
  type: TerrainType; x: number; y: number;
  coverBonus: number; concealment: number; movementCost: number;
  elevation: number; blocksLOS: boolean; blocksMovement: boolean;
  vehicleImpassable: boolean; trampled: boolean;
  traction: number; fatigueRate: number;
}

export interface Projectile {
  from: Position; to: Position; timer: number; hit: boolean; crit: boolean; team: Team;
}
export interface Wreckage { pos: Position; type: UnitType; timer: number; team: Team; }
export interface Explosion { pos: Position; radius: number; timer: number; maxTimer: number; }

export interface EventLog {
  message: string; time: number;
  type: 'kill' | 'spawn' | 'info' | 'contact' | 'objective' | 'reward';
}

export interface Objective {
  id: string;
  description: string;
  status: ObjectiveStatus;
  optional?: boolean;
}

export interface MissionDef {
  id: MissionId;
  name: string;
  summary: string;
  briefing: string;
  rewardKills: boolean;        // only defense mission true
  mapLayout: MapLayoutId;
  mapSeed?: number;
  init: () => Partial<GameState>; // returns starting units, objectives, captures, etc.
  update: (state: GameState, dt: number) => void; // mission script tick
}

export interface CapturePoint {
  id: string; pos: Position; radius: number;
  owner: Team | 'neutral'; progress: number; // -1..1 toward enemy/player
  label: string;
}

export interface GhostContact { team: Team; pos: Position; type: UnitType; time: number; }

export interface GameState {
  units: Unit[];
  terrain: TerrainCell[][];
  mapWidth: number; mapHeight: number; cellSize: number;
  camera: Position; zoom: number;
  projectiles: Projectile[];
  wreckage: Wreckage[];
  explosions: Explosion[];
  eventLog: EventLog[];
  ghostContacts: GhostContact[];
  selectionBox: { start: Position; end: Position } | null;
  gameOver: boolean; gameResult: 'win' | 'lose' | null;
  time: number;
  paused: boolean;
  mission: MissionDef;
  objectives: Objective[];
  capturePoints: CapturePoint[];
  reinforcementBudget: number; // mission-specific reinforcement pool
  // defense mission only — kill reward CP
  rewardCP: number;
  // mission script state bag
  script: Record<string, unknown>;
  // detection-bonus zone (ambush)
  detectionMultiplier: number; // applied to enemy detection of player units
}

export interface InputState {
  keys: Set<string>;
  mousePos: Position; mouseWorldPos: Position;
  isDragging: boolean; isPanning: boolean;
  dragStart: Position | null;
}
