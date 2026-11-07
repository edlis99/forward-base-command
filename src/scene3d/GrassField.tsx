import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { TerrainCell } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { fbm, hash2 } from './terrainHeight';
import { COVER_UV, meshHeight, ROAD_CLEARING, roadCell, trampleMap, TUFTS_ORDER } from './groundCover';
import { roadEdgeAt } from './roadMaterial';
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
 * get none; a campaign road's cells grow pasture tufts up to its drawn verge.
 */
function tuftsFor(c: TerrainCell | undefined): { count: number; low: number; high: number; dry: number } | null {
  // (The scenery border round the map is out of bounds, but its fields have tufts like any other.)
  if (!c || c.bridge || c.prop || c.yard === 'courtyard') return null;
  // Its verge is pasture; its carriageway and shoulder cells too, beside the drawn road (checked tuft by tuft).
  if (c.roadName) return c.type === 'open' || roadCell(c) ? PASTURE_TUFTS : null;
  if (c.type === 'tall_grass') return { count: 90, low: .1, high: .15, dry: .78 };
  if (c.type === 'open') return c.yard ? { count: 16, low: .055, high: .085, dry: .15 } : PASTURE_TUFTS;
  return null;
}
const PASTURE_TUFTS = { count: 46, low: .065, high: .105, dry: .2 };

/**
 * The grass card, prepared for small tufts seen from above. Its seed heads are
 * near white, and a tuft a few pixels tall turned each into a white speck:
 * they are toned down to straw. Its transparent texels take the grass's own
 * colour (still transparent), so filtering blends nothing pale or dark into
 * the blades' edges.
 */
