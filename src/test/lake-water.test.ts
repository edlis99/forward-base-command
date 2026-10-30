import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readSource = (path: string) => readFileSync(join(root, path), 'utf8');

describe('calm freshwater lake rendering', () => {
  it('bundles two genuinely local 256px RGB normal-map PNG textures', () => {
    for (const name of ['lake_ripples_a.png', 'lake_ripples_b.png']) {
      const png = readFileSync(join(root, 'public/assets/water', name));
      expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.toString('ascii', 12, 16)).toBe('IHDR');
      expect(png.readUInt32BE(16)).toBe(256);
      expect(png.readUInt32BE(20)).toBe(256);
      expect(png[25]).toBe(2); // RGB, not a decorative blue base-colour image
      expect(png.length).toBeGreaterThan(60000);
    }
  });

  it('loads and blends both normal maps in a lake-specific PBR shader', () => {
    const shader = readSource('src/scene3d/LakeWaterMaterial.ts');
    expect(shader).toContain('lake_ripples_a.png');
    expect(shader).toContain('lake_ripples_b.png');
    expect(shader).toContain('THREE.NoColorSpace');
    expect(shader).toContain('THREE.RepeatWrapping');
    expect(shader).toContain("clearcoat: 0.92");
    expect(shader).toContain('lakeTime');
    expect(shader).toContain('vLakeWorld');
    expect(shader).toContain('mat3(viewMatrix)');
  });

  it('has consistent shared lake corners, shoreline shading and no old flat water material', () => {
    const surface = readSource('src/scene3d/GroundSurface.tsx');
    const preloader = readSource('src/scene3d/preloadVisuals.ts');
    expect(surface).toContain('lakeShore');
    expect(surface).toContain('cornerWetness');
    expect(surface).toContain('groundHeightAt(terrain, px, pz)');
    expect(surface).toContain('<LakeSurface geometry={geometry} />');
    expect(surface).not.toContain('color="#2c5a74"');
    expect(preloader).toContain('assets/water/lake_ripples_a.png');
    expect(preloader).toContain('assets/water/lake_ripples_b.png');
  });
});
