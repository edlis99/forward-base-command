## v4 — Selection accuracy, trenches, bigger maps, real tactical behavior

Six issues to address from this round:

1. Box-select drags the wrong rectangle and feels unstable.
2. Combat still feels like RNG — terrain doesn't visibly matter.
3. No trenches as a usable mechanic; player can't dig them.
4. Maps too small for real maneuver.
5. Units charge in instead of reacting to threats.
6. Multi-select doesn't form coherent formations.

---

### 1. Fix drag-select (Scene3D.tsx + engine.ts)

Root cause: `Ground` uses R3F `onPointerDown/Move/Up`, but when the cursor moves over a unit or terrain box, those events stop propagating to the ground plane — drag rectangle then jumps. Also the ground plane is small and tilted, so screen→world mapping skews near the camera edges.

Fix:
- Move pointer handling to a **DOM overlay** (`<div>` sized to the canvas with `pointerEvents: auto`) and raycast manually using `useThree().raycaster` against a single huge invisible ground plane (Y=0). This removes the "hit a unit, lose the drag" problem entirely.
- Track drag in screen pixels first; only convert to world coords on `pointermove`. Use a 6 px threshold before promoting click → box-select (prevents jitter on tap).
- Render the selection box as a screen-space `<div>` overlay (crisp rectangle) instead of a 3D ground quad — what you see is exactly what gets selected.
- `handleBoxSelect` already filters by team; keep as-is. Add inclusive AABB check using each unit's screen-projected position so selection matches the rectangle the player drew, not the raw world AABB (this matters because of the tilted camera).

### 2. Bigger maps (constants.ts + terrain layouts)

- Increase `MAP_COLS` 60→96 and `MAP_ROWS` 40→64 (~2.5× area). Cell size stays 32 so existing units/ranges feel the same.
- Re-tune each of the 4 layouts to fill the new space: longer approach lanes, real flank routes around the objective, multiple cover belts between spawn and goal. Place player spawn ~15 cells from first cover so the player must maneuver, not brawl on contact.
- Camera: raise default zoom-out cap and add edge-pan + middle-mouse drag-pan so the bigger map is navigable.

### 3. Trenches — terrain + dig action

Trenches already exist as a `TerrainCell` type with the strongest cover (×0.55 damage) — wire them into gameplay:

- **Pre-placed trenches** on Defend and Ambush layouts (player firing line + ambush positions) so the mechanic is visible immediately.
- **Dig action for infantry:**
  - New stance/order `entrench`. UI button "Dig In (T)" with selected infantry.
  - Unit stops, plays a 6 s dig timer (progress bar), then converts the cell it stands on from `open`/`mud`/`gravel`/`tall_grass` → `trench` (no dig on roads, water, urban, forest, walls).
  - Dig speed scales with `fatigue` (tired units dig slower) and requires `suppression < 0.4`.
  - Once finished, the unit auto-takes the `prone` pose and gets the trench's cover/concealment bonuses (`coverBonus 0.7`, `concealment 0.4`, `-0.25` elevation).
  - Engineering ammo not modeled — free, but only infantry, and only when not under fire.
- Renderer: `Scene3D` already draws trenches as inset boxes; add a "digging" ring above the unit while in progress.

### 4. Cover-seeking, threat-aware combat (ai.ts + new behaviors)

Replace the current "engage nearest visible" loop with a per-unit **threat field** evaluated every ~0.5 s:

- For each unit, score every cell within `sightRange` by `coverBonus + concealment*0.5 - distanceToTargetLOS*penalty - exposureToEnemies`.
- When a friendly auto-engages (defend/aggressive) and the unit is not on a player `move`/`attack_move` order, pick the **best cover cell within 3–6 cells** that still has LOS to the target. Walk there in a 2-cell bound, fire, repeat.
- On taking damage with `suppression > 0.4` or `morale < 0.6`, infantry execute a **"break contact" hop**: nearest cover cell behind their last facing, drop prone, return fire.
- Vehicles use the existing standoff but also score reverse-positions when an AT-capable enemy gains LOS at <0.5×range.
- Add a per-unit **fear timer**: after a nearby ally dies, +0.3 suppression and skip one engagement cycle (no instant trading).
- Mission-specific flavor stays in `runEnemyBehavior` (Assault garrison, Defend wave bounding, Recon patrol, Convoy formation) but all now route through the same cover-scorer for destination selection.

This is the change that makes terrain *visible* — units will physically move to trees/sandbags/trenches before shooting, instead of stopping in the open.

### 5. Formations for multi-select (engine.ts handleRightClick + new formations.ts)

Today multi-select offsets units by their pre-existing position, so groups stay in whatever blob they were standing in. Replace with explicit formations:

- New module `src/game/formations.ts` exposing `computeFormation(units, anchor, facing, type)` returning `{unitId → Position}`.
- Formation types:
  - **Line** (default for infantry-heavy): one rank, spaced 1.5× radius, perpendicular to move direction.
  - **Wedge** (default for mixed armor): tanks at point, APCs and infantry trailing in V.
  - **Column** (default on roads): file along the move vector, 2× spacing.
  - **Echelon Left / Right** (modifier with Q / E held during right-click).
- Auto-pick formation:
  - On roads (destination cell or path passes through road) → Column.
  - Selection contains tank/APC → Wedge.
  - Else → Line.
- Facing: orient the formation toward the destination from the current group centroid. Each unit's `homePos` gets set to its formation slot so `hold_position` keeps the shape.
- Shift-queue waypoints reuse the same formation (each waypoint = same shape, re-oriented).
- HUD shows the current formation icon next to the selected-unit panel; keys 1/2/3 force Line/Wedge/Column.

### 6. UI / feedback

- HUD: add badges "Digging", "Bounding", "Pinned", "Routed" under each selected unit's portrait.
- Cursor changes to a shovel when hovering a diggable cell with infantry selected and `T` armed.
- Mini contact log already shows hits; add a "first contact" sound-less flash on the ghost contact marker so the player notices spotting events.

---

### Technical structure

```text
src/game/
  constants.ts            // MAP_COLS=96, MAP_ROWS=64
  formations.ts           // computeFormation, formation picker
  units.ts                // entrench order, dig timer, cover-bound advance helper
  ai.ts                   // threat-field scorer, break-contact hop, fear timer
  terrain/layouts/*.ts    // retuned for the bigger map; pre-placed trenches
src/scene3d/
  Scene3D.tsx             // DOM-overlay pointer handling, screen-space selection box, digging ring
src/components/
  GameHUD.tsx             // Dig button, formation icons, new status badges
  GameUI.tsx              // 1/2/3 formation keys, T dig key
```

### Out of scope

- New unit classes, weapon types, animations beyond the prone scale tweak and dig-ring.
- Fortification building beyond trenches (no sandbag/wall placement yet).
- Pathfinding rewrite — current A* stays; only the destination *choice* changes.
- Multiplayer / save-load.
