# Dzūkija / Leipalingis architectural graphics pass

The building layout and shared 1K textures in this directory were assembled for Forward Base Command. All seven image files are derived from **Poly Haven CC0** materials, redistributed here for use in the public repository. The source host repositories are public mirrors; model geometry is original in-game procedural construction.

## Materials
| Game file | Poly Haven material (CC0) | GitHub copy |
| --- | --- | --- |
| `wood_siding.jpg` | [Wood Plank Wall](https://polyhaven.com/a/wood_plank_wall) | [Veil-of-the-Locust](https://github.com/aidandavey/Veil-of-the-Locust) |
| `wood_weathered.jpg` | [Weathered Planks](https://polyhaven.com/a/weathered_planks) | [Veil-of-the-Locust](https://github.com/aidandavey/Veil-of-the-Locust) |
| `brick_red.jpg` | [Red Bricks 04](https://polyhaven.com/a/red_bricks_04) | [mgsx-dev/gdx-gltf](https://github.com/mgsx-dev/gdx-gltf) |
| `concrete.jpg` | [Concrete Floor](https://polyhaven.com/a/concrete_floor) | [Operation Steel Tide](https://github.com/AetherRadar/operation-steel-tide) |
| `roof_clay.jpg` | [Clay Roof Tiles](https://polyhaven.com/a/clay_roof_tiles) | [OpenRCsimulator](https://github.com/bultodepapas/OpenRCsimulator) |
| `roof_slate.jpg` | [Roof Slates 03](https://polyhaven.com/a/roof_slates_03) | [OpenRCsimulator](https://github.com/bultodepapas/OpenRCsimulator) |
| `roof_corrugated.jpg` | [Corrugated Iron](https://polyhaven.com/a/corrugated_iron) | [Operation Steel Tide](https://github.com/AetherRadar/operation-steel-tide) |

All assets: https://polyhaven.com/license (CC0 1.0).

## Regional design reference

- [Dzūkija traditional architecture – Etninės kultūros globos taryba](https://www.ekgt.lt/etnografiniai-regionai/dzukija-dainava/tradicine-architektura.html)
- [Dzūkija cultural notes – Bank of Lithuania](https://www.lb.lt/en/flyers/dzukija-en)
- [Pirkia – Visuotinė lietuvių enciklopedija](https://www.vle.lt/straipsnis/pirkia/)
- [Traditional Lithuanian homesteads – Visuotinė lietuvių enciklopedija](https://www.vle.lt/straipsnis/lietuviu-tradicines-sodybos/)

The game uses *representative*, not survey-accurate, building footprints. The underlying geographic settlement anchors, imported roads and water are unchanged. Farmsteads add rear granaries/barns, accessible yards, picket fences, wells, gardens and small orchards. Villages emphasize timber cottages with broad gabled roofs, painted window trim, front porches and chimneys; the Leipalingis / Seirijai cores retain interwar masonry homes, workshops, church landmarks and a limited number of post-war apartment blocks.

## Implementation
- `src/game/maps/leipalingis.ts`: building style distribution, roadside alignment, homestead outbuilding grouping and yards placed behind dwellings.
- `src/scene3d/Environment.tsx`: instanced 3D buildings and farm props, material batches, roof UV mapping and reused 1K CC0 textures.
- `src/scene3d/Scene3D.tsx`: buildings load within a Suspense boundary without blocking the whole terrain.
- No unit movement, tactical cover/LOS definitions, mission IDs, roads or water shapes were intentionally changed.
- Texture maps are diffuse-only. These are stylized performance-oriented meshes with realistic surface texture, **not** full photogrammetric buildings or verified replicas of actual addresses.
- The visual result and frame rate still require an in-game check after the GitHub/Lovable sync.
