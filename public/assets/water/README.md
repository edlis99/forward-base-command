# Leipalingis freshwater lake material

## Game assets

- `lake_ripples_a.png`: 256 × 256 tileable RGB tangent-space normal map
  for slow, low-amplitude wind ripples.
- `lake_ripples_b.png`: 256 × 256 tileable RGB normal map with a second
  independent directional pattern to break obvious texture repetition.
- `src/scene3d/LakeWaterMaterial.ts`: uses the maps on a Three.js
  `MeshPhysicalMaterial`. The two sets of world-aligned UVs scroll slowly at
  different velocities and perturb the water normal used by light and Fresnel
  shading. Normal textures use linear/noncolour sampling, not sRGB.
- `src/scene3d/GroundSurface.tsx`: displays these water materials over
  the lake/stream cells and varies shallow-bank tint using deterministic
  shoreline wetness. Positions match at lake-cell and section boundaries.
- `src/scene3d/preloadVisuals.ts`: preloads both images to avoid a
  brief untextured lake when a battle first opens.

Colours are tuned for freshwater in southern Lithuania: muted green-blue,
soft pale-grey sky glancing reflection, and gentle surface ripples rather
than tropical turquoise or open-ocean breaking waves.

## Source and licensing

These **actual, locally bundled** PNG images were generated for this project
using tileable combinations of integer-frequency sinusoidal wind ripple
height fields. Analytic height derivatives were encoded as normalized
tangent-space RGB normals. The assets are original generated textures, not
photographs or copies of an external PBR pack. No external CDN is needed.

Reference material studied while selecting an implementation:
- [GodotLearning: Stylized Water CC0](https://godotlearning.com/shaders/stylized-water)
  — comparison of slow, layered lake ripple normal maps and shoreline behaviour.
- [Poly Haven CC0 license](https://polyhaven.com/license) —
  possible sources for future photographed terrain/water environment packs.
- [ProcTexture: Water Surface](https://proctexture.com/textures/water/surface-water/water-surface)
  — alternative seamless PBR water maps.

**None of those third-party packages were imported or redistributied.**
The two uploaded normal maps are newly created original assets.
They may be distributed and used as part of this project's source.

## Visual verification and next improvements

The lake water uses a PBR clearcoat approximation and timed normal motion,
not full physically based screen-space reflections, underwater refraction or
a shoreline foam simulation. There is no ocean wave-height displacement.

Check in the running Lovable browser, rotating the camera and viewing close
and far lakes. Watch for shader errors, z-fighting along the shoreline,
visible square seams or normal-map aliasing at wide zoom.
The production build and tests verify that files compile and load, but
cannot certify the photographic quality of water reflections.
