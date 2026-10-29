# Textures for volumetric Leipalingis trees

These ten maps are applied to **three-dimensional instanced tree meshes** in
`src/scene3d/VolumetricTrees.tsx`. Nothing in this folder is a flat billboard
or a complete photographic tree model.

## Texture files

| Tree | Foliage map | Bark map |
| --- | --- | --- |
| Scots pine | `pine_foliage.svg` | Existing `../pine/Textures/pine_bark.png` (imported Poly Haven model texture) |
| Spruce | `spruce_foliage.svg` | `spruce_bark.svg` |
| Birch | `birch_foliage.svg` | `birch_bark.svg` |
| Oak | `oak_foliage.svg` | `oak_bark.svg` |
| Alder | `alder_foliage.svg` | `alder_bark.svg` |

The new 512 × 512 SVG patterns were generated specifically for this project
with deterministic leaf, needle, branch and bark detail. They use fully opaque
colours and can be rasterized by the browser as colour textures, with subtle bump
mapping in Three.js. Their patterns are original, not scraped from paid packs.
Pine bark is the real texture already present in the licensed CC0 source pack.

The tree crowns remain simplified low-polygon solids. These maps provide actual
surface colour and micro-detail, but do **not** make the geometry photorealistic.
For that, upgrade to licensed bark/foliage atlas meshes or detailed species LODs.

All textures load locally from `/assets/nature/trees/`, and
`src/scene3d/preloadVisuals.ts` prefetches them before the mission begins.

The procedural SVG patterns are offered as part of this game's source assets.
See `../pine/LICENSE.md` for the source bark's Poly Haven CC0 provenance.
