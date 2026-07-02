
## Operation: Recapture Leipalingis — Single-Mission Overhaul

Replace the current mission list with **one** large-scale operation. Focus on the systems that most change the *feel* of the game within our 3D low-poly R3F prototype. This is scoped to what our engine can realistically support — not a AAA sim.

---

### 1. Mission & Map

- Delete `MISSIONS` list UI; landing screen becomes an **Operation Briefing** for the single mission "Recapture Leipalingis".
- New mission file `missions/leipalingis.ts`:
  - Objective: capture the central Leipalingis town zone (large capture point, long capture time, defended by multiple enemy squads).
  - Secondary (optional, not required to win): clear enemy strongpoints in outlying villages for morale/reinforcement bonus.
  - No global kill rewards (`rewardKills: false`).
- New large map layout `layoutLeipalingis` in `terrain.ts`:
  - Expand `MAP_COLS/ROWS` to **160 × 120** (from 96×64) for this mission only (mission carries `mapCols/mapRows` override; `generateTerrain` accepts size).
  - Central **Leipalingis**: dense town — grid of buildings, main road cross, fenced yards, church-like central building, tree-lined edges, 3–4 entry chokepoints.
  - Outlying villages as **deployment zones** (small cluster of 3–6 buildings + spawn marker):
    - Jovaišiai (N-NE, medium distance)
    - Didžiasalis (E, close, exposed approach across fields)
    - Veršiai (S, medium, forest approach)
    - Stračiūnai (W, medium, mixed)
    - Seirijai (far SW, longest travel, safest arc)
  - Between towns: large **forests** (concealment + slow), **open fields** (fast + exposed), **dirt roads / main road** network connecting all villages to Leipalingis, **lake** blocking direct SE approach with **bridge** crossings, **tree lines** along field edges, **hills** (visual only for now — elevation already tracked per cell), scattered farm buildings & hay bales.
  - Pre-placed enemy defensive positions: sandbag rings + short trenches at Leipalingis entries and one forward outpost per approach.

### 2. Deployment Phase (pre-mission)

- New screen `DeploymentScreen.tsx` shown after clicking "Begin Operation":
  - Tactical map preview (top-down mini render of the terrain grid + village markers + Leipalingis objective).
  - Roster on the side: fixed force (e.g. 6 infantry, 2 APCs, 2 tanks, 1 helicopter) — player assigns each unit to one of the 5 villages.
  - Per-village info card: distance to objective, dominant terrain, threat estimate, notes.
  - "Deploy & Begin" starts the mission; `mission.init()` places units near their chosen village spawn point.

### 3. Time Control

- Replace the current binary pause with a **speed selector**: `0×` (pause), `0.25×` (command), `0.5×` (slow tactical), `1×` (normal). Optional `2×` when not in contact.
- Store `state.timeScale`; multiply `dt` in the engine tick. Keep AI/animation/pathfinding intact — they already use `dt`.
- HUD: speed buttons + hotkeys `Space` (toggle pause), `1/2/3/4` (speeds). Existing `1–4` unit hotkeys move to `F5–F8` or similar to avoid clash — will use `Shift+1..4` for speed instead to preserve current bindings.

### 4. Trench Fix (visibility & entry)

- Fix disappearing units: current sink is `y -= 0.3` but the trench floor is deeper. Clamp so head/shoulders stay above parapet; add a short "enter trench" tween (0.4 s vertical ease).
- Ensure trench mesh remounts already covered by prior polling; add exit tween on leaving the cell.
- Confirm no unit sinks below parapet top when prone in trench.

### 5. Combined-Arms & Awareness Polish

- Add lightweight **support aura** in `squads.ts`/`ai.ts`:
  - Infantry within 120u of a friendly tank/APC: +10 morale floor, −15% suppression gain.
  - Tank within 100u of ≥2 friendly infantry: +10% accuracy (screen against close threats).
  - Isolated infantry (no friendly within 180u) under fire: −morale, more likely to seek cover / fall back.
- Awareness already exists; tune reaction thresholds so nearby tank presence and explosions produce visible morale/suppression events in the log.

### 6. Enemy AI Defensive Bias

- For this mission, enemy default posture = **defend** at their assigned strongpoint. They only advance/counterattack when:
  - Player force enters their engagement radius, OR
  - Adjacent strongpoint falls (triggers a counterattack squad from Leipalingis reserve).
- Reuse existing squad brain; add a `postureHint: 'defend' | 'counterattack'` on spawn.

### 7. Out of Scope (explicit)

The user's brief is enormous; we honestly flag what we will **not** ship in this pass to keep the change reviewable:

- New full-body animated soldier models, lean-from-cover, prone crawling, reload anims (engine is instanced low-poly; would require a character rig pipeline).
- Building interiors / room clearing.
- Bullet-physics penetration model per material (current model is LOS + cover multiplier — will keep, just ensure walls fully block).
- Weather, time-of-day, smoke rendering beyond existing.
- Difficulty selector (defer; current AI already scales via wave/squad logic).
- Artillery call-ins (deferred; can be a follow-up once single-mission scaffold is in).

These can each be follow-up passes once the single-mission scaffold lands.

---

### Technical Section

Files to add:
- `src/game/missions/leipalingis.ts` — mission def + init.
- `src/components/DeploymentScreen.tsx` — pre-mission planner.
- `src/game/deployment.ts` — village metadata + assignment → spawn logic.

Files to modify:
- `src/game/missions/index.ts` — export only Leipalingis; keep `MissionDef` type.
- `src/game/terrain.ts` — new `layoutLeipalingis`; `generateTerrain(layout, seed, cols?, rows?)`.
- `src/game/types.ts` — `MissionDef.mapCols/mapRows?`, `state.timeScale`, `postureHint`.
- `src/game/engine.ts` — apply `timeScale`, remove kill-reward except mission flag (already), use per-mission map size.
- `src/game/ai.ts` / `src/game/squads.ts` — support-aura bonuses, defend posture.
- `src/components/GameHUD.tsx` / `GameUI.tsx` — speed selector, updated hotkey legend.
- `src/pages/Index.tsx` — flow: Briefing → Deployment → Game.
- `src/scene3d/Scene3D.tsx` — trench entry/exit tween, no other visual scope changes.

Removed:
- `MissionSelect.tsx` (replaced by Briefing/Deployment flow).
- `missions/assault.ts`, `defend.ts`, `recon.ts`, `convoy.ts` (or kept as dead code — will delete).

Verification:
- Type check clean.
- Playwright smoke: land on briefing → deploy → units appear at correct village → time-scale buttons change tick rate → dig trench → unit remains visible in trench.
