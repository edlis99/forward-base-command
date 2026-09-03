import React, { useMemo } from 'react';
import * as THREE from 'three';
import { TerrainCell, TerrainType } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { groundHeightAt, GROUND_LEVEL, RELIEF, hash2, fbm } from './terrainHeight';

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
  open: '#8a9c62',
  tall_grass: '#93a566',
  forest: '#5f6d3e',
  hedgerow: '#74874f',
  road: '#7d7568',
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
export function GroundSurface({ terrain }: { terrain: TerrainCell[][] }) {
  const geometry = useMemo(() => {
    const nx = W * SUB + 1;
    const nz = H * SUB + 1;
    const vertCount = nx * nz;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);

    const cellAt = (cx: number, cy: number): TerrainCell => {
      const row = terrain[Math.max(0, Math.min(H - 1, cy))];
      return row[Math.max(0, Math.min(W - 1, cx))];
    };

    const col = new THREE.Color();
    const tmp = new THREE.Color();

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const gx = i / SUB;
        const gz = j / SUB;
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

        let r = 0, g = 0, b = 0, level = 0, relief = 0, elev = 0;
        for (const [c, w] of wts) {
          if (w <= 0) continue;
          tmp.setStyle(GROUND_TINT[c.type] ?? '#5c7042');
          r += tmp.r * w; g += tmp.g * w; b += tmp.b * w;
          level += (GROUND_LEVEL[c.type] ?? 0) * w;
          relief += (RELIEF[c.type] ?? 1) * w;
          elev += ((c.elevation ?? 1) - 1) * w;
        }

        // Terrain relief: broad rolling hills + gentle undulation. Fine grain is
        // kept very low — high-frequency displacement was tilting triangles hard
        // enough to read as dark speckled patches under the sun light.
        const hills = (fbm(gx * 0.03, gz * 0.03) - 0.5) * 2.4;
        const mid = (fbm(gx * 0.11, gz * 0.11) - 0.5) * 0.36;
        const fine = (fbm(gx * 0.45, gz * 0.45) - 0.5) * 0.06;
        const height = level + elev * 1.05 + (hills + mid + fine) * relief;

        // Break the grid: small nudge only, so normals stay coherent.
        const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
        const jx = edge ? 0 : (hash2(i * 1.7, j * 2.3) - 0.5) * 0.2;
        const jz = edge ? 0 : (hash2(i * 3.1, j * 1.3) - 0.5) * 0.2;

        const o = (j * nx + i) * 3;
        positions[o] = gx + jx / SUB;
        positions[o + 1] = height;
        positions[o + 2] = gz + jz / SUB;

        // Colour variation: broad patchiness only, biased bright so no cell
        // darkens into a black blotch.
        const patch = 0.95 + fbm(gx * 0.07, gz * 0.07) * 0.16;
        const speckle = 0.98 + hash2(i, j) * 0.05;
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
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [terrain]);

  return (
    <mesh geometry={geometry} receiveShadow raycast={() => null}>
      <meshStandardMaterial vertexColors roughness={0.97} metalness={0} />
    </mesh>
  );
}

/**
 * Translucent water sheet over the dipped riverbed. Corner positions are
 * displaced by a corner-keyed hash so shorelines read as irregular banks
 * instead of stair-stepped squares.
 */
export function WaterSheet({ terrain }: { terrain: TerrainCell[][] }) {
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
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
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
  }, [terrain]);

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
export function GrassTufts({ terrain }: { terrain: TerrainCell[][] }) {
  const tufts = useMemo(() => {
    const out: Array<{ x: number; z: number; s: number; rot: number; tint: number }> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
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
  }, [terrain]);

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
  }, [tufts, terrain]);

  if (tufts.length === 0) return null;
  return (
    <instancedMesh key={tufts.length} ref={ref} args={[undefined, undefined, tufts.length]} castShadow raycast={() => null}>
      <coneGeometry args={[0.5, 1.1, 5]} />
      <meshStandardMaterial flatShading roughness={0.95} />
    </instancedMesh>
  );
}

/** Loose rocks, ruts and scrub scattered over open ground for scale detail. */
export function GroundDetail({ terrain }: { terrain: TerrainCell[][] }) {
  const props = useMemo(() => {
    const out: Array<{ x: number; z: number; sx: number; sy: number; sz: number; rot: number; tint: number; kind: number }> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = terrain[y][x].type;
      if (t !== 'open' && t !== 'gravel' && t !== 'mud' && t !== 'crater' && t !== 'rubble') continue;
      const roll = hash2(x * 1.3, y * 2.7);
      if (roll > (t === 'open' ? 0.12 : 0.4)) continue;
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
  }, [terrain]);

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
          <meshStandardMaterial flatShading roughness={0.95} />
        </instancedMesh>
      )}
    </group>
  );
}
