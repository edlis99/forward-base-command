import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { settlementAt } from '../game/maps/settlements';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { MapSection } from './mapSections';
import { createRoadData, landscapeMaterial } from './roadMaterial';
import { makeGrainTexture } from './materials';
import { buildGroundGeometry } from './groundGeometry';
import { COVER_UV, grassMask, GROUND_ORDER, TUFTS_ORDER } from './groundCover';
import { groundHeightAt, hash2, smoothShoreShare, WATER_DEPTH, waterBedHeightAt } from './terrainHeight';
import { useLakeWaterMaterial } from './LakeWaterMaterial';

const W = MAP_COLS;
const H = MAP_ROWS;

/**
 * One continuous, vertex-coloured landscape mesh for the whole map.
 *
 * Replaces the old per-cell extruded boxes, which made every map read as a
 * chequerboard of squares. Colours and heights are bilinearly blended across
 * cell borders and perturbed with fractal noise, and vertex XZ positions are
 * jittered so no straight cell-aligned edges remain.
 */
export function GroundSurface({ terrain, section, regional = false }: { terrain: TerrainCell[][]; section: MapSection; regional?: boolean }) {
  const geometry = useMemo(() => buildGroundGeometry(terrain, section, regional), [terrain, regional, section]);

  const grain = useMemo(() => makeGrainTexture(1.6), []);
  const roads = useMemo(() => regional ? createRoadData(section, terrain) : undefined, [regional, section, terrain]);
  const material = useMemo(() => landscapeMaterial(grain, roads, section, { mask: grassMask(terrain, regional), uv: COVER_UV }),
    [grain, roads, section, terrain, regional]);
  useEffect(() => () => { material.dispose(); }, [material]);
  useEffect(() => () => { roads?.dispose(); (roads?.userData.overlap as THREE.Texture | undefined)?.dispose(); }, [roads]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => grain.dispose(), [grain]);
  return (
    <mesh geometry={geometry} receiveShadow raycast={() => null} renderOrder={GROUND_ORDER}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/** Actual lake material with two seamless, animated normal textures. */
function LakeSurface({ geometry }: { geometry: THREE.BufferGeometry }) {
  const material = useLakeWaterMaterial();
  return <mesh geometry={geometry} raycast={() => null} renderOrder={1}>
    <primitive object={material} attach="material" />
  </mesh>;
}

/** Connected inland water sheet: one surface per lake (flat) or river
 * (following its level), extended a cell under the banks so the shoreline is
 * where the ground rises through the water, not the edge of square cells.
 * Corners lie two to a cell, so the shallows have their own gradient. */
export function WaterSheet({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const indices: number[] = [];
    const shores: number[] = [];
    // Bridge decks span the water: the sheet runs on underneath them.
    const isWater = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < W && y < H && (terrain[y][x].type === 'water' || !!terrain[y][x].bridge);
    const nearWater = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWater(x + dx, y + dy)) return true;
      return false;
    };
    // The water's smooth share at a corner: the shoreline's own curve, not the cells'.
    const cornerWetness = (px: number, pz: number) => smoothShoreShare(terrain, px, pz);
    // Surface level at a corner from the nearest water cells only; dry corners
    // of the bank ring take the level of the water beside them.
    const cornerLevel = (px: number, pz: number) => {
      const bed = waterBedHeightAt(terrain, px, pz);
      if (bed !== undefined) return bed + WATER_DEPTH;
      const cx = Math.round(px), cy = Math.round(pz);
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const b = waterBedHeightAt(terrain, cx + dx, cy + dy);
        if (b !== undefined) { sum += b; n++; }
      }
      return n ? sum / n + WATER_DEPTH : undefined;
    };
    // Corners, two a cell, computed from their lattice position alone so neighbouring
    // quads and streaming section borders match exactly: [height, shallowness].
    const corners = new Map<number, [number, number] | null>();
    const corner = (i: number, j: number): [number, number] | null => {
      const key = j * 4096 + i;
      let c = corners.get(key);
      if (c !== undefined) return c;
      const px = i / 2, pz = j / 2, level = cornerLevel(px, pz);
      if (level === undefined) { corners.set(key, null); return null; }
      const wet = cornerWetness(px, pz), ground = groundHeightAt(terrain, px, pz);
      // On dry corners tuck the sheet under the bank: it never floats over grass. Corners that are mostly
      // water (narrow rivers too) hold the true surface, blending between over the shore.
      const hold = Math.max(0, Math.min(1, (wet - .4) / .4)), tucked = Math.min(level, ground - 0.08 + wet * 0.16);
      const height = tucked + (level - tucked) * hold * hold * (3 - 2 * hold);
      // How shallow the water is: 1 at the waterline, 0 from about a fifth of a cell deep.
      const depth = Math.max(0, Math.min(1, (height - ground) / 0.22));
      c = [height, 1 - depth * depth * (3 - 2 * depth)];
      corners.set(key, c);
      return c;
    };
    let base = 0;
    for (let y = section.y; y < section.y + section.height; y++)
      for (let x = section.x; x < section.x + section.width; x++) {
        if (!isWater(x, y) && !nearWater(x, y)) continue;
        for (let sj = 0; sj < 2; sj++) for (let si = 0; si < 2; si++) {
          const i = x * 2 + si, j = y * 2 + sj;
          const quad = [corner(i, j), corner(i + 1, j), corner(i, j + 1), corner(i + 1, j + 1)];
          if (quad.some(c => c === null)) continue;
          [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].forEach(([ci, cj], k) => {
            positions.push(ci / 2, quad[k]![0], cj / 2);
            shores.push(quad[k]![1]);
          });
          indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
          base += 4;
        }
      }
    if (!positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('lakeShore', new THREE.Float32BufferAttribute(shores, 1));
    // Water lies level: per-quad computed normals made river slopes shine as facets.
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    geo.setIndex(indices);
    return geo;
  }, [terrain, section]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <React.Suspense fallback={null}>
    <LakeSurface geometry={geometry} />
  </React.Suspense>;
}

