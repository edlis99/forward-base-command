import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { createRoadData, landscapeMaterial } from '../scene3d/roadMaterial';
import { MAP_SECTIONS } from '../scene3d/mapSections';

// The ground textures paint a stand-in image on a canvas until theirs loads; jsdom has no 2D canvas.
beforeAll(() => {
  const noop: ProxyHandler<object> = { get: (_t, key) => (key === 'canvas' ? document.createElement('canvas') : () => undefined), set: () => true };
  HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, noop)) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

/** The ground's fragment shader as three.js compiles it, with or without the section's roads. */
function groundShader(roads: boolean) {
  const section = MAP_SECTIONS[0];
  const material = landscapeMaterial(new THREE.Texture(), roads ? createRoadData(section) : undefined, section);
  const shader = { uniforms: {}, defines: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
  return shader.fragmentShader;
}

describe('ground shading', () => {
  it('keeps grass, soil and fields matte: no texel of the roughness map catches the sun as a speck', () => {
    for (const roads of [false, true]) {
      const fragment = groundShader(roads), at = fragment.indexOf('#include <roughnessmap_fragment>');
      expect(at).toBeGreaterThan(-1);
      expect(fragment.slice(at)).toMatch(/max\(roughnessFactor, 0\.88\)/);
    }
  });

  it('lets roads keep their own roughness (fresh paint and puddles glossier)', () => {
    expect(groundShader(true)).toContain('mix(max(roughnessFactor, 0.88), roadRough, roadW)');
  });

  it('draws nothing with alpha to coverage: three.js does not draw such a material opaque, and its part-transparent pixels let whatever is behind the canvas through', () => {
    const dir = join(__dirname, '../scene3d');
    for (const file of readdirSync(dir).filter(f => /\.tsx?$/.test(f))) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(/alphaToCoverage\s*[:=]\s*\{?\s*true/.test(source), file).toBe(false);
    }
  });

  it('draws the battlefield on an opaque canvas, cleared to the haze colour: no pixel can show the page behind it', () => {
    const source = readFileSync(join(__dirname, '../scene3d/Scene3D.tsx'), 'utf8');
    const canvas = source.slice(source.indexOf('<Canvas'), source.indexOf('<fog'));
    expect(canvas).toMatch(/gl=\{\{[^}]*\balpha:\s*false\b/);
    expect(canvas).toMatch(/setClearColor\('#b6c5cf',\s*1\)/);
  });
});
