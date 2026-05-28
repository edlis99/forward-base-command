## Tactical Combat Prototype v2 — 3D, Mission-Based, Real Combat Feel

Rebuild the game layer around a low-poly 3D world, mission scripting, A* pathfinding, and a proper awareness/engagement system. Replace wave spam + kill rewards with hand-crafted missions and an active-pause command layer.

### 1. Switch to 3D (React Three Fiber)

- Install `@react-three/fiber@^8.18`, `@react-three/drei@^9.122.0`, `three@^0.160`.
- Replace `GameCanvas` (HTML5 Canvas) with an R3F `<Canvas>` scene; keep `GameHUD`/`GameUI` as React overlays.
- Tilted top-down RTS camera (Wargame/WARNO style): orbit/pan/zoom via MapControls, edge-scroll + WASD.
- Low-poly tactical look: flat-shaded materials, muted military palette, soft directional light + ambient, simple fog.
- Procedural low-poly models for infantry (capsule + helmet + rifle), tank (hull + turret + barrel), APC (boxy hull + wheels), helicopter (fuselage + spinning rotor), trees (cone + trunk), buildings (extruded boxes), walls/sandbags/trenches as low-poly meshes.
- Instanced meshes for trees/rocks/units of the same kind for performance.
- Terrain: heightfield-based ground (gentle hills) with biome coloring; existing `terrain.ts` grid drives tile types and heights.
- Tracer lines, muzzle flashes, explosions as additive sprites / simple particle bursts.

### 2. Movement & Awareness Overhaul

- **A* pathfinding** on the terrain grid (`src/game/pathfinding.ts`): per-unit-class passability, terrain cost, smoothed paths (string-pulling). Cached and recomputed when blocked.
- Units route around trees, walls, water, buildings instead of bumping. Dynamic re-path on obstruction.
- **Steering**: separation, path-following, arrival; replaces current ad-hoc obstacle probing in `units.ts`.
- **Facing & turn rates** preserved; integrated with path direction.
- **Awareness / engagement rules**:
  - Spotting model: `spotChance = f(distance, stance, mover concealment, spotter optics, LOS)`.
  - Stances drive behavior: `hold_fire` (never shoots), `tight` (only return fire), `defend` (engage in range, don't chase), `aggressive` (pursue within leash).
  - Contact reports (HUD event "Contact: tank, NE") on first spot.
  - No engagement without confirmed spot + LOS; ghost markers fade after losing sight.

### 3. Active-Pause Command Layer

- Space toggles pause; while paused, orders queue and render as ghost paths/waypoints.
- Shift queues waypoints (kept). Right-click context per target type (move/attack/board).
- Visible order ribbon per selected unit.

### 4. Mission System (replaces wave spawner)

- New `src/game/missions/` module. Each mission is a data file: starting units, enemy placements, triggers, objectives, win/lose conditions, briefing text.
- Remove `updateAI` wave logic; AI runs per-unit with mission-defined orders (garrison, patrol route, ambush trigger zone, convoy path).
- Mission picker screen lists available missions. No global kill-reward CP economy.
- **Reinforcement budget** instead of CP-from-kills: each mission gives a fixed pool the player can spend at start / at trigger points. Defense missions are the one exception and may award CP per kill (memory updated accordingly).

Prototype mission set (4, each mechanically distinct):
1. **Assault** — Take a fortified farmhouse held by a garrison. Limited starting force, no reinforcements.
2. **Defend Settlement** — Hold 2 capture points vs scripted enemy advances. Kill rewards enabled here only.
3. **Recon & Extract** — Small recon team, avoid contact, photograph 3 sites, reach extraction. Detection raises alarm and spawns pursuers.
4. **Ambush Convoy** — Pre-position units in concealment; convoy moves along road; surprise-attack bonus on first volley; destroy all vehicles before they exit map.

### 5. Cleanup

- Delete wave/streak/CP-per-kill code from `engine.ts` and `ai.ts` (keep behaviors, drop spawner).
- Remove 2D renderer (`renderer.ts`) once 3D scene is in.
- Update HUD: mission objectives panel, contact log, pause indicator, removed wave counter.
- Update memory: prototype is now 3D R3F, mission-based, no global kill rewards.

### Technical structure

```text
src/
  game/
    engine.ts            // tick loop, no waves
    pathfinding.ts       // A* + smoothing
    awareness.ts         // spotting, contact reports
    missions/
      index.ts
      assault.ts
      defend.ts
      recon.ts
      ambush.ts
    units.ts             // movement now uses pathfinding + steering
    ai.ts                // per-unit behaviors driven by mission orders
    types.ts
  scene3d/
    Scene.tsx            // R3F Canvas, lights, camera, fog
    Terrain.tsx          // heightfield + tile coloring
    units/{Infantry,Tank,APC,Helicopter}.tsx
    props/{Tree,Building,Wall,Sandbag,Trench}.tsx
    fx/{Tracer,Explosion,MuzzleFlash}.tsx
  components/
    GameHUD.tsx          // + mission panel, contact log
    MissionSelect.tsx
```

### Out of scope (this iteration)

- Base-building, economy beyond per-mission budget.
- Ballistic simulation (travel time, penetration), formations, advanced animations — can come later.
- Multiplayer, save/load.
