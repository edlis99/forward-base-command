export type UnitType = 'infantry' | 'tank' | 'apc' | 'helicopter';
export type Team = 'player' | 'enemy';
/** Who drives a side: a human (commands) or the built-in AI. */
export type Controller = 'human' | 'ai';
export type TerrainType =
  | 'open' | 'urban' | 'forest' | 'road' | 'water'
  | 'wall' | 'trench' | 'rubble' | 'sandbag'
  | 'mud' | 'crater' | 'hedgerow' | 'tall_grass' | 'gravel';
export type Stance = 'hold_fire' | 'tight' | 'defend' | 'aggressive';
export type OrderType = 'idle' | 'move' | 'attack_move' | 'attack' | 'hold_position' | 'retreat' | 'patrol' | 'entrench';
export type FormationType = 'line' | 'wedge' | 'column';
export type MissionId = 'leipalingis' | 'duel' | 'raas';
export type ObjectiveStatus = 'active' | 'complete' | 'failed';
export type MapLayoutId = 'farmhouse_complex' | 'village_crossroads' | 'forest_outpost' | 'desert_road' | 'leipalingis_region';
export type DeploymentTownId = 'jovaisiai' | 'didziasalis' | 'versiai' | 'straciunai' | 'seirijai';

export interface DeploymentTown {
  id: DeploymentTownId;
  name: string;
  pos: Position;
  approach: string;      // "North axis", etc
  distanceKm: number;    // narrative distance
  risk: 'low' | 'med' | 'high';
  terrainNote: string;
  advantage: string;
}

export interface DeploymentContext {
  town: DeploymentTownId;
  composition: { infantry: number; tank: number; apc: number };
}

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
  waypoints: (Position & { facing?: number; attackMove?: boolean })[]; // queued user orders
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
  /** Vehicle the unit is walking toward to mount (cleared on board/abort). */
  boardTarget: string | null;
  /** Start digging after the current trench-line move finishes. */
  digOnArrive?: boolean;
  holdOnArrive?: boolean;
  coverTarget?: Position;
  arrivalFacing?: number;
  routeLength?: number;
  waiting?: 'formation' | 'traffic';
  /** Seconds spent continuously yielding to friendly traffic. */
  trafficWait?: number;
  /** Consecutive re-paths that made no progress. */
  noProgressRepaths?: number;
  /** Group-move speed cap so a formation advances at its slowest member's pace. */
  groupSpeedCap: number | null;
  /** Shared command id used to pace units in the same moving formation. */
  moveGroupId: number | null;
  /** Squad (formation layer) this unit currently belongs to. */
  squadId: number | null;
  /** True once the unit reached its formation slot. */
  settled: boolean;
  // movement
  finalDest: Position | null;        // true destination for re-path
  lastProgressDist: number;          // distance to current targetPos at last progress check
  lastProgressTime: number;          // sim time of last progress
  // behavior
  reactionDelay: number;             // seconds until allowed to act on new contact
  reactionTarget?: string | null;    // contact for which the reaction delay was started
  prone: boolean;                    // suppressed/pinned visual + accuracy
  ambushReady: boolean;              // hold-fire ambush trigger consumed?
  rallyUntil: number;                // sim time until rally complete
  digTimer: number;                  // seconds spent digging trench
  coverSeekCooldown: number;         // throttle cover repositioning
  lastAllyDeathTime: number;         // fear timer
  // awareness
  spottedByEnemy: boolean;    // is this unit currently visible to opposing team
  detectionLevel: number;     // 0..1 builds toward 1 = fully spotted
  lastKnownPos: Position | null; // for ghost markers when LOS lost
  lastKnownTime: number;
  // engagement / reaction to combat
  /** True while a halted attack-move unit is standing to fight a target. */
  engaging: boolean;
  /** True while a soldier/aircraft is turned toward a target instead of its travel direction. */
  aiming: boolean;
  /** Seconds spent continuously engaging (watchdog against endless stand-offs). */
  engageTime: number;
  /** Sim time until which this unit ignores contacts and keeps advancing. */
  disengageUntil: number;
  /** Seconds until the unit may re-evaluate its auto-selected target. */
  retargetTimer: number;
  /** Sim time this unit last fired a shot. */
  lastFireTime: number;
  /** Last place the ordered attack target was seen (chase / search). */
  chaseGoal?: Position | null;
  /** Seconds the ordered attack target has been out of sight. */
  targetLostTimer: number;
  /** Throttle for re-pathing while chasing an ordered target. */
  chaseRepathTimer: number;
}

export interface TerrainCell {
  type: TerrainType; x: number; y: number;
  coverBonus: number; concealment: number; movementCost: number;
  elevation: number; blocksLOS: boolean; blocksMovement: boolean;
  vehicleImpassable: boolean; trampled: boolean;
  traction: number; fatigueRate: number;
  /** Tactical objects have an open firing/occupancy slot in their cell. */
  prop?: 'logs' | 'hay' | 'stone_wall' | 'wreck' | 'barricade' | 'boulder' | 'scrub';
  propAngle?: number;
  roadName?: string;
  yard?: 'courtyard' | 'garden' | 'orchard';
  settlementId?: string;
  buildingKind?: 'house' | 'barn' | 'church' | 'civic' | 'workshop';
  /** Detection multiplier; paved roads expose moving and stationary units. */
  exposure?: number;
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
  rewardKills: boolean;
  mapLayout: MapLayoutId;
  mapSeed?: number;
  /** Deployment towns available for this mission (Leipalingis operation). */
  deploymentTowns?: DeploymentTown[];
  /** Default composition offered to the player if none chosen. */
  defaultComposition?: { infantry: number; tank: number; apc: number };
  init: (ctx?: DeploymentContext) => Partial<GameState>;
  update: (state: GameState, dt: number) => void;
}

