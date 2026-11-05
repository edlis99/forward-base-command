import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameState, TerrainCell, UnitType } from '../game/types';
import { CELL_SIZE } from '../game/constants';
import { meshHeight, softGround, trampleMap } from './groundCover';
import { deckAt } from './terrainHeight';

/** Most track segments kept; the oldest give way. */
const CAPACITY = 12000;
/** Seconds of game time a track stays, fading over its second half. */
const TRACK_LIFE = 180;
/** Distance between segments, and the track's width (cells): a tank's tracks span about 0.24 cell. */
const STEP: Partial<Record<UnitType, number>> = { tank: .14, apc: .14, infantry: .16 };
const WIDTH: Partial<Record<UnitType, number>> = { tank: .25, apc: .27, infantry: .08 };
const KIND: Partial<Record<UnitType, number>> = { tank: 0, apc: 1, infantry: 2 };


/**
 * Tracks on the ground. Tanks leave two tread bands with their grousers'
 * marks, APCs the lines of their tyres, soldiers walking through the meadows
 * a faint trail. Each also lays the grass flat along its way (the trample
 * map, which the grass reads: vehicles flatten it at once, soldiers a little
 * with every pass, so paths appear where many walk). Tracks fade over three
 * minutes of game time; a paused battle keeps them.
 */
