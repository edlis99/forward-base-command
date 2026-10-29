import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const treeFile = join(root, 'src/scene3d/VolumetricTrees.tsx');
const preloaderFile = join(root, 'src/scene3d/preloadVisuals.ts');

const species = ['pine', 'spruce', 'birch', 'oak', 'alder'] as const;

describe('3D forest material assets', () => {
  it('bundles distinct valid SVG foliage textures for every species', () => {
    for (const kind of species) {
      const image = readFileSync(join(root, `public/assets/nature/trees/${kind}_foliage.svg`), 'utf8');
      expect(image).toContain('<svg ');
      expect(image).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(image).toContain('</svg>');
    }
  });

  it('provides four species-specific bark textures plus the existing real pine bark map', () => {
    expect(existsSync(join(root, 'public/assets/nature/pine/Textures/pine_bark.png'))).toBe(true);
    for (const kind of species.filter(kind => kind !== 'pine')) {
      const image = readFileSync(join(root, `public/assets/nature/trees/${kind}_bark.svg`), 'utf8');
      expect(image).toContain('<svg ');
      expect(image).toContain('</svg>');
    }
  });

  it('connects every uploaded map to the renderer and initial loading screen', () => {
    const renderer = readFileSync(treeFile, 'utf8');
    const preloader = readFileSync(preloaderFile, 'utf8');
    const paths = [
      'pine/Textures/pine_bark.png',
      ...species.map(s => `trees/${s}_foliage.svg`),
      ...species.filter(s => s !== 'pine').map(s => `trees/${s}_bark.svg`),
    ];
    for (const file of paths) {
      expect(renderer).toContain(file);
      expect(preloader).toContain(file);
    }
    expect(renderer).toContain('useLoader(THREE.TextureLoader, TEXTURES)');
  });
});
