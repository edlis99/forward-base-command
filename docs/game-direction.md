# Project direction — agreed with Edvinas, 2026-09-22

The reference for presentation and strategic control is **Broken Arrow**, initially with substantially simpler graphics and mechanics. The longer-term reference for match pace, objectives and modes is **Squad**, translated into a strategy game rather than first-person play.

Settlements are central to this direction. They must read as separate places in both deployment and the playable world: recognisable built-up centres, street networks, entrances, yards and defensive positions, separated by fields, woodland and travel corridors. Names or icons alone are not sufficient. The map must support fighting for an actual place and moving between places.

Current priorities:

- Correct the relationships between soldiers, vehicles, buildings and road widths.
- Build continuous road surfaces and junctions; avoid independently overlapping asphalt patches.
- Preserve town centres instead of clearing them to spawn troops. Stage forces on settlement outskirts.
- Use one set of settlement locations/boundaries for terrain generation, deployment, world labels and tactical navigation.
- Keep real Leipalingis-area geography as the spatial reference, with explicitly documented tactical compression and stylised architecture.

Later direction, not an implementation claim:

- Slower, more deliberate squad-based pacing and combined-arms decisions.
- Invasion and other Squad-inspired modes, controlled through a Broken Arrow-like strategy interface.
- Meaningful settlement sectors, approaches, staging, supply/reinforcement decisions and transitions between objectives.
- Decide detailed mode rules, tickets, logistics, multiplayer and balance in later work. The current scope remains the single-player campaign.

Use original assets and UI. These games are design references, not assets to copy. Future work should consult this document before changing map structure, unit scale, pacing or modes.

## First map expansion

The accepted next step is 440 × 320 gameplay cells over the same Leipalingis region (twice each dimension, four times the playable area). Increase actual settlement content and preserve local unit/building scale. Sectional rendering is the foundation for evaluating a later 880 × 640 target; that larger version is not yet implemented or performance-certified.

## Tactical troop control

Selection uses a consistent screen-space anchor for friendly map badges, hover and drag selection. Shift-click toggles a unit; Shift-drag adds; Ctrl-drag removes. Double-click selects visible units of the same type. Ctrl+A selects all living, dismounted friendly units; Escape clears selection. The bottom roster retains the original selection while type filters and +/− controls choose a subset. Click a roster card to isolate a unit, Shift-click to toggle it, or double-click to focus the camera. Reinforcements remain available in the panel's menu.

New movement orders default to **Move together**. Ground units share an attainable speed after terrain, fatigue, suppression and morale penalties, with leaders slowing or waiting for stragglers. Aircraft travel separately. Auto formation puts armour ahead on open approaches, infantry ahead in built-up/restricted ground, and APCs behind. Local avoidance, slow vehicle reversing and stopping to turn resolve congestion without changing the assigned destination. Queued legs retain facing and attack-move intent and start together once the group finishes the previous leg. **Move independently** affects subsequent orders, allowing each unit its own speed; it does not change orders already in progress.

Right-click a cover object to occupy separate infantry positions, or use **Take cover / C** to seek nearby cover. Field rocks provide hard cover; brush primarily provides concealment. Existing hay, logs, low walls, wrecks, barricades, buildings, woodland, hedges, rubble and trenches remain useful. An amber shield shows an approach to cover; a green shield, **In cover** status and crouched pose indicate a stationary soldier benefiting from cover. Roads still trade faster travel for exposure. Shift/Ctrl+right-click keep waypoint/attack-move semantics.

This remains an abstract tactical model: cover bonuses are per terrain cell, not directional per-projectile geometry; there are no building interiors, infantry squads represented by multiple animated soldiers, or full vehicle drivetrain physics yet. Those are future systems, not implied by these controls.

## Combat engagement and reaction to fire

How units behave once shooting starts (implemented in `src/game/units.ts`, tuned in `constants.ts`):