/** One reed clump: a fan of thin tapered blades, dark at the base, straw-green at the tips. */
function reedClumpGeometry() {
  const pos: number[] = [], color: number[] = [];
  const base = new THREE.Color('#4d5a30'), tip = new THREE.Color('#a9a463');
  for (let i = 0; i < 11; i++) {
    const a = i * 2.4, lean = .1 + hash2(i, 3) * .2, h = .65 + hash2(i, 7) * .5, w = .05;
    const ox = Math.cos(a) * .06, oz = Math.sin(a) * .06;
    const tx = ox + Math.cos(a) * lean, tz = oz + Math.sin(a) * lean;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    // Tapered blade: two triangles meeting at the tip.
    const v = [[ox - px, 0, oz - pz], [ox + px, 0, oz + pz], [tx, h, tz], [ox + px, 0, oz + pz], [ox - px, 0, oz - pz], [tx, h, tz]];
    for (const [x, y, z] of v) {
      pos.push(x, y, z);
      const c = base.clone().lerp(tip, y / h);
      color.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.computeVertexNormals();
  return g;
}

/** Reeds along lake and river banks: land cells at the water's edge, not roads or yards. */
export function ShoreReeds({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const geometry = useMemo(reedClumpGeometry, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .95 }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const clumps = useMemo(() => {
    const out: Array<{ x: number; z: number; s: number; rot: number }> = [];
    const wet = (x: number, y: number) => terrain[y]?.[x]?.type === 'water';
    for (let y = section.y; y < section.y + section.height; y++) for (let x = section.x; x < section.x + section.width; x++) {
      const c = terrain[y][x];
      if (c.type === 'water' || c.roadName || c.bridge || c.yard || c.type === 'urban' || c.type === 'sandbag') continue;
      // Lean the clumps towards the neighbouring water.
      let wx = 0, wz = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (wet(x + dx, y + dy)) { wx += dx; wz += dy; }
      if (!wx && !wz && ![-1, 0, 1].some(dy => [-1, 0, 1].some(dx => wet(x + dx, y + dy)))) continue;
      const n = hash2(x * 3.1, y * 1.7) < .6 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        if (hash2(x + i * 13, y + i * 29) < .28) continue;
        const l = Math.hypot(wx, wz) || 1;
        out.push({
          x: x + .5 + (wx / l) * .3 + (hash2(x + i, y + 5) - .5) * .5,
          z: y + .5 + (wz / l) * .3 + (hash2(x + 7, y + i) - .5) * .5,
          s: .38 + hash2(x + i * 5, y * 3) * .32, rot: hash2(x * 7 + i, y) * Math.PI * 2,
        });
      }
    }
    return out;
  }, [terrain, section]);
  const ref = React.useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    clumps.forEach((c, i) => {
      dummy.position.set(c.x, groundHeightAt(terrain, c.x, c.z) - .02, c.z);
      dummy.rotation.set(0, c.rot, 0); dummy.scale.setScalar(c.s); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [clumps, terrain]);
  if (!clumps.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, clumps.length]} raycast={() => null} />;
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
    <instancedMesh key={tufts.length} ref={ref} args={[undefined, undefined, tufts.length]} raycast={() => null} renderOrder={TUFTS_ORDER}>
      <primitive object={blades} attach="geometry" />
      {/* No depth written: units and rings are never hidden in the grass. */}
      <meshStandardMaterial side={THREE.DoubleSide} roughness={0.95} depthWrite={false} />
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
      // Not on a road's verge or shoulder, nor in a town's or village's streets: those are kept clear.
      if (terrain[y][x].roadName || settlementAt(x + .5, y + .5)) continue;
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

