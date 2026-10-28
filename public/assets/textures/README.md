# Ground texture assets

Six Poly Haven materials prepared for Forward Base Command. Each material has three 1024 × 1024 JPG maps:

- `diffuse.jpg`: base colour.
- `normal.jpg`: OpenGL normal map.
- `roughness.jpg`: roughness map.

| Folder | Original material |
| --- | --- |
| `grass/` | [Leafy Grass](https://polyhaven.com/a/leafy_grass) |
| `field/` | [Withered Grass](https://polyhaven.com/a/withered_grass) |
| `forest_floor/` | [Forest Ground 03](https://polyhaven.com/a/forrest_ground_03) |
| `dirt/` | [Brown Mud](https://polyhaven.com/a/brown_mud) |
| `gravel/` | [Gravel Road](https://polyhaven.com/a/gravel_road) |
| `asphalt/` | [Asphalt 03](https://polyhaven.com/a/asphalt_03) |

The supplied Blender archives contain some maps in EXR format. Where a JPG was absent, the matching original 1K JPG was obtained from Poly Haven. All 18 maps were checked against Poly Haven's published source checksums and decoded to verify their dimensions. No artwork or material data was generated or repainted.

These assets use [Poly Haven's CC0 licence](https://polyhaven.com/license), which permits commercial use and redistribution without required attribution.

The game serves these files from `/assets/textures/<folder>/<filename>`. The terrain renderer blends the six diffuse materials using the surface weights built in `src/scene3d/groundGeometry.ts`. Texture loading is cached in `groundTextures.ts`, with fallback colours while images load; `roadMaterial.ts` keeps the tiling aligned across map sections and supplies normal/roughness detail.

The Blender projects, displacement maps, and masks are not included in these runtime folders. The sky HDRI is a separate asset and is not included in this texture import.