export interface CapturePoint {
  id: string; pos: Position; radius: number;
  owner: Team | 'neutral'; progress: number; // -1..1 toward enemy/player
  label: string;
}

export interface GhostContact { team: Team; pos: Position; type: UnitType; time: number; }

/** Coordinated player formation created by a move order (see playerSquads.ts). */
export interface PlayerSquad {
  id: number;
  commandId: number;
  coordinated: boolean;
  progressFloor: number;
  commandLength: number;
  memberIds: string[];
  dest: Position;
  anchor: Position;
  facing: number;
  targetFacing: number;
  travelSpeed: number;
  cohesionRadius: number;
  slots: Record<string, Position>;
  localOffsets: Record<string, Position>;
  compression: number;
  state: 'moving' | 'arrived';
  lastReslot: number;
  maxRemaining: number;
}

export type CommandMarkerType = 'move' | 'attack' | 'capture' | 'board' | 'hold' | 'attack_move';
export interface CommandMarker {
  pos: Position;
  type: CommandMarkerType;
  team: Team;
  timer: number;
  max: number;
}

export type FireKind = 'he' | 'smoke' | 'counter';
export interface FireMission {
  id: string;
  pos: Position;
  kind: FireKind;
  team: Team;
  delay: number;         // seconds until first impact
  salvoLeft: number;     // impacts remaining
  salvoInterval: number; // seconds between impacts
  intervalTimer: number;
  radius: number;
  damage: number;
}
export interface SmokeZone {
  id: string; pos: Position; radius: number; timer: number; maxTimer: number;
}
export interface FireSupportState {
  heTokens: number;
  smokeTokens: number;
  cooldown: number;        // shared cooldown between calls
  armed: 'he' | 'smoke' | null;
  counterCooldown: number; // until enemy counter-battery
}

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
  /** Player-team unit IDs currently inside the live drag rectangle (preview highlight). */
  previewSelected: Set<string>;
  selectionRoster: string[];
  coordinatedMovement: boolean;
  /** Transient ping markers for issued commands. */
  commandMarkers: CommandMarker[];
  /** Ghost formation plan shown while right-button is held (press-drag placement). */
  commandPreview: {
    slots: { id: string; pos: Position; type: UnitType; squad: number }[];
    dest: Position;
    facing: number;
  } | null;
  gameOver: boolean; gameResult: 'win' | 'lose' | null;
  time: number;
  paused: boolean;
  /** Tactical time control: 0.25 = very slow, 0.5 = slow, 1 = normal, 2 = fast. */
  timeScale: number;
  mission: MissionDef;
  /** Chosen deployment town for the Leipalingis operation (if applicable). */
  deployment?: DeploymentContext;
  objectives: Objective[];
  capturePoints: CapturePoint[];
  reinforcementBudget: number;
  rewardCP: number;
  script: Record<string, unknown>;
  detectionMultiplier: number;
  preferredFormation?: FormationType;
  /** Debug overlay toggles (Stage 2). At most one should be on at a time. */
  debug: DebugFlags;
  /** Threat / last-seen memory fields (Stage 3). Allocated lazily by threatMap. */
  threat?: import('./threatMap').ThreatMap;
  /** Off-map fire support (artillery/mortars). */
  fireSupport: FireSupportState;
  fireMissions: FireMission[];
  smokeZones: SmokeZone[];
  /** Monotonic id for coordinated player movement orders. */
  nextMoveGroupId: number;
  /** Active coordinated player formations. */
  playerSquads: PlayerSquad[];
  /** Deterministic RNG state (see rng.ts). */
  rngState?: number;
  /** Test/replay hook: replaces the seeded generator when set. */
  random?: () => number;
  /** Who controls each side. Default: the player is human, the enemy is the AI. */
  controllers?: Record<Team, Controller>;
  /** Set when a head-to-head match is decided. */
  winner?: Team | null;
  /** Next unit id number for units spawned during this match. */
  nextUnitId?: number;
  /** RAAS match state (see raas.ts). */
  raas?: import('./raas').RaasState;
  /** Head-to-head scoring (see duel.ts). */
  duel?: { score: Record<Team, number>; scoreToWin: number; timeLimit: number; pointsPerSecond: number };
}

export interface DebugFlags {
  showCover: boolean;
  showConcealment: boolean;
  showTactical: boolean;
  showMovement: boolean;
}

export interface InputState {
  keys: Set<string>;
  cameraFocus?: Position;
  mousePos: Position; mouseWorldPos: Position;
  isDragging: boolean; isPanning: boolean;
  dragStart: Position | null;
  /** Screen-pixel pointerdown anchor, used to apply a screen-space drag threshold. */
  dragStartScreen: Position | null;
  /** True once the cursor moved more than DRAG_THRESHOLD px since pointerdown. */
  dragPromoted: boolean;
  /** True while right mouse button is held (for live formation preview). */
  rightMouseDown: boolean;
}
