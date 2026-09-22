import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { TerrainCell, TerrainType } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { MapSection } from './mapSections';
import { createRoadTexture, landscapeMaterial } from './roadMaterial';
import { makeGrainTexture } from './materials';
import { groundHeightAt, hash2, fbm } from './terrainHeight';

const W = MAP_COLS;
const H = MAP_ROWS;

/** Subdivisions per terrain cell edge. Higher = smoother blends, more verts. */
const SUB = 2;

/**
 * Ground tint per terrain type. This is the colour of the *soil surface* under
 * each cell, not the colour of the object standing on it — so a wall or a house
 * contributes trampled dirt, and forest contributes leaf litter.
 */
const GROUND_TINT: Record<TerrainType | string, string> = {
  open: '#85905d',
  tall_grass: '#93a566',
  forest: '#556445',
  hedgerow: '#74874f',
  road: '#727b72',
  gravel: '#b0a68e',
  urban: '#968b78',
  wall: '#928778',
  rubble: '#a49c90',
  sandbag: '#b6a67e',
  mud: '#7a6647',
  crater: '#6f5c40',
  trench: '#94794f',
  water: '#365f7a',
};

// Height tables and noise live in terrainHeight.ts — the single source of
// truth shared with every layer that sits on the ground. Do not re-declare
// them here or the mesh and the sampler will drift apart.


/**
 * One continuous, vertex-coloured landscape mesh for the whole map.
 *
 * Replaces the old per-cell extruded boxes, which made every map read as a
 * chequerboard of squares. Colours and heights are bilinearly blended across
 * cell borders and perturbed with fractal noise, and vertex XZ positions are
 * jittered so no straight cell-aligned edges remain.
 */
