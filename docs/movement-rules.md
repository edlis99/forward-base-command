# Movement rules

The rules every unit follows when it moves. Each one is enforced in code and
checked by a test, so a later change cannot quietly break it.

| # | Rule | Where | Test (`src/test/movement-rules.test.ts` unless noted) |
|---|------|-------|------|
| M1 | **Hulls never slide sideways.** Tanks and APCs only move along their heading: forwards, or backwards when reversing. | `moveUnit` (`units.ts`) | "tanks drive along their hull" |
| M2 | **Vehicles turn before they drive.** Speed falls off sharply when the hull is not pointing where it is going, so a tank pivots first instead of drifting round in an arc. | `moveUnit`, `alignFactor` | "a tank pivots before it drives off sideways" |
| M3 | **Short hops backwards are driven in reverse.** If the destination is behind the hull (more than 110° off) and closer than 6 cells on a straight route, the vehicle backs up at 45% speed, keeping its front towards the enemy. Longer moves turn round. | `moveUnit` (`REVERSE_*`) | "reverses a short hop back", "turns round for a long move back" |
| M4 | **Soldiers walk the route directly** and can sidestep; they never drive in arcs. | `moveUnit` | `groupMovement.test.ts` |
| M5 | **Groups move together.** A squad moves at its slowest member's pace and keeps its formation; leaders wait for stragglers. | `playerSquads.ts` | `troop-control.test.ts` |
| M6 | **No permanent traffic jams.** A unit stuck behind friendlies counts as arrived when close enough (2.2 cells after 2.5 s, or 4 cells after 6 s), and plans a new route after 10 s further out. | `moveUnit` traffic handling | `troop-control.test.ts` ("brings the deployed mixed campaign force…") |
| M7 | **Terrain decides who goes where.** Vehicles stay off water, woods and buildings and take roads where they are faster; infantry go almost anywhere, slower in mud and woods. | `pathfinding.ts`, `terrain.ts` | `leipalingis-map.test.ts`, `leipalingis-raas.test.ts` |
| M8 | **Attack-move stops to fight; plain moves do not.** | `updateCombat` | `engagement.test.ts` |
| M10 | **Road march.** A move of 25+ cells that is mostly on roads becomes a single column: vehicles lead, infantry follow, each unit keeps its interval behind the one ahead (vehicle behind vehicle 2.2 cells, mixed 1.6, infantry 1.0). The column leaves one by one, stays on the road for the march (measured on two routes: 96% and 88% of the time, against 84% and 78% before), and leaves it in the last stretch to deploy into formation in the fields beside the road. Attack-moves never form columns. | `setupRoadMarch` (`playerSquads.ts`), `moveUnit` | "drives a long road move as a spaced column…", "does not form a column…" |
| M11 | **Realistic intervals in formation.** Slots: tanks 52 px and APCs 48 px apart (about 1.5 cells), infantry 26 px. Measured after arrival: APCs 0.99 cells apart (was 0.55), tanks 1.45 (was 1.29), closest infantry 0.56 (was 0.43). | `slotSpacing` (`playerSquads.ts`) | "spreads units out in formation…" |
| M12 | **Soldiers give way to vehicles.** A parked friendly soldier in a vehicle's way steps aside instead of the vehicle waiting. | `moveUnit` | covered by the M10/M11 tests |
| M13 | **Vehicles drive round parked vehicles.** A vehicle blocked by a parked friendly vehicle takes a short detour beside it, towards its goal. | `moveUnit` | covered by the M10/M11 tests |
| M14 | **No vehicle is left standing because its slot is unreachable.** A slot in a wood or hedge is moved to the nearest spot the vehicle can reach. | `issueSquadMove` | "drives a long road move as a spaced column…" |
| M9 | **Boarding:** with APCs and infantry selected, **U** sends each soldier to the nearest selected APC with a free seat (4 per APC); with only APCs selected, **U** unloads them. | `loadOrUnloadSelected` (`engine.ts`) | "U loads selected infantry…", "U unloads…" |

Measured on the real map (Jovaišiai to Leipalingis, 2 tanks, 2 APCs, 6 infantry): before M10/M11 vehicles were on the road 84% of the time and drove 0.84 cells apart (bumper to bumper); after, 96% on the road, 2.5 cells apart, and the column arrived faster (191 s instead of 228 s) because it no longer jammed.

Visual rule that goes with M1: every unit model must face +X in the game
(yaw 0). The tank model's gun points along -X in its file, so
`FactionModels.tsx` turns it half round.
