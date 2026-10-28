# Realistic forest assets — Forward Base Command

The imported **CC0** nature assets are now used to render forests across all map layouts.
The active Three.js implementation is `src/scene3d/RealisticVegetation.tsx`, called by `TerrainSection` in `Scene3D.tsx`.

## Included assets and licenses

| Asset | Source | Format | Use |
| --- | --- | --- | --- |
| Scots pine 01 | [Poly Haven](https://polyhaven.com/a/pine_tree_01), optimized via [OloEngineBase](https://github.com/drsnuggles8/OloEngineBase/tree/master/OloEditor/SandboxProject/Assets/Models/Vegetation/pine) | OBJ + PNG; 25,146 triangles | Detailed nearby conifer trees |
| Pine card | Same as above | PNG | Crossed planes for pine stands throughout forests |
| Island tree 01 (broadleaf card) | [Poly Haven](https://polyhaven.com/a/island_tree_01), optimized via [OloEngineBase](https://github.com/drsnuggles8/OloEngineBase/tree/master/OloEditor/SandboxProject/Assets/Models/Vegetation/broadleaf) | PNG | Mixed / deciduous crowns |
| Fern 02 | [Poly Haven](https://polyhaven.com/a/fern_02), mirrored in [godotmark](https://github.com/Joshkaki00/godotmark) | glTF + BIN + JPEG PBR | Four natural fern variants |
| Shrub 02 | [Poly Haven](https://polyhaven.com/a/shrub_02), optimized via OloEngineBase | OBJ + PNG | Woodland bushes |
| Grass Medium 01 | [Poly Haven](https://polyhaven.com/a/grass_medium_01), optimized via OloEngineBase | OBJ + PNG | Low groundcover |

All of these assets are **CC0 1.0**. Source-specific attribution, provenance and details are retained in each pack's `LICENSE.md` and `README.md`, or in the Poly Haven source link above.

## Rendering and performance

- Every cell with `terrain.type === 'forest'` receives deterministic forest-cover placement; empty openings are scattered naturally, not on a regular grid.
- Pine and broadleaf tree cards provide dense forests at low cost, batched into instanced cross-planes. They also fade their foliage above friendly units via the existing canopy-reveal shader.
- A limited selection of real high-detail OBJ pine meshes renders near the camera (up to 10 per visible section in High, 3 in Standard), with distance culling.
- Instanced OBJ shrubs/grass and glTF ferns add fine detail. Density is capped per visible section and respects the current graphics setting.
- Vegetation is **visual only**: tactical forest properties, movement blocking, LOS, cover and gameplay simulations have not changed.
- The previous procedural trees are a suspense/error fallback only, not the normal forest renderer.
- The map section frustum system continues to mount only visible sections; asset loaders cache models by URL.

## Known visual limitations

**The detailed pine's foliage texture is temporarily incomplete.** `pine/Textures/pine_foliage.png` is currently a copy of `pine_card.png`, rather than the proper original texture, which was too large for the available GitHub file-transfer API. The pine cards use the intentional billboard atlas and are valid. The 3D pine foliage could look odd until the original 2 MB texture is restored from [the source repo](https://github.com/drsnuggles8/OloEngineBase/tree/master/OloEditor/SandboxProject/Assets/Models/Vegetation/pine/Textures). Avoid judging the final close-up appearance by the provisional material.

Deciduous trees are currently represented by realistic texture cards; the broadleaf high-detail mesh and its large foliage atlas have not been imported. This is an intentionally performance-conscious interim solution.

**Build and runtime testing still required in Lovable** to validate loaders, shaders, vegetation scale and FPS. The scene integration does not by itself establish measured game performance.