export function TrackMarks({ gameStateRef, terrain }: { gameStateRef: React.MutableRefObject<GameState>; terrain: TerrainCell[][] }) {
  const trample = useMemo(() => trampleMap(terrain), [terrain]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const attrs = useMemo(() => ({
    birth: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY).fill(-1e9), 1),
    kind: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1),
    odo: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1),
    len: new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1),
  }), []);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uLife: { value: TRACK_LIFE } }), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `
      attribute float aBirth; attribute float aKind; attribute float aOdo; attribute float aLen;
      uniform float uTime;
      varying vec2 vUv; varying float vAge; varying float vKind; varying float vOdo;
      void main() {
        vUv = vec2(position.x + 0.5, position.z + 0.5);
        vAge = uTime - aBirth; vKind = aKind; vOdo = aOdo + vUv.x * aLen;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uLife;
      varying vec2 vUv; varying float vAge; varying float vKind; varying float vOdo;
      float band(float u, float a, float b) { return smoothstep(a - 0.03, a + 0.03, u) * (1.0 - smoothstep(b - 0.03, b + 0.03, u)); }
      void main() {
        float a;
        if (vKind < 0.5) {
          // Tank: two tread bands, the grousers pressed in every half metre or so.
          float tread = 0.55 + 0.45 * step(0.45, fract(vOdo / 0.03));
          a = (band(vUv.y, 0.05, 0.31) + band(vUv.y, 0.69, 0.95)) * tread * 0.5;
        } else if (vKind < 1.5) {
          // APC: the tyres' two lines, a faint tread.
          a = (band(vUv.y, 0.15, 0.31) + band(vUv.y, 0.69, 0.85)) * (0.8 + 0.2 * step(0.5, fract(vOdo / 0.018))) * 0.42;
        } else {
          // Soldiers: a soft trodden line.
          a = smoothstep(0.1, 0.45, vUv.y) * (1.0 - smoothstep(0.55, 0.9, vUv.y)) * 0.16;
        }
        a *= 1.0 - smoothstep(uLife * 0.5, uLife, vAge);
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.11, 0.085, 0.06, a);
      }`,
  }), [uniforms]);
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(geometry, material, CAPACITY);
    im.geometry.setAttribute('aBirth', attrs.birth); im.geometry.setAttribute('aKind', attrs.kind);
    im.geometry.setAttribute('aOdo', attrs.odo); im.geometry.setAttribute('aLen', attrs.len);
    // Unused slots sit far below the map until a track takes them.
    const hidden = new THREE.Matrix4().makeTranslation(0, -1e4, 0);
    for (let i = 0; i < CAPACITY; i++) im.setMatrixAt(i, hidden);
    im.frustumCulled = false; im.raycast = () => null; im.renderOrder = 1;
    return im;
  }, [geometry, material, attrs]);
  useEffect(() => () => { mesh.dispose(); geometry.dispose(); material.dispose(); }, [mesh, geometry, material]);

  const state = useRef({ next: 0, last: new Map<string, { x: number; z: number; odo: number }>(), time: NaN, game: null as GameState | null });
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);

  useFrame(() => {
    const game = gameStateRef.current, now = game.time, st = state.current;
    if (st.game !== game) {
      // A new battle: clear the last one's tracks.
      if (st.game) {
        attrs.birth.array.fill(-1e9); attrs.birth.needsUpdate = true;
        const hidden = new THREE.Matrix4().makeTranslation(0, -1e4, 0);
        for (let i = 0; i < CAPACITY; i++) mesh.setMatrixAt(i, hidden);
        mesh.instanceMatrix.needsUpdate = true;
      }
      st.game = game; st.last.clear(); st.next = 0; st.time = NaN;
    }
    const dt = Number.isFinite(st.time) ? Math.max(0, now - st.time) : 0;
    st.time = now;
    uniforms.uTime.value = now;
    let first = -1, count = 0;
    for (const u of game.units) {
      const step = STEP[u.type];
      if (!step || !u.alive || u.insideOf) { st.last.delete(u.id); continue; }
      const x = u.pos.x / CELL_SIZE, z = u.pos.y / CELL_SIZE, last = st.last.get(u.id);
      if (!last) { st.last.set(u.id, { x, z, odo: 0 }); continue; }
      const d = Math.hypot(x - last.x, z - last.z);
      if (d < step) continue;
      // A jump (boarding, a respawn) is not driving.
      if (d > 2) { st.last.set(u.id, { x, z, odo: last.odo }); continue; }
      const mx = (x + last.x) / 2, mz = (z + last.z) / 2, cell = terrain[Math.floor(mz)]?.[Math.floor(mx)];
      if (softGround(cell) && !deckAt(terrain, mx, mz)) {
        const infantry = u.type === 'infantry', width = WIDTH[u.type]!;
        // One soldier through the meadow leaves a line; a few in his steps beat a path.
        trample.stroke(last.x, last.z, x, z, infantry ? width / 2 + .01 : width / 2 + .02, infantry ? .5 : 1, infantry);
        // Soldiers leave a visible line only through the tall meadow grass.
        if (!infantry || cell?.type === 'tall_grass') {
          const i = st.next;
          st.next = (st.next + 1) % CAPACITY;
          tmp.p.set(mx, meshHeight(terrain, mx, mz) + .006, mz);
          tmp.q.setFromAxisAngle(tmp.up, -Math.atan2(z - last.z, x - last.x));
          tmp.s.set(d, 1, width);
          mesh.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s));
          attrs.birth.setX(i, now); attrs.kind.setX(i, KIND[u.type]!); attrs.odo.setX(i, last.odo); attrs.len.setX(i, d);
          if (first < 0) first = i;
          count++;
        }
      }
      st.last.set(u.id, { x, z, odo: last.odo + d });
    }
    if (count) {
      // Send only the slots written this frame (in one or two runs round the ring).
      const runs = first + count <= CAPACITY ? [[first, count]] : [[first, CAPACITY - first], [0, first + count - CAPACITY]];
      for (const [start, n] of runs) {
        mesh.instanceMatrix.addUpdateRange(start * 16, n * 16);
        for (const a of [attrs.birth, attrs.kind, attrs.odo, attrs.len]) a.addUpdateRange(start, n);
      }
      mesh.instanceMatrix.needsUpdate = true;
      for (const a of [attrs.birth, attrs.kind, attrs.odo, attrs.len]) a.needsUpdate = true;
    }
    trample.update(dt);
  });
  return <primitive object={mesh} />;
}