export function GroundSurface({ terrain, section, regional = false }: { terrain: TerrainCell[][]; section: MapSection; regional?: boolean }) {
  const geometry = useMemo(() => {
    const nx = section.width * SUB + 1;
    const nz = section.height * SUB + 1;
    const vertCount = nx * nz;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);

    const cellAt = (cx: number, cy: number): TerrainCell => {
      const row = terrain[Math.max(0, Math.min(H - 1, cy))];
      return row[Math.max(0, Math.min(W - 1, cx))];
    };

    const col = new THREE.Color();
    const tmp = new THREE.Color();

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const gx = section.x + i / SUB;
        const gz = section.y + j / SUB;
        // Bilinear weights over the 4 nearest cell centres.
        const u = gx - 0.5, v = gz - 0.5;
        const ix = Math.floor(u), iz = Math.floor(v);
        const fx = u - ix, fz = v - iz;
        const wts: Array<[TerrainCell, number]> = [
          [cellAt(ix, iz), (1 - fx) * (1 - fz)],
          [cellAt(ix + 1, iz), fx * (1 - fz)],
          [cellAt(ix, iz + 1), (1 - fx) * fz],
          [cellAt(ix + 1, iz + 1), fx * fz],
        ];

        let r = 0, g = 0, b = 0;
        for (const [c, w] of wts) {
          if (w <= 0) continue;
          tmp.setStyle(c.yard ? ({ courtyard: '#aaa28a', garden: '#7d8d54', orchard: '#72854b' }[c.yard]) : GROUND_TINT[regional && c.roadName ? 'open' : c.type] ?? '#5c7042');
          r += tmp.r * w; g += tmp.g * w; b += tmp.b * w;
        }

        const height = groundHeightAt(terrain, gx, gz);

        const o = (j * nx + i) * 3;
        positions[o] = gx;
        uvs[(j * nx + i) * 2] = gx;
        uvs[(j * nx + i) * 2 + 1] = gz;
        positions[o + 1] = height;
        positions[o + 2] = gz;

        // Colour variation: broad patchiness only, biased bright so no cell
        // darkens into a black blotch.
        const patch = 0.95 + fbm(gx * 0.07, gz * 0.07) * 0.16;
        const speckle = 0.98 + hash2(gx * SUB, gz * SUB) * 0.05;
        const dry = fbm(gx * 0.05 + 11, gz * 0.05 + 7);
        col.setRGB(r, g, b).multiplyScalar(patch * speckle);
        // Sun-bleached patches lean ochre, damp hollows lean cool green.
        col.r *= 1 + (dry - 0.5) * 0.1;
        col.b *= 1 - (dry - 0.5) * 0.08;
        colors[o] = Math.min(1, col.r); colors[o + 1] = Math.min(1, col.g); colors[o + 2] = Math.min(1, col.b);

      }
    }

    const indices: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, bb = a + 1, c = a + nx, d = c + 1;
        // Alternate diagonal per quad so triangulation isn't visually regular.
        if ((i + j) % 2 === 0) { indices.push(a, c, bb, bb, c, d); }
        else { indices.push(a, c, d, a, d, bb); }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [terrain, regional, section]);

  const grain = useMemo(() => makeGrainTexture(1.6), []);
  const roads = useMemo(() => regional ? createRoadTexture(section) : undefined, [regional, section]);
  const material = useMemo(() => landscapeMaterial(grain, roads, section), [grain, roads, section]);
  useEffect(() => () => { material.dispose(); }, [material]);
  useEffect(() => () => { roads?.dispose(); }, [roads]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => grain.dispose(), [grain]);
  return (
    <mesh geometry={geometry} receiveShadow raycast={() => null}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/**
 * Translucent water sheet over the dipped riverbed. Corner positions are
 * displaced by a corner-keyed hash so shorelines read as irregular banks
 * instead of stair-stepped squares.
 */
export function WaterSheet({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const indices: number[] = [];
    const isWater = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < W && y < H && terrain[y][x].type === 'water';
    /** How enclosed a grid corner is by water (0..1) — drives organic bank taper. */
    const cornerWetness = (cx: number, cy: number) => {
      let n = 0;
      if (isWater(cx - 1, cy - 1)) n++;
      if (isWater(cx, cy - 1)) n++;
      if (isWater(cx - 1, cy)) n++;
      if (isWater(cx, cy)) n++;
      return n / 4;
    };
    const cornerOffset = (cx: number, cy: number) => ({
      x: (hash2(cx * 5.3, cy * 7.1) - 0.5) * 0.7,
      z: (hash2(cx * 9.7, cy * 3.9) - 0.5) * 0.7,
    });
    let base = 0;
    for (let y = section.y; y < section.y + section.height; y++) for (let x = section.x; x < section.x + section.width; x++) {
      if (terrain[y][x].type !== 'water') continue;
      // Riverbed follows the displaced landscape, so the sheet must ride on the
      // sampled bed height (flat per cell) rather than a fixed world Y.
      const bed = groundHeightAt(terrain, x + 0.5, y + 0.5);
      const corners: Array<[number, number]> = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      for (const [cx, cy] of corners) {
        const o = cornerOffset(cx, cy);
        // Pull shoreline corners toward the cell centre so the bank curves in
        // instead of leaving a hard 90-degree stair step.
        const wet = cornerWetness(cx, cy);
        const pull = wet === 0 ? 0.14 : 0;
        const px = cx + (x + 0.5 - cx) * pull + o.x * (0.35 + wet * 0.65);
        const pz = cy + (y + 0.5 - cy) * pull + o.z * (0.35 + wet * 0.65);
        positions.push(px, bed + 0.41 - wet * 0.06, pz);
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      base += 4;
    }
    if (positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [terrain, section]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial
        color="#2c5a74" transparent opacity={0.78}
        roughness={0.18} metalness={0.35}
      />
    </mesh>
  );
}

/** Grass tufts for tall_grass cells — replaces the old raised green boxes. */
export function GrassTufts({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const tufts = useMemo(() => {
    const out: Array<{ x: number; z: number; s: number; rot: number; tint: number }> = [];
    for (let y = section.y; y < section.y + section.height; y++) for (let x = section.x; x < section.x + section.width; x++) {
      if (terrain[y][x].type !== 'tall_grass') continue;
      const n = 4;
      for (let i = 0; i < n; i++) {
        const a = hash2(x * 3 + i * 1.7, y * 5 + i * 2.3);
        const b = hash2(x * 7 + i * 2.9, y * 11 + i * 1.1);
        out.push({
          x: x + 0.12 + a * 0.76,
          z: y + 0.12 + b * 0.76,
          s: 0.2 + a * 0.16,
          rot: b * Math.PI,
          tint: 0.82 + a * 0.36,
        });
      }
    }
    return out;
  }, [terrain, section]);

  const blades = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -.4,0,0,0,1,0,.1,0,0, .1,0,0,.4,.8,.1,.4,0,0, 0,0,-.3,0,.9,0,0,0,.3,
    ], 3));
    geometry.computeVertexNormals(); return geometry;
  }, []);
  useEffect(() => () => blades.dispose(), [blades]);
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useEffect(() => {
    if (!ref.current) return;
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const bse = new THREE.Color('#7a8a4a');
    for (let i = 0; i < tufts.length; i++) {
      const t = tufts[i];
      tmp.position.set(t.x, groundHeightAt(terrain, t.x, t.z) + t.s * 0.55, t.z);
      tmp.scale.set(t.s * 1.3, t.s * 1.5, t.s * 1.3);
      tmp.rotation.set(0, t.rot, 0);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
      col.copy(bse).multiplyScalar(t.tint);
      ref.current.setColorAt(i, col);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [tufts, terrain]);

  if (tufts.length === 0) return null;
  return (
    <instancedMesh key={tufts.length} ref={ref} args={[undefined, undefined, tufts.length]} raycast={() => null}>
      <primitive object={blades} attach="geometry" />
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.95} />
    </instancedMesh>
  );
}

