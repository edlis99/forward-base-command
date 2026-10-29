# Leipalingis forest renderer: 3D model upgrade

## Why the earlier upgrade still looked like a PS1 game
The old trees in `VolumetricTrees.tsx` used **literal cones and icosahedron
blobs** for crowns. The subsequently uploaded opaque SVG foliage maps were
only painted across those primitive shapes. That cannot reproduce branching,
needle structure or real leaf silhouettes; it was a geometry problem.

## Active replacement
The new forest renderer is organized in three levels of visual fidelity:

1. **Real imported Scots pine close to camera (High graphics).**
   `ImportedPines.tsx` instances the locally retained CC0 Poly Haven
   `pine/pine.obj`, 25,146 source triangles, with source bark texture and a
   transparent needle-sprig substitute. The source's original detailed foliage
   atlas remains missing, so its foliage is not an exact reproduction.
2. **Branching botanical meshes (all five species).**
   `ForestMeshes.ts` builds tapered multi-segment trunks, real secondary
   branches and many independent twigs. Twig tips carry transparent alpha-tested
   needle-sprig / leaf SVGs rather than one 2D card for a whole tree.
   Birch, oak, alder and spruce have their own growing patterns.
3. **Performance LOD.**
   `VolumetricTrees.tsx` shares buffers by species/variant, instances trees
   by section, and switches the closest trees into higher-detail meshes.
   Far trees still retain branches and botanical leaves. Foliage casts no
   overly dark whole-tree shadow; wood can cast shadows.

The **woodland location rules are unchanged**: pine probability is higher in
the Gailiūnai / Didžiasalis area, and broadleaf woodland is common elsewhere.
This is an artistic approximation based on named settlements, not surveyed
stand-by-stand forestry data. Forest cover and unit LOS are unchanged.

## Files and licensing
- `pine/pine.obj`, `pine/Textures/pine_bark.png`: existing Poly Haven Scots
  pine, CC0; see `pine/LICENSE.md`.
- `trees/{pine,spruce,birch,oak,alder}_sprig.svg`: original, transparent
  botanical texture cutouts (needles and species-specific leaves).
- `trees/{spruce,birch,oak,alder}_bark.svg`: previously generated bark texture.
- The older `*_foliage.svg` files are retained as unused intermediate
  textures and no longer determine the tree silhouette.
- Original OBJ/GLTF shrub, fern and grass assets remain instanced in the
  undergrowth renderer.

## Visual quality and remaining limitations
This change replaces primitive geometry with real branching meshes, but it is
**not equivalent to photorealistic production foliage packs**. Only the
Scots pine has an imported detailed source mesh at close range. Broadleaf
species still use procedural branching geometry and vector leaf cutouts,
not purchased photogrammetric or scanned birch/oak assets. The pine's original
high-resolution foliage atlas has not been imported. For full Broken Arrow
quality, add correctly licensed optimized 3D birch/oak/spruce models with
production foliage atlases, plus shadow and lighting calibration.

Browser screenshot checks, FPS benchmarks and successful Lovable deployment
have **not been verified** in this environment. Tests guard model paths, mesh
geometry and LOD construction; loading and visual appearance still require
testing in the actual game.
