# Nature assets — imported into the game

These CC0 assets were imported from publicly available GitHub repositories for evaluation in Forward Base Command. They are now rendered by `src/scene3d/RealisticVegetation.tsx` in the visible forest sections, alongside the procedural woodland. The imported geometry is visual only and does not change terrain cover, collision, or movement.

## Pine Tree 01 — optimized OBJ (CC0)
- Original asset: https://polyhaven.com/a/pine_tree_01 (Poly Haven, CC0)
- Game-optimized derivative: https://github.com/drsnuggles8/OloEngineBase/tree/master/OloEditor/SandboxProject/Assets/Models/Vegetation/pine
- Formats: OBJ + MTL + PNG textures, about 25,146 triangles.
- License and provenance: `pine/LICENSE.md`.
- **Important: foliage texture is a provisional placeholder.** The original `pine_foliage.png` in the source GitHub repository exceeds the accessible binary-download limit. This directory includes an identical copy of `pine_card.png` under the name `pine_foliage.png` so the MTL references resolve; foliage appearance may therefore be inaccurate. Replace it with the original `Textures/pine_foliage.png` from the source before production use. No geometry has been modified.

## Fern 02 — original Poly Haven 1K glTF (CC0)
- Asset: https://polyhaven.com/a/fern_02
- GitHub mirror: https://github.com/Joshkaki00/godotmark/tree/main/art/nature-benchmark-archive-20260311_173846/fern_02_1k.gltf
- Complete glTF model, binary buffer and three JPEG PBR textures.
- License: Poly Haven CC0, https://polyhaven.com/license

## Integration notes
- `src/scene3d/RealisticVegetation.tsx` loads pines with OBJLoader and ferns with GLTFLoader, preserving the fern's sibling `fern_02.bin` and `textures/` directory.
- The new visuals are instanced and capped per visible map section. High graphics allows 8 pines / 44 ferns per section; Standard allows 3 / 16.
- The previous trees remain as fallback and maintain their existing canopy/cover visuals; imported models do not add gameplay collision.
- **Pine foliage is provisional** until its true atlas replaces the card placeholder. Check the pine silhouette in game before relying on it as the final tree style.
- Runtime graphics and frame rates must be checked in Lovable before applying the imported vegetation to larger areas.
