import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TerrainCell } from '../game/types';
import { ambienceUniforms } from './ambienceUniforms';
import { groundTex, TILE_CELLS } from './groundTextures';
import { COVER_UV, GRASS_LAYERS_ORDER, grassMask, MEADOW_HEIGHT, meshHeight, PASTURE_HEIGHT, trampleMap } from './groundCover';

/** Camera height (cells) below which the grass has its height, fully from the lower one. */
const SHOW_BELOW = 36, FULL_BELOW = 26;

/**
 * Blade heights for the shells: a tiling 256-texel field (a texel is about
 * 2 cm of ground) where most texels carry a blade of some height, in clumps,
 * with bare soil between. Mipmapped, so far off it melts into an even sward.
 */
function bladeTexture(): THREE.DataTexture {
  const size = 256, data = new Uint8Array(size * size * 4);
  let seed = 90127;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lattice = Array.from({ length: 17 * 17 }, rnd);
  const clump = (x: number, y: number) => {
    const u = x / 16, v = y / 16, i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
    const at = (a: number, b: number) => lattice[(b % 16) * 17 + (a % 16)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = clump(x, y), r = rnd();
    const blade = r < .82 ? (.3 + .7 * rnd()) * (.55 + .45 * c) : r * .25;
    const v = Math.round(blade * 255), o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

/** A square grid of `n` x `n` quads; its heights are filled in as the patch moves. */
function shellGrid(n: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * (n + 1) * 3), 3));
  const index: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  g.setIndex(index);
  return g;
}

/**
 * Grass with height: over the meadows round the point the camera looks at,
 * the ground is drawn again in stacked shells, each a little higher, keeping
 * only the pixels where a blade reaches that high. The sward stands like real
 * grass (thick at the roots, thin tips), sways in the same wind that runs over
 * the meadow colours, takes the shadows of units and trees, and lies flat
 * where vehicles have driven or soldiers walked (the trample map). It fades
 * out at the edge of the patch and as the camera climbs.
 */