- **Attack-move stands and fights.** A player unit on `attack_move` halts when it has a visible target in range, keeps its destination and queued legs, and resumes the advance when the contact is over. After `MAX_ENGAGE_TIME` of stalemate it pushes on for `DISENGAGE_GRACE` seconds so a stand-off cannot freeze an advance. Plain `move` orders never halt: that is how a unit deliberately runs the gauntlet. Enemy AI orders are unchanged.
- **Soldiers shoot on the move.** Infantry and helicopters turn to their target while walking (with the existing moving-accuracy penalty); only hulls steer by heading. Retreating units run and do not aim.
- **Targets are scored, not just nearest.** `scoreTarget` weighs proximity, threat by unit type (`TARGET_THREAT`), weapon effectiveness against armour, whether the enemy is firing at this unit, and how wounded it is. The current target is kept unless a rival beats it by `RETARGET_HYSTERESIS`; re-evaluation happens every `RETARGET_INTERVAL`. A target that leaves range or sight is dropped, so being hit by a long-range unit no longer blinds a unit to nearer enemies. The enemy AI uses the same selection.
- **Ordered attacks pursue.** An explicit attack order closes to `CHASE_STANDOFF` x weapon range with a clear line of fire, stops and fires, follows a moving target, searches the last known position when it is lost, and lapses after `TARGET_LOST_TIMEOUT` or when the target dies.
- **Suppression depends on the weapon.** `suppressionScale` makes small arms barely rattle armour and aircraft (`SUPPRESSION_RESIST`, `SMALL_ARMS_VS_VEHICLE`); only infantry go prone and become pinned.

Open balance questions: whether a squad should wait for a pinned member or push on (currently waits, covered by a test), and whether capturing should require clearing the garrison, since a straight rush to a point is now very reliable.

## Multiplayer foundations (player vs AI keeps working as before)

The simulation (`src/game`) is now organised so a server can run it and two browsers can play it. Nothing here adds networking yet.

- **Deterministic simulation.** All gameplay randomness goes through `random(state)` (`rng.ts`, seeded via `createInitialState(mission, ctx, { seed })`). Unit ids are per match. Same seed + same commands = same match, checked by `stateDigest` and by `replayMatch`. Single-player starts with a random seed (`GameUI.tsx`).
- **Commands are the only way to act.** `commands.ts` defines serializable commands (`move`, `attack`, `board`, `stance`, `hold`, `dig`, `disembark`) that name units by id. `applyCommand(state, team, cmd)` validates ownership, bounds, visibility and shape. The mouse/selection functions in `engine.ts` are thin wrappers that build these commands, so the UI is unchanged.
- **Authoritative match loop.** `match.ts`: `createMatch`, `submitCommand`, `stepMatch` (fixed 20 Hz), `replayMatch`, `snapshotFor(match, team)`. Snapshots enforce fog of war: own units in full, enemies only while spotted, no hidden fields.
- **Who controls a side.** `state.controllers` (`human` | `ai`). The built-in AI only plays a side with no human; the stop-and-fight rule applies to every human side.
- **Fair fights.** Combat resolves in a seeded random order each tick. Measured: the first-listed side won ~70% of symmetric 4v4 fights before, ~52% now.
- **Head-to-head rules.** `capture.ts` (symmetric capture) and `duel.ts` (`makeDuelMission`: points race, time limit, elimination). Not wired into the menu yet.

Not done yet: the network server and lobby; client interpolation of snapshots; a symmetric 1v1 map (`mirror()` reflects spawns through the map centre but terrain is not symmetric); commands for trench lines, reinforcements, fire support and formation preference (the latter can already be sent per `move`); the AI and squad brain still assume they play `'enemy'`; team ids `'player'`/`'enemy'` act as side A/B.

## RAAS mode (rules implemented, map pending)

`src/game/raas.ts` implements the competitive RAAS variant from `docs/squad_gameplay_and_competitive_map_design.md`: one chain drawn from an authored pool before deployment (`pickChain`) and revealed to both sides; capture in sequence from each side's end, recapture in both directions (double neutral falls out of the rule); dismounted infantry only, minimum commitment (1 to capture neutral, 2 to neutralise), strict superiority, equal strength stalls, extra infantry speed capture up to 2x, abandoned attempts drain back; tickets for losses, lost points and a territorial lead of two or more. `updateRaasAi` plays any AI-controlled side through `applyCommand`, with the same information. Snapshots tell each side which objective it may attack and why progress is stalled, without revealing head counts. All numbers in `DEFAULT_RAAS_RULES` are first test values.

Not yet selectable in the menu: it needs the RAAS version of the map and a ticket HUD.
