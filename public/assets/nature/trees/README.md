# Tree texture atlas files

## Runtime (new)
All species render many individual textured botanical sprigs on fully 3D
branches, not texture-painted geometric cones:

| Species | Transparent leaf / needle texture | Bark |
| --- | --- | --- |
| Scots pine | `pine_sprig.svg` | `../pine/Textures/pine_bark.png` |
| Spruce | `spruce_sprig.svg` | `spruce_bark.svg` |
| Birch | `birch_sprig.svg` | `birch_bark.svg` |
| Oak | `oak_sprig.svg` | `oak_bark.svg` |
| Alder | `alder_sprig.svg` | `alder_bark.svg` |

The new SVGs use transparent backgrounds and per-species cutout silhouettes.
They are small original botanical drawings rather than photographic atlas
captures. Three.js uses alphaTest on these maps, preserving visible branches
and gaps within the 3D canopy.

The previous opaque `*_foliage.svg` assets have deliberately stopped being
used at runtime. They are kept only for provenance / comparison.
The source pine bark is a retained CC0 Poly Haven import; see the source
`../pine/LICENSE.md`.

`src/scene3d/ForestMeshes.ts` is the procedural geometry builder.
`src/scene3d/ImportedPines.tsx` uses the actual source pine OBJ nearby.
`src/scene3d/VolumetricTrees.tsx` instances the low- and high-detail meshes.
