import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TerrainCell } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { fbm, groundHeightAt, hash2 } from './terrainHeight';
import { ambienceUniforms } from './ambienceUniforms';

const CARD = `${import.meta.env.BASE_URL}assets/nature/grass/Textures/grass_card.png`;
/** Tufts show below this camera height (cells), fully from the lower one. */
const SHOW_BELOW = 14, FULL_BELOW = 9;
/** Most tufts drawn at once. */
const MAX_TUFTS = 52000;

/**
 * Meadow tufts, per cell: count (at the closest zoom) and height range in
 * cells (one cell is about 12 m; a soldier stands 0.15): knee-high tufts in
 * pasture, waist-high in the tall meadow grass, a little drawn up so they read
 * from the tactical camera. Roads, yards, buildings, woods, water and bridges
 * get none.
 */
function tuftsFor(c: TerrainCell | undefined): { count: number; low: number; high: number; dry: number } | null {
  if (!c || c.roadName || c.bridge || c.prop || c.blocksMovement || c.yard === 'courtyard') return null;
  if (c.type === 'tall_grass') return { count: 150, low: .1, high: .15, dry: .55 };
  if (c.type === 'open') return c.yard ? { count: 26, low: .055, high: .085, dry: .15 } : { count: 90, low: .065, high: .105, dry: .2 };
  return null;
}

/**
 * Ground height as the landscape mesh draws it: its vertices every half cell
 * (heights cached per map), blended between them. Much cheaper per tuft than
 * the full height function, and it follows the drawn surface more closely.
 */
const SUB = 2, GW = MAP_COLS * SUB + 1, GH = MAP_ROWS * SUB + 1;
const vertexHeights = new WeakMap<TerrainCell[][], Float32Array>();
function meshHeight(terrain: TerrainCell[][], gx: number, gz: number) {
  let grid = vertexHeights.get(terrain);
  if (!grid) { grid = new Float32Array(GW * GH).fill(NaN); vertexHeights.set(terrain, grid); }
  const u = Math.max(0, Math.min(GW - 1.001, gx * SUB)), v = Math.max(0, Math.min(GH - 1.001, gz * SUB));
  const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j;
  const at = (ii: number, jj: number) => {
    const k = jj * GW + ii;
    let h = grid![k];
    if (Number.isNaN(h)) { h = groundHeightAt(terrain, ii / SUB, jj / SUB); grid![k] = h; }
    return h;
  };
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fz) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fz;
}