export function GrassShells({ terrain, highQuality, regional }: { terrain: TerrainCell[][]; highQuality: boolean; regional: boolean }) {
  const { camera } = useThree();
  const layers = highQuality ? 8 : 5;
  const blades = useMemo(bladeTexture, []);
  const uniforms = useMemo(() => ({
    uMask: { value: grassMask(terrain, regional) }, uTrample: { value: trampleMap(terrain).texture }, uCoverUv: { value: COVER_UV },
    uBlades: { value: blades }, uPasture: { value: PASTURE_HEIGHT }, uMeadow: { value: MEADOW_HEIGHT }, uFade: { value: 0 },
    uCentre: { value: new THREE.Vector2() }, uRadius: { value: 20 },
    gGrass: { value: groundTex('grass', 'diffuse') }, gField: { value: groundTex('field', 'diffuse') }, gTile: { value: 1 / TILE_CELLS },
  }), [terrain, blades, regional]);
  const material = useMemo(() => {
    // No depth written: units and rings are never hidden in the grass (see GRASS_LAYERS_ORDER).
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', depthWrite: false });
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, { uTime: ambienceUniforms.uTime });
      shader.vertexShader = `attribute float aShell;
        uniform sampler2D uMask; uniform sampler2D uTrample; uniform vec2 uCoverUv; uniform float uPasture; uniform float uMeadow;
        uniform float uFade; uniform float uTime; uniform vec2 uCentre; uniform float uRadius;
        varying vec3 vGround; varying float vLevel;
        ` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 cuv = position.xz * uCoverUv;
          vec2 grass = texture2D(uMask, cuv).rg;
          float flattened = texture2D(uTrample, cuv).r;
          // Fades out round the patch's edge (a circle: a square's straight edges showed).
          float edge = 1.0 - smoothstep(uRadius * 0.6, uRadius, length(position.xz - uCentre));
          float h = mix(uPasture, uMeadow, grass.g) * uFade * edge * (1.0 - flattened * 0.88);
          vLevel = aShell;
          vGround = position;
          transformed.y += aShell * h;
          // The meadow's wind waves lean the upper sward.
          float ph = dot(position.xz, vec2(0.83, 0.56)) * 0.9 - uTime * 1.6;
          float sway = sin(ph) * 0.55 + sin(ph * 2.7 + position.x * 3.1) * 0.2 + 0.3;
          transformed.xz += vec2(0.83, 0.56) * sway * h * 0.5 * aShell * aShell;`);
      // One shadow lookup per layer, not the soft filter's sixteen.
      shader.fragmentShader = `#undef SHADOWMAP_TYPE_PCF_SOFT
        uniform sampler2D uMask; uniform sampler2D uTrample; uniform vec2 uCoverUv; uniform sampler2D uBlades; uniform float uFade;
        uniform sampler2D gGrass; uniform sampler2D gField; uniform float gTile; uniform float uTime;
        varying vec3 vGround; varying float vLevel;
        float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y); }
        ` + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec2 p = vGround.xz, cuv = p * uCoverUv;
          vec2 grass = texture2D(uMask, cuv).rg;
          float flattened = texture2D(uTrample, cuv).r;
          float blade = texture2D(uBlades, p * 2.0).r * 0.6 + texture2D(uBlades, mat2(0.8, -0.6, 0.6, 0.8) * p * 4.7 + 0.37).r * 0.4;
          float strand = blade * smoothstep(0.08, 0.7, grass.r) * (1.0 - flattened * 0.9) * (0.55 + 0.45 * uFade);
          if (vLevel > strand) discard;
          // The same photographed grass as the ground beneath, with its meadow
          // patches, shaded deep in the sward and lighter at the tips.
          vec2 gUv = p * gTile, uvB = mat2(0.8, -0.6, 0.6, 0.8) * gUv * 0.37 + 0.31;
          vec3 pasture = (texture2D(gGrass, gUv).rgb * 0.65 + texture2D(gGrass, uvB).rgb * 0.35) * vec3(0.74, 1.02, 0.60);
          vec3 meadow = (texture2D(gField, gUv).rgb * 0.65 + texture2D(gField, uvB).rgb * 0.35) * vec3(0.92, 1.0, 0.72);
          // As bright on average as the bare ground drawn where the layers fade out
          // (the edge of the patch, zooming out): no lighter patches or bands there.
          vec3 col = mix(pasture, meadow, grass.g) * 1.15;
          float broad = sNoise(p * 0.085 + 7.3) * 0.6 + sNoise(p * 0.21 + 2.1) * 0.4;
          float damp = sNoise(p * 0.13 + vec2(4.7, 9.1));
          vec3 shade = mix(vec3(0.86, 1.12, 0.74), vec3(1.16, 1.06, 0.74), smoothstep(0.42, 0.78, broad));
          shade = mix(shade, vec3(0.74, 0.92, 0.70), smoothstep(0.62, 0.86, damp) * 0.7);
          shade *= 0.9 + (sNoise(p * 1.9 + 3.7) * 0.6 + sNoise(p * 4.3 + 1.1) * 0.4) * 0.2;
          float wave = sin(dot(p, vec2(0.83, 0.56)) * 0.9 - uTime * 1.6 + sNoise(p * 0.15) * 4.0);
          shade *= 1.0 + smoothstep(0.35, 1.0, wave) * smoothstep(0.25, 0.75, sNoise(p * 0.05 + vec2(uTime * 0.05, 0.0))) * 0.075;
          // Flattened grass (tracks, trodden paths) shows its paler, bent stalks.
          col *= mix(vec3(1.0), vec3(1.2, 1.12, 0.9), smoothstep(0.15, 0.7, flattened));
          diffuseColor.rgb = col * shade * mix(0.6 + flattened * 0.25, 1.1, vLevel);`);
    };
    m.customProgramCacheKey = () => 'grass-shells-v3';
    return m;
  }, [uniforms]);
  useEffect(() => () => { material.dispose(); blades.dispose(); }, [material, blades]);

  // Two grids: fine (two quads a cell, as the ground mesh) close in, coarse further out.
  const grids = useMemo(() => ({ fine: shellGrid(64), coarse: shellGrid(96) }), []);
  useEffect(() => () => { grids.fine.dispose(); grids.coarse.dispose(); }, [grids]);
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(grids.fine, material, layers);
    const level = new Float32Array(layers).map((_, i) => (i + 1) / layers);
    im.geometry.setAttribute('aShell', new THREE.InstancedBufferAttribute(level, 1));
    grids.coarse.setAttribute('aShell', new THREE.InstancedBufferAttribute(level.slice(), 1));
    im.frustumCulled = false; im.receiveShadow = true; im.castShadow = false; im.raycast = () => null;
    im.renderOrder = GRASS_LAYERS_ORDER;
    for (let i = 0; i < layers; i++) im.setMatrixAt(i, new THREE.Matrix4());
    return im;
  }, [grids, material, layers]);
  useEffect(() => () => { mesh.dispose(); }, [mesh]);
  const patch = useRef({ x: NaN, z: NaN, step: 0 });

  /** Lay the grid over the ground round (cx, cz), `step` cells a quad. */
  const lay = (geometry: THREE.BufferGeometry, n: number, cx: number, cz: number, step: number) => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute, a = pos.array as Float32Array;
    const x0 = Math.round((cx - n * step / 2) * 2) / 2, z0 = Math.round((cz - n * step / 2) * 2) / 2;
    for (let j = 0, k = 0; j <= n; j++) for (let i = 0; i <= n; i++, k += 3) {
      const x = x0 + i * step, z = z0 + j * step;
      a[k] = x; a[k + 1] = meshHeight(terrain, x, z) + .003; a[k + 2] = z;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  };

  useFrame(() => {
    const h = camera.position.y, cx = camera.position.x, cz = camera.position.z - h * .65;
    const fade = 1 - THREE.MathUtils.smoothstep(h, FULL_BELOW, SHOW_BELOW);
    uniforms.uFade.value = fade;
    mesh.visible = fade > 0;
    if (fade <= 0) return;
    // Fine grid to about 16 cells round the view, coarse (one quad a cell, 48 round) when further out.
    const step = h < 14 ? .5 : 1, n = step < 1 ? 64 : 96, radius = n * step / 2;
    const p = patch.current;
    if (step !== p.step || Math.max(Math.abs(cx - p.x), Math.abs(cz - p.z)) > radius * .2) {
      const geometry = step < 1 ? grids.fine : grids.coarse;
      lay(geometry, n, cx, cz, step);
      if (mesh.geometry !== geometry) mesh.geometry = geometry;
      patch.current = { x: cx, z: cz, step };
      uniforms.uCentre.value.set(cx, cz); uniforms.uRadius.value = radius;
    }
  });
  return <primitive object={mesh} />;
}
