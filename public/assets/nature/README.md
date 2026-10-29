# Leipalingis forest visuals and asset credits

## Current rendering (October 2026)
The previous visual defect was caused by crossed alpha-textured planes, not a lack
of tree data. Under the old renderer, all broadleaf trees and nearly every pine
were 2D texture cards; only up to 10 actual pine OBJ meshes per nearby section
appeared on High quality, and the OBJ's foliage image was incomplete.

**The active forest renderer is now fully three-dimensional at all distances.**
`src/scene3d/VolumetricTrees.tsx` batches five separate tree species using
instanced, irregular 3D crown/trunk geometry:
- Scots pine: a straight reddish trunk with raised, broken needle clusters
- Spruce: a darker, tapered canopy with layered branches
- Birch: a light trunk and pale-green oval deciduous canopy
- Oak: a broader, irregularly lobed crown
- Alder: a narrower deciduous crown

There are no crossed planes or flat textured tree cards in the normal forest
renderer. Every forest cell receives 1–2 deterministic, spatially offset trees,
with occasional natural gaps. Shadows from crowns have been disabled to avoid
very dark, flat-looking canopy silhouettes, while trunks can cast shadows.

The map's documented Gailiūnai and Didžiasalis settlements influence a
pine-dominated forest belt. Away from these centres the probability of deciduous
trees increases substantially. This is an **art-direction approximation**, not
a verified stand-by-stand forest inventory or an assertion of exact local species.
Individual tree types and placement do not change gameplay cover or LOS.

The existing CC0 3D fern (glTF), shrub (OBJ), and grass (OBJ) remain in use as
understory. Scene loading now waits for all six ground texture sets and prefetches
building/nature models before revealing the game, rather than switching from
placeholder soil after combat begins.

## Locally retained imported assets

| Asset | Source | Format | Active use |
| --- | --- | --- | --- |
| Scots pine 01 | [Poly Haven](https://polyhaven.com/a/pine_tree_01), via [OloEngineBase](https://github.com/drsnuggles8/OloEngineBase/tree/master/OloEditor/SandboxProject/Assets/Models/Vegetation/pine) | OBJ + PNG, ~25k tris | Retained as source/reference, **not rendered** until foliage atlas is corrected |
| Island tree 01 broadleaf card | [Poly Haven](https://polyhaven.com/a/island_tree_01) | PNG | Retained as reference, **not rendered** |
| Fern 02 | [Poly Haven](https://polyhaven.com/a/fern_02), mirrored in [godotmark](https://github.com/Joshkaki00/godotmark) | glTF + BIN + JPEG | Instanced 3D undergrowth |
| Shrub 02 | [Poly Haven](https://polyhaven.com/a/shrub_02), via OloEngineBase | OBJ + PNG | Instanced 3D undergrowth |
| Grass Medium 01 | [Poly Haven](https://polyhaven.com/a/grass_medium_01), via OloEngineBase | OBJ + PNG | Instanced 3D undergrowth |

All these imported models/textures were sourced as CC0. See their bundled license
notes and upstream pages. The procedural tree crowns are original project code.

## Next realism step
These replacement trees are actual volumetric meshes, but are intentionally
simplified/low-poly, not photorealistic imported species. For a more natural
Broken Arrow-like zoomed-in look, import optimised mesh LODs of licensed Scots
pine, birch and mixed broadleaf species with correct leaf opacity, trunk bark,
and atlases. Do not instanciate the original Poly Haven high-resolution
trees across the map: native models may contain millions of triangles.

## Visual/performance verification
The new code has not been measured in a running production browser here.
Check FPS, GPU memory, canopy reveal near units, scale, and browser startup
after Lovable rebuilds. Instancing greatly reduces draw calls but does not
eliminate the triangle cost of geometry.
