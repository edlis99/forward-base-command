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
const pending = new Map<string, Promise<void>>();
const loader = new THREE.TextureLoader();

const FALLBACK_COLORS: Record<Surface, string> = {
  grass: '#85905d', field: '#b0a376', forest_floor: '#75664f',
  dirt: '#7a6647', gravel: '#a49c90', asphalt: '#555957',
};

/** Keep the terrain visible while the JPGs load, including on a slow connection. */
function fallbackImage(surface: Surface, kind: 'diffuse' | 'normal' | 'roughness') {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = kind === 'normal' ? '#8080ff' : kind === 'roughness' ? '#ffffff' : FALLBACK_COLORS[surface];
  ctx.fillRect(0, 0, 1, 1);
  return canvas;
}

export function groundTex(surface: Surface, kind: 'diffuse' | 'normal' | 'roughness'): THREE.Texture {
  const key = `${surface}/${kind}`;
  let t = cache.get(key);
  if (!t) {
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    pending.set(key, ready);
    t = loader.load(`${import.meta.env.BASE_URL}assets/textures/${key}.jpg`, loaded => {
      // Upload the decoded full-resolution image before displaying the battlefield.
      loaded.dispose();
      loaded.needsUpdate = true;
      finish();
    }, undefined, () => {
      console.warn(`Ground texture unavailable: ${key}; using its fallback.`);
      finish(); // Failed optional textures must never trap the player on loading.
    });
    t.image = fallbackImage(surface, kind);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = kind === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    cache.set(key, t);
  }
  return t;
}

/** Start every ground map request and resolve only after real images decode.
 * Called before combat so players never see flat-colour placeholders switch to PBR.
 */
export async function preloadGroundTextures(): Promise<void> {
  for (const surface of SURFACES)
    for (const kind of ['diffuse', 'normal', 'roughness'] as const)
      groundTex(surface, kind);
  await Promise.all(pending.values());
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
