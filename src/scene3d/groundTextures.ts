import * as THREE from 'three';
import { TerrainCell } from '../game/types';

/**
 * Poly Haven ground sets in public/assets/textures/<name>/{diffuse,normal,roughness}.jpg.
 * Splat order matters: the mesh carries two vec3 weight attributes,
 * splatA = (grass, field, forest_floor), splatB = (dirt, gravel, asphalt).
 */
export const SURFACES = ['grass', 'field', 'forest_floor', 'dirt', 'gravel', 'asphalt'] as const;
export type Surface = typeof SURFACES[number];

/** World units (terrain cells) covered by one texture tile. */
export const TILE_CELLS = 3.5;

const cache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();

export function groundTex(surface: Surface, kind: 'diffuse' | 'normal' | 'roughness'): THREE.Texture {
  const key = `${surface}/${kind}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(`/assets/textures/${key}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = kind === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    cache.set(key, t);
  }
  return t;
}

/** Which texture a cell's soil uses (visual only — no gameplay effect). */
export function surfaceFor(c: TerrainCell, regional: boolean): Surface {
  if (c.yard === 'courtyard') return 'gravel';
  if (c.yard === 'garden' || c.yard === 'orchard') return 'field';
  if (regional && c.roadName) return 'grass';
  switch (c.type) {
    case 'open': case 'hedgerow': return 'grass';
    case 'tall_grass': return 'field';
    case 'forest': return 'forest_floor';
    case 'road': return 'asphalt';
    case 'gravel': case 'rubble': case 'urban': return 'gravel';
    default: return 'dirt'; // mud, crater, trench, wall, sandbag, water bed
  }
}
