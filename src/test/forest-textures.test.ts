import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { forestGeometry } from '../scene3d/ForestMeshes';

const root = process.cwd();
const renderer = readFileSync(join(root, 'src/scene3d/VolumetricTrees.tsx'), 'utf8');
const preloader = readFileSync(join(root, 'src/scene3d/preloadVisuals.ts'), 'utf8');
const source = readFileSync(join(root, 'src/scene3d/ImportedPines.tsx'), 'utf8');
const species = ['pine', 'spruce', 'birch', 'oak', 'alder'] as const;

describe('detailed botanical forest', () => {
  it('includes transparent botanical sprites, bark maps and local preloading for every species', () => {
    for (const name of species) {
      const leafFile = join(root, `public/assets/nature/trees/${name}_sprig.svg`);
      const svg = readFileSync(leafFile, 'utf8');
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('</svg>');
      // Sprigs are alpha cutouts; a full-size opaque rectangle is forbidden.
      expect(svg).not.toContain('<rect width="64" height="96"');
      expect(renderer).toContain(`trees/${name}_sprig.svg`);
      expect(preloader).toContain(`trees/${name}_sprig.svg`);
      if (name !== 'pine') {
        expect(existsSync(join(root, `public/assets/nature/trees/${name}_bark.svg`))).toBe(true);
        expect(renderer).toContain(`trees/${name}_bark.svg`);
      }
    }
    expect(existsSync(join(root, 'public/assets/nature/pine/Textures/pine_bark.png'))).toBe(true);
    expect(preloader).toContain('pine/Textures/pine_bark.png');
  });

  it('builds actual tapered wooden branches and separate leaf meshes without old crown primitives', () => {
    expect(renderer).toContain("forestGeometry(species, variant, detail)");
    expect(renderer).not.toContain('IcosahedronGeometry');
    expect(renderer).not.toContain('ConeGeometry');
    for (const name of species) {
      const far = forestGeometry(name, 0, 'far');
      const near = forestGeometry(name, 1, 'near');
      expect(far.wood.getAttribute('position').count).toBeGreaterThan(100);
      expect(far.leaves.getAttribute('position').count).toBeGreaterThan(120);
      expect(near.leaves.getAttribute('position').count).toBeGreaterThan(far.leaves.getAttribute('position').count);
      expect(near.wood.getAttribute('position').count).toBeGreaterThan(far.wood.getAttribute('position').count);
      expect(Number.isFinite(far.wood.boundingSphere!.radius)).toBe(true);
      expect(Number.isFinite(far.leaves.boundingSphere!.radius)).toBe(true);
      // Deterministic and shared across map sections, not regenerated per tree.
      expect(forestGeometry(name, 0, 'far')).toBe(far);
    }
  });

  it('renders the bundled source OBJ pine near camera with a native fallback', () => {
    expect(existsSync(join(root, 'public/assets/nature/pine/pine.obj'))).toBe(true);
    expect(source).toContain('useLoader(OBJLoader, URL)');
    expect(source).toContain('pine.obj');
    expect(renderer).toContain('<ImportedPines');
    expect(renderer).toContain('fallback={pineFallback}');
    expect(preloader).toContain('pine/pine.obj');
  });
});
