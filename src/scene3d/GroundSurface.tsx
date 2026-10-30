import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { MapSection } from './mapSections';
import { createRoadTexture, landscapeMaterial } from './roadMaterial';
import { makeGrainTexture } from './materials';
import { buildGroundGeometry } from './groundGeometry';
import { groundHeightAt, hash2 } from './terrainHeight';
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

/** Actual lake material with two seamless, animated normal textures. */
function LakeSurface({ geometry }: { geometry: THREE.BufferGeometry }) {
  const material = useLakeWaterMaterial();
  return <mesh geometry={geometry} raycast={() => null} renderOrder={1}>
    <primitive object={material} attach="material" />
  </mesh>;
}

/** Connected inland water sheet: neighbouring quads share corner positions
 * and subtle shoreline colour variation. No per-cell blue tiles. */
export function WaterSheet({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const indices: number[] = [];
    const shores: number[] = [];
    const isWater = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < W && y < H && terrain[y][x].type === 'water';
    const cornerWetness = (cx: number, cy: number) => {
      let n = 0;
      if (isWater(cx - 1, cy - 1)) n++;
      if (isWater(cx, cy - 1)) n++;
      if (isWater(cx - 1, cy)) n++;
      if (isWater(cx, cy)) n++;
      return n / 4;
    };
    const cornerOffset = (cx: number, cy: number) => ({
      x: (hash2(cx * 5.3, cy * 7.1) - 0.5) * 0.32,
      z: (hash2(cx * 9.7, cy * 3.9) - 0.5) * 0.32,
    });
    let base = 0;
    for (let y = section.y; y < section.y + section.height; y++)
      for (let x = section.x; x < section.x + section.width; x++) {
        if (terrain[y][x].type !== 'water') continue;
        const corners: Array<[number, number]> = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
        for (const [cx, cy] of corners) {
          // Shared keyed vertices prevent visible gaps between lake cells and
          // along streaming section boundaries.
          const offset = cornerOffset(cx, cy);
          const wet = cornerWetness(cx, cy);
          const px = cx + offset.x, pz = cy + offset.z;
          const height = groundHeightAt(terrain, px, pz) + 0.40 - wet * 0.06;
          positions.push(px, height, pz);
          shores.push(1 - wet);
        }
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        base += 4;
      }
    if (!positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('lakeShore', new THREE.Float32BufferAttribute(shores, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [terrain, section]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return <React.Suspense fallback={null}>
    <LakeSurface geometry={geometry} />
  </React.Suspense>;
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

