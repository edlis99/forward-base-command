## Stage 0 — Audit of what exists today

I read the full codebase. Here is the real state, not aspirational.

**Engine / loop**
- `src/game/engine.ts` runs the fixed update: boarding → movement → dig → hold-position → awareness → combat → AI → mission script.
- `src/game/types.ts` already has rich `Unit` + `TerrainCell` shapes (suppression, morale, prone, ambushReady, finalDest, detectionLevel, lastKnownPos, etc.).
- `src/game/units.ts` does movement, A* re-paths on stall, separation, and the entire combat resolution (accuracy, cover, flanking, suppression, kills, morale shock).
- `src/game/ai.ts` has reaction delays, hold-fire ambush trigger, cover-firing-position picker, flank approach, vehicle standoff, retreat/rally.
- `src/game/terrain.ts` — 14 terrain types with cover/concealment/movement-cost/blocksLOS, plus `hasLineOfSight` and `losInfo` with concealment sum.
- `src/game/awareness.ts` — proper spotting model: detection level builds with distance falloff, concealment, stance, movement, recent fire; ghost contacts when LOS lost.
- `src/game/pathfinding.ts` — A* exists, vehicle/heli passability respected.
- `src/game/formations.ts` — line/wedge/column solver.

**Rendering / input**
- `src/scene3d/Scene3D.tsx` — R3F scene, instanced terrain, low-poly unit models, projectiles, capture point rings, path lines for selected units.
- Selection box rendered as a faint 3D quad on the ground (`SelectionBox`). Input handled on an invisible `Ground` plane via R3F `onPointerDown/Move/Up`.

**UI**
- `GameHUD.tsx` — objectives, capture points, stance/formation/dig buttons, event log, hotkey legend.
- `GameUI.tsx` — drives the loop and key bindings (`H`/`F`/`X`/`G`/`Y`/`T`/`1`/`2`/`3`/`0`/Esc).
- `MissionSelect.tsx` — picks mission.
- 4 missions wired: Assault / Defend / Recon / Ambush. **There is no dedicated "hold 2 CPs for 4 waves" survival mission separate from Defend** — Defend already does that on `village_crossroads`.

### Gaps vs. the brief

| Area | Status |
|---|---|
| Drag-select visual readability | Weak — 20% opacity blue quad on ground, no border, no preview highlight on units inside the box |
| Drag threshold | World-units only (15px), not screen-pixel; tap can still create a tiny box |
| Hover feedback | None |
| Command markers (move/attack/capture pings) | None |
| Formation preview ghosts at destination | None |
| Terrain gameplay data | Already strong, but **AI does not query a unified "tactical score"** — only a small cover scan |
| Squad-level AI | None — every enemy thinks alone |
| Threat map / last-seen memory | Partial: `lastKnownPos` exists, no decay-based threat field |
| Flanking planner | Only per-unit `flankApproach`; no multi-squad coordination |
| Wave director | Inline timer in `defendMission.update` — hardcoded composition, single lane |
| Debug overlays (cover / threat / LOS) | None |

---

## Stage roadmap (will be done in subsequent messages, one stage per turn)

1. **Selection & command feedback** (this turn)
2. **Terrain debug overlay + tactical-score query API** (read-only system other stages use)
3. **Squad controller + threat map + last-seen memory**
4. **Cover-seeking refactor + suppression/morale wiring through squad brain**
5. **Flanking planner + dynamic aggression**
6. **Wave Director module (replaces inline wave code in Defend)**
7. **Tactical UI polish: capture point widget, command pings, debug toggles**

No file will be touched outside the stage's listed scope.

---

## Stage 1 — Selection & Command Feedback (implement now)

### Goal
Player always knows: (a) exactly what rectangle they are drawing, (b) which units it will grab, (c) which units are currently selected, (d) what each command did.

### Changes

**1. Selection box, screen-space**
- Replace the 3D ground quad with an HTML `<div>` overlay anchored to the canvas container. Strong border (2 px solid cyan), 12% fill, drop shadow. Rendered from `state.selectionBox` projected through the camera each frame via a tiny screen-space hook.
- Falls back gracefully if camera not ready.

**2. Drag threshold in screen pixels**
- Track pointerdown screen X/Y in `inputRef`. Only promote to a box-select after the cursor moves > 5 px in screen space. Tap stays a click → unit select.

**3. Live preview highlight**
- Add `previewSelected: Set<string>` to `GameState`. Each `pointermove` while dragging, recompute units inside the current rectangle (player team only) and mark them.
- New ring around preview units: dashed cyan, 0.6 opacity, slightly larger than the confirmed selection ring. Cleared on pointer-up.

**4. Confirmed selection visual upgrade**
- Selected ring becomes a thicker arc with a subtle pulse (sin-driven scale, 0.95 → 1.05, 2 Hz).
- Player units = cyan `#7ec0ff`, enemy reveals = orange. Keep current ring height to avoid z-fighting.

**5. Hover feedback**
- New thin gray ring on the unit currently under cursor (player units only). Computed from `inputRef.mouseWorldPos` each frame — no extra raycast.

**6. Command markers (pings)**
- New ephemeral array `state.commandMarkers: { pos, type: 'move'|'attack'|'capture'|'board'|'hold', team, timer, max }[]`.
- Spawned by `handleRightClickWorld` (and `holdPositionForSelected`).
- Renderer draws a quick scaling ring (1.0 → 1.6 over 0.6 s, fading) on the ground at the marker pos. Color per type: move = cyan, attack = red, capture = yellow, hold = white, board = green.
- Timer ticked in `engine.update`.

**7. Formation preview at destination**
- During right-click drag (right button held), show ghost circles at the formation slots so the player sees the shape before committing. Implemented via a `state.commandPreview: { slots: Position[] }` updated on right-button-held + mousemove, cleared on release.
- If this proves laggy on the first pass, fall back to a single ring (preview controlled by a `SHOW_FORMATION_PREVIEW` flag).

### Files

- **edit** `src/game/types.ts` — add `previewSelected`, `commandMarkers`, `commandPreview` to `GameState`; add `dragStartScreen` to `InputState`.
- **edit** `src/game/engine.ts` — drag-threshold logic moved here via new `tryStartBoxSelect`/`endBoxSelect` helpers; spawn command markers in `handleRightClickWorld`/`holdPositionForSelected`; tick markers in `update`.
- **edit** `src/scene3d/Scene3D.tsx` — remove 3D `SelectionBox` quad; add `<SelectionOverlay/>` HTML overlay; preview / hover / pulsing rings on units; command-marker layer; right-click drag formation preview.
- **edit** `src/components/GameUI.tsx` — wrap `<Scene3D>` in a positioned container so the overlay can absolutely-position over the canvas.
- No backend, no new deps.

### Out of scope this turn
- Terrain debug overlay, threat map, squad AI, wave director, flanking planner, dig cursor — those land in their own stages.
- New unit models, animations.
- Mission rebalance.

### How to test after I ship Stage 1
1. Click an empty patch → no selection box flashes.
2. Press LMB and drag 30 px → see a crisp cyan rectangle; units inside light up cyan in real time; release → those units become selected.
3. Shift-drag → adds to current selection.
4. Hover a friendly unit → faint ring under it.
5. Right-click ground → cyan move ping; right-click enemy → red attack ping; press H → white hold ping.
6. Right-click while holding the button and dragging across the map → ghost formation slots follow under cursor.

I will not start coding until you approve this plan.