function meadowCard(source: THREE.Texture): THREE.Texture {
  const image = source.image as HTMLImageElement;
  const w = image.width, h = image.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] >= 128) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  const avg = n ? [r / n, g / n, b / n] : [110, 120, 64];
  const straw = [128, 120, 78], cap = 118;
  // Raw texels, not a canvas: a canvas keeps no colour where it is fully
  // transparent, and the browser filled those texels white or black as it
  // uploaded them, which the mipmaps then blended into every blade's edge
  // (tufts outlined in white specks, or in black). Rows run bottom up, as
  // the card's texture coordinates expect.
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, o = ((h - 1 - y) * w + x) * 4;
    if (px[i + 3] < 128) { data[o] = avg[0]; data[o + 1] = avg[1]; data[o + 2] = avg[2]; data[o + 3] = 0; continue; }
    data[o] = px[i]; data[o + 1] = px[i + 1]; data[o + 2] = px[i + 2]; data[o + 3] = 255;
    // Only the pale, washed-out seed heads and dry stems: green blades keep their sunlit colour.
    const m = Math.max(px[i], px[i + 1], px[i + 2]), saturation = (m - Math.min(px[i], px[i + 1], px[i + 2])) / Math.max(m, 1);
    if (m <= cap || saturation > .32) continue;
    const k = cap / m, t = Math.min(1, (m - cap) / 70) * .6;
    for (let c = 0; c < 3; c++) data[o + c] = px[i + c] * k * (1 - t) + straw[c] * t;
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
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
  const uniforms = useMemo(() => ({ uCentre: { value: new THREE.Vector2() }, uRadius: { value: 10 }, uFade: { value: 0 },
    uTrample: { value: trampleMap(terrain).texture }, uCoverUv: { value: COVER_UV } }), [terrain]);
  const material = useMemo(() => {
    // No depth written: units and rings are never hidden among the tufts (see TUFTS_ORDER).
    const m = new THREE.MeshLambertMaterial({ map: meadowCard(card), alphaTest: .42, side: THREE.DoubleSide, alphaToCoverage: true, depthWrite: false });
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, { uTime: ambienceUniforms.uTime });
      shader.vertexShader = 'uniform float uTime;\nuniform vec2 uCentre;\nuniform float uRadius;\nuniform float uFade;\nuniform sampler2D uTrample;\nuniform vec2 uCoverUv;\nattribute float aDry;\nvarying float vTip;\nvarying float vDry;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 iPos = vec3(instanceMatrix[3]);
          float fade = uFade * (1.0 - smoothstep(uRadius * 0.7, uRadius, distance(iPos.xz, uCentre)));
          vTip = position.y; vDry = aDry;
          // The ground's wind waves bend the blades: the tips swing most.
          float ph = dot(iPos.xz, vec2(0.83, 0.56)) * 0.9 - uTime * 1.6;
          float sway = sin(ph) * 0.55 + sin(ph * 2.7 + iPos.x * 3.1) * 0.2 + 0.3;
          mat3 frame = mat3(instanceMatrix);
          vec3 lean = vec3(0.83, 0.0, 0.56) * sway * 0.28 * length(frame[1]) * position.y * position.y;
          transformed += inverse(frame) * lean;
          transformed *= fade;
          // Driven over or trodden down: the tuft lies nearly flat.
          transformed.y *= 1.0 - texture2D(uTrample, iPos.xz * uCoverUv).r * 0.85;`);
      shader.fragmentShader = 'varying float vTip;\nvarying float vDry;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          // Shaded at the root, a little lighter at the tips.
          diffuseColor.rgb *= mix(vec3(0.84, 0.86, 0.8), vec3(1.1, 1.1, 1.0), vTip);`)
        // Never brighter than the meadow round them: the card's sunlit blade
        // highlights, tinted up like the rest, came out as yellow-white specks.
        // Dry tufts take the straw of the tall meadow they stand in, keeping the card's light and shade
        // (tinting the green card turned them into green, then orange, stars on the golden meadow).
        .replace('#include <color_fragment>', `#include <color_fragment>
          float tl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, tl * vec3(1.32, 1.0, 0.5), vDry);
          diffuseColor.rgb *= min(1.0, 0.3 / max(tl, 1e-4));`)
        // Both faces of a card are lit as the meadow (normal up): the back face is not turned to the ground.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n          normal = normalize( vNormal );');
    };
    m.customProgramCacheKey = () => 'meadow-tufts-v10';
    return m;
  }, [card, uniforms]);
  useEffect(() => () => { material.map?.dispose(); material.dispose(); geometry.dispose(); }, [material, geometry]);
  const mesh = useMemo(() => {
    geometry.setAttribute('aDry', new THREE.InstancedBufferAttribute(new Float32Array(MAX_TUFTS), 1));
    const im = new THREE.InstancedMesh(geometry, material, MAX_TUFTS);
    im.count = 0; im.frustumCulled = false; im.receiveShadow = true; im.castShadow = false;
    im.renderOrder = TUFTS_ORDER;
    im.raycast = () => null;
    im.setColorAt(0, new THREE.Color(1, 1, 1));
    return im;
  }, [geometry, material]);
  useEffect(() => () => { mesh.dispose(); }, [mesh]);
  const patch = useRef({ x: NaN, z: NaN, r: 0, density: 0 });
  const colour = useMemo(() => new THREE.Color(), []);

  const rebuild = (cx: number, cz: number, r: number, density: number) => {
    const m = mesh.instanceMatrix.array as Float32Array;
    const dryness = mesh.geometry.getAttribute('aDry') as THREE.InstancedBufferAttribute;
    let n = 0;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MAP_COLS - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(MAP_ROWS - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1 && n < MAX_TUFTS; z++) for (let x = x0; x <= x1 && n < MAX_TUFTS; x++) {
      if (Math.hypot(x + .5 - cx, z + .5 - cz) > r + .8) continue;
      const cell = terrain[z]?.[x], kind = tuftsFor(cell), onRoadCell = !!cell?.roadName;
      if (!kind) continue;
      // Clumpy: some patches thick, some thin.
      const patchiness = .45 + fbm(x * .23 + 5.1, z * .23 + 1.7) * 1.1;
      const count = Math.round(kind.count * density * patchiness);
      for (let k = 0; k < count && n < MAX_TUFTS; k++) {
        const px = x + hash2(x * 7.13 + k * 1.31, z * 3.71 + k * .77), pz = z + hash2(x * 2.27 + k * .93, z * 5.19 + k * 1.57);
        // Nothing on the drawn road or its shoulder (a tuft is a few metres across).
        if (onRoadCell && roadEdgeAt(px, pz) > -ROAD_CLEARING - .03) continue;
        const h = kind.low + (kind.high - kind.low) * hash2(px * 11.3, pz * 7.9), w = h * (.9 + .35 * hash2(px * 3.1, pz * 13.7));
        const a = hash2(px * 17.1, pz * 4.3) * Math.PI, c = Math.cos(a), s = Math.sin(a);
        const y = meshHeight(terrain, px, pz) - .004;
        // Column-major: x axis (width), y axis (height), z axis (width), position.
        m.set([c * w, 0, -s * w, 0, 0, h, 0, 0, s * w, 0, c * w, 0, px, y, pz, 1], n * 16);
        const dry = Math.max(0, Math.min(1, kind.dry + (fbm(px * .085 + 7.3, pz * .085 + 7.3) - .45) * .9));
        const bright = .95 + hash2(px * 5.7, pz * 9.1) * .3;
        // Fresh green to straw (the shader takes dry tufts to the meadow's straw), a shade lighter than
        // the photographed card so tufts catch the sun like the meadow.
        colour.setRGB((1.17 + dry * .45) * bright, (1.52 + dry * .03) * bright, (.82 + dry * .02) * bright);
        mesh.setColorAt(n, colour);
        dryness.setX(n, dry);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    dryness.needsUpdate = true;
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