/** Two crossed upright cards, base at the origin, one unit tall and wide; normals up, so tufts light like the meadow they grow in. */
function tuftGeometry() {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const a of [.3, .3 + Math.PI / 2]) {
    const cx = Math.cos(a) * .5, cz = Math.sin(a) * .5, base = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Grass tufts over the meadows round the point the camera looks at, when
 * zoomed in: the CC0 Poly Haven grass card on two crossed quads per tuft,
 * thousands of them in one instanced draw. They sway in the same wind that
 * runs over the ground's meadow shading, darken towards their roots, take
 * the shadows of units and trees, and shrink away at the edge of the patch
 * and as the camera climbs, so moving the patch never pops. Positions are
 * hashed per cell, so a tuft stays where it grew when the patch moves on.
 */
function Tufts({ terrain }: { terrain: TerrainCell[][] }) {
  const { camera } = useThree();
  const card = useLoader(THREE.TextureLoader, CARD);
  const geometry = useMemo(tuftGeometry, []);
  const uniforms = useMemo(() => ({ uCentre: { value: new THREE.Vector2() }, uRadius: { value: 10 }, uFade: { value: 0 } }), []);
  const material = useMemo(() => {
    card.colorSpace = THREE.SRGBColorSpace; card.anisotropy = 4;
    const m = new THREE.MeshLambertMaterial({ map: card, alphaTest: .42, side: THREE.DoubleSide, alphaToCoverage: true });
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, { uTime: ambienceUniforms.uTime });
      shader.vertexShader = 'uniform float uTime;\nuniform vec2 uCentre;\nuniform float uRadius;\nuniform float uFade;\nvarying float vTip;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 iPos = vec3(instanceMatrix[3]);
          float fade = uFade * (1.0 - smoothstep(uRadius * 0.7, uRadius, distance(iPos.xz, uCentre)));
          vTip = position.y;
          // The ground's wind waves bend the blades: the tips swing most.
          float ph = dot(iPos.xz, vec2(0.83, 0.56)) * 0.9 - uTime * 1.6;
          float sway = sin(ph) * 0.55 + sin(ph * 2.7 + iPos.x * 3.1) * 0.2 + 0.3;
          mat3 frame = mat3(instanceMatrix);
          vec3 lean = vec3(0.83, 0.0, 0.56) * sway * 0.28 * length(frame[1]) * position.y * position.y;
          transformed += inverse(frame) * lean;
          transformed *= fade;`);
      shader.fragmentShader = 'varying float vTip;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          // Shaded at the root, sunlit and a little yellower at the tips.
          diffuseColor.rgb *= mix(vec3(0.72, 0.74, 0.7), vec3(1.3, 1.3, 1.12), vTip);`)
        // Both faces of a card are lit as the meadow (normal up): the back face is not turned to the ground.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n          normal = normalize( vNormal );');
    };
    m.customProgramCacheKey = () => 'meadow-tufts-v3';
    return m;
  }, [card, uniforms]);
  useEffect(() => () => { material.dispose(); geometry.dispose(); }, [material, geometry]);
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(geometry, material, MAX_TUFTS);
    im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.castShadow = false;
    im.raycast = () => null;
    im.setColorAt(0, new THREE.Color(1, 1, 1));
    return im;
  }, [geometry, material]);
  useEffect(() => () => { mesh.dispose(); }, [mesh]);
  const patch = useRef({ x: NaN, z: NaN, r: 0, density: 0 });
  const colour = useMemo(() => new THREE.Color(), []);

  const rebuild = (cx: number, cz: number, r: number, density: number) => {
    const m = mesh.instanceMatrix.array as Float32Array;
    let n = 0;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MAP_COLS - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(MAP_ROWS - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1 && n < MAX_TUFTS; z++) for (let x = x0; x <= x1 && n < MAX_TUFTS; x++) {
      if (Math.hypot(x + .5 - cx, z + .5 - cz) > r + .8) continue;
      const kind = tuftsFor(terrain[z]?.[x]);
      if (!kind) continue;
      // Clumpy: some patches thick, some thin.
      const patchiness = .45 + fbm(x * .23 + 5.1, z * .23 + 1.7) * 1.1;
      const count = Math.round(kind.count * density * patchiness);
      for (let k = 0; k < count && n < MAX_TUFTS; k++) {
        const px = x + hash2(x * 7.13 + k * 1.31, z * 3.71 + k * .77), pz = z + hash2(x * 2.27 + k * .93, z * 5.19 + k * 1.57);
        const h = kind.low + (kind.high - kind.low) * hash2(px * 11.3, pz * 7.9), w = h * (.9 + .35 * hash2(px * 3.1, pz * 13.7));
        const a = hash2(px * 17.1, pz * 4.3) * Math.PI, c = Math.cos(a), s = Math.sin(a);
        const y = meshHeight(terrain, px, pz) - .004;
        // Column-major: x axis (width), y axis (height), z axis (width), position.
        m.set([c * w, 0, -s * w, 0, 0, h, 0, 0, s * w, 0, c * w, 0, px, y, pz, 1], n * 16);
        const dry = Math.min(1, kind.dry + (fbm(px * .085 + 7.3, pz * .085 + 7.3) - .45) * .9);
        const bright = .95 + hash2(px * 5.7, pz * 9.1) * .3;
        // Fresh green to straw, a shade lighter than the photographed card so tufts catch the sun like the meadow.
        colour.setRGB((.9 + dry * .38) * bright, (1.2 + dry * .02) * bright, (.66 + dry * .02) * bright);
        mesh.setColorAt(n, colour);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  useFrame(() => {
    // Where the tactical camera looks on the ground, and how close it is.
    const h = camera.position.y, cx = camera.position.x, cz = camera.position.z - h * .65;
    const fade = 1 - THREE.MathUtils.smoothstep(h, FULL_BELOW, SHOW_BELOW);
    uniforms.uFade.value = fade;
    mesh.visible = fade > 0;
    if (fade <= 0) return;
    // Thinner further out: tufts are smaller on screen there and the ground texture carries them.
    const r = Math.min(20, Math.max(7, h * 1.35 + 3)), density = Math.min(1, Math.max(.22, (6 / Math.max(h, 1)) ** 2));
    const p = patch.current;
    if (!(Math.hypot(cx - p.x, cz - p.z) < r * .18 && Math.abs(r - p.r) < r * .15)) {
      patch.current = { x: cx, z: cz, r, density };
      rebuild(cx, cz, r, density);
      uniforms.uCentre.value.set(cx, cz); uniforms.uRadius.value = r;
    }
  });
  return <primitive object={mesh} />;
}

export function GrassField({ terrain, highQuality }: { terrain: TerrainCell[][]; highQuality: boolean }) {
  if (!highQuality) return null;
  return <Suspense fallback={null}><Tufts terrain={terrain} /></Suspense>;
}
