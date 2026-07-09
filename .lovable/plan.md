ns=# Broken Arrow–Style Overhaul

Big pass across visuals, combat feel, spotting, and pathing. Broken into focused slices so we can verify each before moving on.

## 1. Path/Spawn Unstuck (fix first — it's blocking play)

Root cause today: units spawn on any cell the deployment screen allows, and A* only re-paths when `stuckTimer > 0.6s`. Vehicles get wedged on hedgerows, tree clusters, and building footprints because the passability check is per-cell but their body radius spans multiple cells.

- Add **spawn nudge**: on `createUnit`, if the spawn cell is impassable for the unit's footprint, snap to the nearest passable cell (BFS radius 6, matching pathfinding.ts).
- Add **footprint-aware passability** for tanks/APCs: check the 3×3 (tank) or 2×2 (APC) neighborhood, not just the center cell. Feeds both A* and the "isPassable next-step" test in `moveUnit`.
- **Faster stuck recovery**: drop the stuck threshold to 0.25s, and if a re-path fails, try a random 20° detour waypoint before giving up.
- **Deployment gate**: reject deployment placement on cells that fail the footprint check (visual red marker in DeploymentScreen).

## 2. Trench System Rework

Current trenches are box parapets with sandbag caps. Replace with a proper zig-zag entrenchment.

- **Zig-zag geometry**: trench cells generated as connected segments with 20–35° dog-legs every 2–3 cells (traversal bay pattern, not straight lines). Prevents the "long straight box" look and matches real fieldworks.
- **Revetments**: mixed timber planks + sandbag stacks + earth berms per segment (three material variants, deterministic per-cell). Instanced meshes with per-instance material tinting.
- **Firing steps**: raised interior lip at intervals where units aim over the parapet — unit prone height sits on the step so weapons clear the berm.
- **Depth & shadow**: deeper cut (0.75), darker floor material, ambient-occlusion strip along the interior edge.
- **Communication trenches**: narrower connector segments between fighting bays, dug automatically along the same team's trench cluster.

## 3. Unit Model Overhaul (Broken Arrow look)

Right now units are simple capsules/boxes. Bring closer to BA's readable-but-detailed silhouettes.

- **Infantry**: multi-part rig — torso, helmet, backpack, rifle, legs; team-tinted uniform with role stripe (rifleman / AT / MG / medic). Prone pose is a proper flattened rig, not a squashed capsule.
- **Tanks (T-80/Leopard analogues)**: hull + independently-rotating turret + gun barrel + tracks + side skirts + antenna. Track texture strip with scrolling UV when moving.
- **APCs**: hull + RWS turret + wheels/tracks + smoke launchers on hull sides.
- **Helicopters**: fuselage + tail boom + rotating main & tail rotors + weapon pylons.
- **Team identification**: player = NATO woodland + blue accent, enemy = Soviet-pattern green/brown + red accent. Small NATO/OpFor symbol decal on top for top-down readability.
- **Wreckage**: replace generic pile with tipped-turret/scorched-hull variants per unit type.

## 4. Environment Visuals

- **Ground**: multi-texture blending (grass / dirt / mud / dry patch) driven by terrain type + trample state, with noise instead of flat colored cells.
- **Trees**: instanced mixed conifer/deciduous with size variance and slight sway.
- **Hedgerows**: dense clumps (5–8 bush instances per cell) instead of a single mesh.
- **Buildings**: swap flat boxes for gabled roofs, window strips, damage variants (intact / damaged / rubble).
- **Roads**: darker aggregate texture with shoulder edges and occasional patches.
- **Craters**: proper concave geometry with scorched rim + debris ring.
- **Lighting**: warmer sun, softer shadows, subtle atmospheric fog for depth (BA-style haze at range).

## 5. Combat Feel & Spotting

- **Spotting model**: two-tier detection — "contact" (blip only, no unit type) vs "identified" (full model). Detection accrues over time based on target's motion, cover concealment, and observer sight. Enemies in cover currently pop instantly; this fixes that.
- **Fog-of-war rendering**: unspotted enemies invisible; contact-only shown as red diamond blip with last-known-position ghost that fades over ~15s.
- **Recon bonus**: infantry in tall_grass/forest gain concealment multiplier; stationary units are harder to spot than moving.
- **Weapon feel**: heavier tank main-gun (bigger flash, shell tracer arc, dust kickup at muzzle and impact), MG sustained tracer streams (3-round bursts instead of single lines), rifle single crisp tracers.
- **Impact effects**: dirt geyser for near-miss on ground, sparks + smoke puff for armor hits, blood/dust puff for infantry.
- **Suppression**: replace pulsing ring with a subtle dust cloud around suppressed unit + screen-space desaturation on that unit's model.
- **Explosions**: expanding shockwave ring on ground + fireball sphere + lingering smoke column (30s) for HE strikes.

## Slice Order

1. Slice 1 (pathing/spawn) — small, unblocks play.
2. Slice 2 (trenches) — visible win.
3. Slice 3 (units) — biggest visual jump.
4. Slice 4 (environment).
5. Slice 5 (combat/spotting).

## Technical notes

- All new geometry via `THREE.InstancedMesh` with per-instance color/matrix; no per-unit meshes beyond what we already have.
- New footprint helper lives in `src/game/pathfinding.ts`; spawn nudge in `src/game/units.ts::createUnit`.
- Trench zig-zag generation added to `src/game/terrain.ts` (post-process trench cells into segments with dog-leg offsets).
- Unit model builders factored out of `Scene3D.tsx` into `src/scene3d/models/` (one file per unit type) to keep the scene file manageable.
- Spotting: extend `src/game/awareness.ts` with a per-enemy `detectionLevel` (already on the type) tick, plus a `contacts` list on GameState for blip rendering.

I'll start with Slice 1 (pathing/spawn) since it's actively breaking play, then move through 2→5 in follow-ups. Sound good, or do you want me to reorder?
