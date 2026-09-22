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
