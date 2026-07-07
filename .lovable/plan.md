
## Build slice: Objective loop + Leipalingis garrison (#2 + #3)

Goal: turn the scaffold into an actual playable operation with a real "take the town or lose" loop.

---

### A. Leipalingis garrison layout

Extend `missions/leipalingis.ts` (or the mission init) to spawn a layered defence at mission start:

- **Outer trench line**: 3 short trench segments on the N/E/S/W approaches, each with 2 infantry (`postureHint: 'defend'`, `stance: 'defend'`, `order: 'hold_position'`, homePos on the trench cell).
- **MG nests at 4 chokepoints**: sandbag ring + 1 infantry with reduced range/higher accuracy tag (reuse existing infantry stats; just place them at chokepoint cells identified from `buildLeipalingisRegion`).
- **Forward outposts**: 1 small squad (2 infantry) at each of the 5 approach villages with `postureHint: 'defend'`, hold_position on the village anchor.
- **Town-centre reserve**: 1 reserve squad (3 infantry + 1 APC) parked at the church block, `postureHint: 'counterattack'`, initially `hold_position` with `homePos` = church.

Chokepoint/church coordinates come from the anchors already stored during `buildLeipalingisRegion` — expose them via a returned metadata object (or a small `getLeipalingisAnchors()` helper) so the mission init can read them without re-deriving from raster.

### B. Capture zone

- Add `state.captureZone = { pos, radius: 22, progress: 0, holder: 'enemy' | 'player' | 'contested' }` to `GameState`.
- Each tick: count alive player units and alive enemy units inside radius.
  - Only player present → progress += dt / 90 (90 s uncontested to flip).
  - Only enemy present → progress -= dt / 60 (enemies retake slower).
  - Both / neither → progress decays 5 %/s toward 0 while contested, holds while empty.
- When progress ≥ 1 → `holder = 'player'`, objective "Capture Centre" complete.

### C. Counterattack trigger

- First time a player unit enters capture radius, fire once:
  - Wake the church reserve squad: set `order: 'attack_move'`, `postureHint: 'counterattack'`, destination = capture zone centre.
  - Log event: "Enemy reserves counterattacking from town centre".

### D. Secondary objectives

- One per approach village: "Clear <village>" — completes when no alive enemy within 40 u of the village anchor.
- On completion:
  - +10 morale floor for all player units for 30 s (temporary buff via a new `state.moraleBuffUntil` timer).
  - Grant one reinforcement token (adds 2 infantry at the nearest friendly deployment village).
  - Log event.

### E. Win / loss

- **Win**: capture zone `holder === 'player'` AND progress ≥ 1.
- **Loss**: player alive strength (sum health/maxHealth) < 25 % of starting strength AND not holding capture ring.
- On either, set `state.result = 'victory' | 'defeat'`, freeze `timeScale = 0`.

### F. Post-mission summary

New component `MissionSummary.tsx` shown when `state.result` is set:
- Title: Victory / Defeat.
- Stats: enemies killed, units lost, mission time (mm:ss), objectives (✓/✗ list).
- Buttons: "Return to Briefing" (calls existing `exitMission`), "Retry" (re-runs briefing → deployment).
- Wire into `GameUI.tsx` render — overlay above the 3D scene when `gameStateRef.current.result` is set.

### G. HUD additions

Small additions to `GameHUD.tsx`:
- Capture progress bar (top-centre) with holder colour.
- Objective checklist panel (primary + secondaries).
- Reserve counterattack warning banner (fades after 5 s).

---

### Files

**Modify**
- `src/game/types.ts` — `GameState.captureZone`, `result`, `objectives[]`, `moraleBuffUntil`, `Unit.postureHint` if not already there.
- `src/game/terrain.ts` — return anchor metadata from `buildLeipalingisRegion` (church, chokepoints, trench cells, village centres).
- `src/game/missions/index.ts` / `leipalingisMission` init — spawn garrison using anchors, seed objectives + capture zone.
- `src/game/engine.ts` — capture-zone tick, counterattack trigger, win/loss check, reinforcement token application.
- `src/components/GameHUD.tsx` — capture bar, objectives panel, counterattack banner.
- `src/components/GameUI.tsx` — render `MissionSummary` overlay when result set; wire Retry.

**Create**
- `src/components/MissionSummary.tsx`.

### Out of scope for this slice
- Artillery / off-map fire support (still deferred).
- Trench tween + tracer/muzzle-flash pass (that's slice #1, follow-up).
- New animations or character rigs.

### Verification
- Type check clean.
- Playwright smoke: briefing → deploy at Seirijai → advance to town → confirm counterattack log fires → hold zone → victory summary appears.
