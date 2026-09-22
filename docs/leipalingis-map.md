# Leipalingis campaign map

The campaign uses a bundled OpenStreetMap snapshot around Leipalingis instead of the previous fictional radial roads and circular forests. It runs offline after the app loads.

## Geographic source and scale

- Source: [OpenStreetMap API](https://wiki.openstreetmap.org/wiki/API_v0.6), downloaded 2026-09-21.
- Bounds: west 23.710°, south 54.025°, east 24.020°, north 54.160°; approximately 20 × 15 geographic kilometres, projected north-up onto the 220 × 160 gameplay grid.
- Imported features: primary/secondary/local road and longer track centre lines, complete forest/field/water polygons including multipolygon holes, building centres and settlement coordinates. Roads 180, 133, 134 and 2505 retain their real topology.
- This is a **compressed tactical adaptation**, not a survey-scale digital twin. Road widths are exaggerated for vehicle clearance. Buildings are representative models, thinned and moved by up to two cells when necessary. Staging clearings, fighting positions, field vegetation and cover props are gameplay additions. Some small features and incomplete multipolygons are omitted. Heights are procedural, not surveyed elevation data.
- Jovaišiai is north of Leipalingis; Didžiasalis is south; Veršiai is south-east; Stračiūnai is north-east. Seirijai is outside the crop, so the fifth deployment is labelled **Seirijų kryptis**, on the northern route 180 approach.
- Deployment and gameplay use the same mission seed. Displayed distances are approximate geographic separation, not the length of a computed gameplay route.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The derived database is `src/game/maps/leipalingis-osm.json`; that licence applies to the geographic data. The interface also displays attribution.

To refresh the source with Python 3, using a persistent download cache:

```sh
python scripts/import-leipalingis.py /tmp/fbc-osm-cache
```

The importer uses 12 bounded API requests, at most two concurrently. Raw responses stay in the specified cache. It strips contributor account metadata and emits only map features. Review regenerated data and run tests before replacing the bundled snapshot.

## Movement, exposure and cover

| Surface/object | Gameplay effect |
| --- | --- |
| Asphalt | Base movement ×1.46 (`traction / movementCost`), fatigue accumulation ×0.70, detection accumulation ×1.50, no cover |
| Gravel track | Base movement ×0.89; narrow woodland tracks may only admit infantry |
| Grass shoulder | Ordinary off-road movement; wide vehicular road corridors remain clear of blocking props |
| Mixed woodland | Slower infantry movement, concealment, impassable to ground vehicles |
| Timber stack / stone wall / truck / barricade | Occupy and hold; reduces incoming accuracy and improves infantry cover |
| Hay bales | More concealment, less ballistic protection than stone walls |
| Farmhouse / courtyard | Occupy and hold; can fire from the occupied cell, but buildings between shooter and target block LOS |
| Trench | Existing strong infantry cover; vehicles route around it |

Speed figures describe terrain alone; fatigue, suppression, turning and formation cohesion still affect actual speed. Pathfinding minimises travel time. Its heuristic and smoothing preserve worthwhile road detours rather than replacing them with straight field crossings. Paths still respect diagonal obstacles and vehicle footprints.

Select infantry and **right-click a cover object** to assign separate reachable positions near it. Infantry hold their positions on arrival. If there are fewer available positions than selected troops, the remaining units receive an ordinary nearby move. Shift+right-click retains waypoint queuing; Ctrl+right-click retains attack-move. A new order cancels the hold-on-arrival intent. Props currently provide cover, not supplies or destructibility.

## Visual changes

- Continuous asphalt strips, centre dashes, edge markings, shoulders and reflector posts follow imported paths.
- Mixed pine, broadleaf and birch trees, variable crowns, pale birch trunks, undergrowth and meadow blades replace uniform cone forests.
- Batched farmhouses have pitched roofs, chimneys, windows, steps and fences; five kinds of cover have distinct models and open firing slots.
- Procedural grain adds local ground/asphalt detail without external texture downloads.
- High/Standard graphics controls pixel density and shadow resolution. Shadows concentrate on the camera view for sharper local detail.
- Initial camera focuses the deployed force. **Home** focuses selected troops, or the remaining army if nothing is selected.

## Run and check this branch

```sh
git fetch origin
git switch feat/leipalingis-map
npm ci
npm run dev
```

Open the local URL printed by Vite. Proceed to deployment, choose a starting location and deploy.

1. Compare the deployment road network with [OpenStreetMap around Leipalingis](https://www.openstreetmap.org/#map=12/54.0920/23.8598).
2. Pause with Space. Box-select infantry, right-click a timber stack or stone wall, then resume. The log should report taking cover; units should occupy different nearby positions and hold.
3. Select a unit on asphalt. Its HUD/readout shows the speed/exposure tradeoff. Compare with an off-road move; a worthwhile road detour should remain in the route.
4. Pan/zoom through a forest edge and a village. Check road bends, roofs, tree variety, cover props and shadows. Toggle High/Standard and use Home to return to the force.
5. Try a tank/APC route from each deployment to the objective. Forest and water crossings must follow passable lanes.

Automated checks: `npm test`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run build`. The map regression suite covers road travel time, route smoothing, detection exposure, blocked destinations, cover occupancy/hold, ballistic cover, building LOS, geography and access from all five staging areas. Browser smoke checks cover deployment, scene rendering, pause, selection, cover commands, quality switching and camera focus. Full hardware FPS benchmarking and a complete mission playthrough remain manual checks.
