## v3 — Unique Maps, Reliable Movement, Real Combat Behavior

Three concrete problems to solve:

1. Every mission currently shares the same `generateTerrain()` map — they should feel like distinct battlefields.
2. Units get stuck on trees/walls/wreckage and ignore the drawn path while shooting.
3. Both sides just push forward and trade shots — no suppression-driven behavior, no flanking, no bounding overwatch.

---

### 1. Per-mission maps

Refactor `terrain.ts` so map layout is data, not a single hard-coded function.

- Expose `generateTerrain(layoutId: MapLayoutId, seed: number)`.
- Add a `MissionDef.mapLayout` field. Each mission picks its own layout + seed.
- Provide 4 hand-tuned layouts that match mission intent:
  - `farmhouse_complex` — Assault. Walled compound at center, approach lanes through hedgerows and a creek, sandbag firing positions inside.
  - `village_crossroads` — Defend. Two capture points on a T-junction, ruined buildings, sandbags pre-placed for the player, attack corridors from the east through open fields.
  - `forest_outpost` — Recon. Dense forest belt, narrow trails, scattered enemy posts in clearings, river that funnels paths, extract by the bridge.
  - `desert_road` — Ambush. Long straight road through low dunes, sparse cover, elevated ridgelines on both flanks for the player to pre-position.
- Each layout uses the same `TerrainCell` primitives — only placement changes. Seed makes per-mission variation reproducible.
- Mission init can also drop layout-specific decorations (destroyed vehicles, craters) for flavor.

### 2. Movement that actually follows the drawn path

Pathing issues come from three places in `units.ts` / `pathfinding.ts`:

- Waypoint pop radius is too tight: a unit going around a tree often slides past the node and loops. Change pop radius to scale with unit size (~`CELL_SIZE * 0.6` for infantry, `CELL_SIZE * 0.9` for vehicles) and use look-ahead (pop next node when within radius AND next node is also reachable in straight line).
- Separation steering currently rotates the desired facing; when two units overlap they spin in place. Apply separation as a positional nudge only, capped, and disable it once the unit is within 1 cell of its final target.
- `stuckTimer` only triggers when the next cell is blocked. Add a "no progress" check: if distance to current `targetPos` hasn't decreased by >2 units in 0.6s, force a re-path from the *current* position to the *final destination* (`unit.path[unit.path.length - 1]`), not the current sub-waypoint.
- When `setDestination` is called, store the final goal on the unit (`unit.finalDest`) so re-pathing always knows the true destination instead of the next intermediate node.
- Combat code currently sets `unit.targetPos = null; unit.path = []` whenever a `defend`-stance unit acquires a target — this is what causes units to abandon a player's drawn path mid-move. Gate that clear so it only happens when `order === 'hold_position'` or `order === 'idle'`. If the player issued `move`/`attack_move`, the path is sacred — the unit can still shoot on the move but does not stop.
- Pathfinding: add wreckage and unit footprints (other vehicles) as soft obstacles via an `extraBlocked` set passed into `findPath`. Avoids tanks parking on the path line.

### 3. Combat that feels like combat

Right now AI either holds-position or runs straight at the nearest enemy. Replace `runEnemyBehavior` and tighten friendly auto-engagement so both sides show recognizable tactical behavior.

Behaviors to add (all per-unit, no global director):

- **Suppression-driven pinning.** When `suppression > 0.5`, infantry stop advancing, drop prone (visual: smaller capsule, slower turn), and only return fire from current cover. Already have the stat — wire it into AI decisions.
- **Cover-bound advance.** When ordered to attack-move or when enemy AI chooses to push, units move in 2–4 cell bounds between cover cells (`coverBonus >= 0.25`) instead of a straight line to the target. Implemented by post-processing the A* path: insert pauses at cover nodes proportional to threat (any enemy with LOS to next bound).
- **Bounding overwatch for squads.** Group nearby friendly infantry into informal "fireteams" (proximity-based, recomputed every 2s). At any time half the team holds and shoots while the other half moves one bound, then swap. Pure local rule — no central planner.
- **Flanking AI.** Enemy attackers pick an approach offset perpendicular to the line between them and the target's last known position, biased toward terrain with `concealment > 0.3` or `coverBonus > 0.25`. Removes the "everyone walks down the road" feel.
- **Hold-fire ambush trigger.** Units on `hold_fire` automatically switch to `aggressive` when an enemy enters their range AND an allied unit within 200 also has LOS (coordinated first volley). This makes the Ambush mission play correctly without manual stance toggles.
- **Break and rally.** When `morale < 0.25`, unit retreats to the nearest cover behind its `homePos`; recovers morale and rejoins after 8s if it survives.
- **Vehicles keep standoff.** Tanks/APCs target a position at ~80% of their `range` from the target, not the target itself. Stops them from driving into infantry AT range.
- **Reaction time.** Add a small `reactionDelay` (0.3–0.8s) before a unit acts on a newly spotted contact. Removes the instant-snap-aim feel.
- **Mission-specific AI flavor:**
  - Assault garrison: never leaves its `homePos` ring (radius 4 cells), shoots and retreats to interior cover when wounded.
  - Defend wave attackers: form a loose line and bound forward; if a vehicle is destroyed, infantry around it pin and call for the next wave to flank.
  - Recon patrols: stay on patrol path unless detection occurs, then search last-known position before chasing.
  - Convoy: keep formation on the road; if a vehicle is hit, the rest accelerate and the trailing one dismounts infantry (if APC) into nearest cover instead of pushing into the kill zone.

### 4. Small UX/feedback so the player can see it working

- HUD contact log already exists — add a "Suppressed" / "Bounding" / "Pinned" badge under each selected unit's portrait so the new behaviors are legible.
- Draw the unit's current full path (not just next leg) when selected, in `Scene3D`, so movement issues are visible.
- Speed up path repair: when re-path returns empty (truly unreachable), show a brief red marker at the destination instead of silently doing nothing.

---

### Technical structure

```text
src/game/
  terrain/
    index.ts                 // generateTerrain(layoutId, seed)
    layouts/
      farmhouse-complex.ts
      village-crossroads.ts
      forest-outpost.ts
      desert-road.ts
    primitives.ts            // placeUrbanCluster, placeForest, etc. (moved out)
  pathfinding.ts             // + extraBlocked, finalDest-aware re-path
  units.ts                   // pop radius, separation fix, no-progress repath
  ai/
    index.ts                 // dispatch by mission/unit
    behaviors.ts             // suppress, bound, flank, standoff, react
    fireteam.ts              // proximity grouping + overwatch
  missions/*.ts              // each sets mapLayout + seed + mission-specific AI flavor
```

### Out of scope

- New unit types or weapon classes.
- Reworked 3D models.
- Animation rig changes beyond a prone-pose scale tweak.
- Saving/loading, multiplayer.