/** Loose rocks, ruts and scrub scattered over open ground for scale detail. */
export function GroundDetail({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const props = useMemo(() => {
    const out: Array<{ x: number; z: number; sx: number; sy: number; sz: number; rot: number; tint: number; kind: number }> = [];
    for (let y = section.y; y < section.y + section.height; y++) for (let x = section.x; x < section.x + section.width; x++) {
      const t = terrain[y][x].type;
      if (t !== 'open' && t !== 'gravel' && t !== 'mud' && t !== 'crater' && t !== 'rubble') continue;
      const roll = hash2(x * 1.3, y * 2.7);
      if (roll > (t === 'open' ? 0.035 : 0.08)) continue;
      const a = hash2(x * 4.1, y * 6.7), b = hash2(x * 8.3, y * 1.9);
      const kind = a < 0.55 ? 0 : 1; // 0 = rock, 1 = scrub
      out.push({
        x: x + 0.15 + a * 0.7,
        z: y + 0.15 + b * 0.7,
        sx: 0.12 + a * 0.2,
        sy: 0.08 + b * 0.16,
        sz: 0.12 + b * 0.2,
        rot: a * Math.PI * 2,
        tint: 0.8 + b * 0.4,
        kind,
      });
    }
    return out;
  }, [terrain, section]);

  const rockRef = React.useRef<THREE.InstancedMesh>(null);
  const scrubRef = React.useRef<THREE.InstancedMesh>(null);
  const rocks = useMemo(() => props.filter(p => p.kind === 0), [props]);
  const scrub = useMemo(() => props.filter(p => p.kind === 1), [props]);

  React.useEffect(() => {
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    if (rockRef.current) {
      const base = new THREE.Color('#7b756c');
      rocks.forEach((p, i) => {
        tmp.position.set(p.x, groundHeightAt(terrain, p.x, p.z) + p.sy * 0.4, p.z);
        tmp.scale.set(p.sx, p.sy, p.sz);
        tmp.rotation.set(p.rot * 0.3, p.rot, p.rot * 0.2);
        tmp.updateMatrix();
        rockRef.current!.setMatrixAt(i, tmp.matrix);
        col.copy(base).multiplyScalar(p.tint);
        rockRef.current!.setColorAt(i, col);
      });
      rockRef.current.instanceMatrix.needsUpdate = true;
      if (rockRef.current.instanceColor) rockRef.current.instanceColor.needsUpdate = true;
    }
    if (scrubRef.current) {
      const base = new THREE.Color('#54622f');
      scrub.forEach((p, i) => {
        tmp.position.set(p.x, groundHeightAt(terrain, p.x, p.z) + p.sy * 0.6, p.z);
        tmp.scale.set(p.sx * 1.4, p.sy * 1.6, p.sz * 1.4);
        tmp.rotation.set(0, p.rot, 0);
        tmp.updateMatrix();
        scrubRef.current!.setMatrixAt(i, tmp.matrix);
        col.copy(base).multiplyScalar(p.tint);
        scrubRef.current!.setColorAt(i, col);
      });
      scrubRef.current.instanceMatrix.needsUpdate = true;
      if (scrubRef.current.instanceColor) scrubRef.current.instanceColor.needsUpdate = true;
    }
  }, [rocks, scrub, terrain]);

  return (
    <group>
      {rocks.length > 0 && (
        <instancedMesh key={`r${rocks.length}`} ref={rockRef} args={[undefined, undefined, rocks.length]} castShadow receiveShadow raycast={() => null}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial flatShading roughness={1} />
        </instancedMesh>
      )}
      {scrub.length > 0 && (
        <instancedMesh key={`s${scrub.length}`} ref={scrubRef} args={[undefined, undefined, scrub.length]} castShadow raycast={() => null}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial side={THREE.DoubleSide} roughness={0.95} />
        </instancedMesh>
      )}
    </group>
  );
}

