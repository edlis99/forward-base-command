

## Modern Warfare RTS — Tactical Combat Prototype

A browser-based 2D tactical RTS prototype with a clean military map aesthetic, focused on unit control and combat mechanics.

### Core Features

**Game Map (Canvas-based)**
- Top-down tactical map rendered on HTML5 Canvas (~1200x800 viewport)
- Terrain types: open ground, urban areas (buildings for cover), forests, roads
- Fog of war system — units reveal area around them
- Minimap in corner showing revealed terrain

**Unit System**
- 4 unit types: Infantry squad, Tank, APC, Helicopter
- Each has unique stats: speed, range, damage, armor, sight range
- Select units (click/drag box select), right-click to move/attack
- Units auto-engage enemies in range
- Cover system: units near buildings/terrain get defense bonus
- Suppression: units under heavy fire move/shoot slower

**Combat Mechanics**
- Range-based engagement with line-of-sight checks
- Health bars and damage calculations (armor vs damage type)
- Infantry effective vs infantry; tanks strong vs vehicles; helicopters versatile but fragile
- Units can be destroyed, leaving wreckage on map

**Special Abilities (Cooldown-based)**
- Recon Drone: reveals fog of war in target area temporarily
- Airstrike: deals heavy damage in a target zone after short delay
- Smoke Screen: blocks line of sight in an area

**Enemy AI**
- Pre-placed enemy base with patrol routes
- AI spawns waves of mixed units that attack the player
- Basic threat assessment — AI focuses weakest/closest targets

**UI / HUD**
- Selected unit info panel (bottom)
- Ability bar with cooldown indicators
- Resource display (simplified: Command Points for spawning units)
- Unit spawn panel — spend points to deploy reinforcements at spawn zone
- Kill feed / event log

**Game Loop**
- Player starts with a small force + spawn zone
- Earn Command Points over time to spawn reinforcements
- Destroy all enemy units and their spawn point to win
- Lose if all player units are destroyed

### Visual Style
- Clean flat vector aesthetic with muted military colors (olive, tan, grey)
- Unit icons (NATO-style military symbols) on the tactical map
- Terrain shown as colored zones with subtle textures
- Grid overlay toggle for tactical planning
- Smooth camera pan (WASD/drag) and zoom

### Tech Approach
- HTML5 Canvas for game rendering (no heavy game engine needed)
- React for UI overlays (HUD, panels, menus)
- Game loop via requestAnimationFrame
- All client-side, no backend needed

