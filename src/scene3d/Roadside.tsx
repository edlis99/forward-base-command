import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TerrainCell } from '../game/types';
import { meshHeight } from './groundCover';
import { roadsidePlan } from './roadsidePlan';

/**
 * The roadside of the roadside plan (roadsidePlan.ts): wooden utility poles with their
 * wires, street lamps in the towns and wayside crosses at rural crossroads. Everything
 * is instanced and casts its thin shadow; the wires fade out as the camera climbs.
 */

// Sizes in cells (one cell is about 12 m).
const POLE_HEIGHT = .78, ARM_Y = .7, ARM_HALF = .075, SAG = .04, WIRE_STEPS = 6;
const LAMP_HEIGHT = .5, LAMP_REACH = .11;
const CROSS_HEIGHT = .26;

type Part = { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; color: THREE.Color };
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, rotZ = 0): Part =>
  ({ geometry: new THREE.BoxGeometry(w, h, d), matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ), new THREE.Vector3(1, 1, 1)), color: new THREE.Color(color) });
const cylinder = (r0: number, r1: number, h: number, x: number, y: number, z: number, color: string): Part =>
  ({ geometry: new THREE.CylinderGeometry(r1, r0, h, 7), matrix: new THREE.Matrix4().makeTranslation(x, y, z), color: new THREE.Color(color) });

/** One geometry from several parts, each with its own colour. */
function merged(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  const normalMatrix = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const { geometry, matrix, color } of parts) {
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), base = positions.length / 3;
    normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix); positions.push(v.x, v.y, v.z);
      v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize(); normals.push(v.x, v.y, v.z);
      colors.push(color.r, color.g, color.b);
    }
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    geometry.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.setIndex(indices);
  return out;
}

const WOOD = '#4d3d2c', WOOD_DARK = '#3f3124', INSULATOR = '#8d9088', METAL = '#767b7d', LAMP_HEAD = '#d9dbd2', CONCRETE = '#8a877d', CROSS_WOOD = '#5a4129';

/** A wooden utility pole: the pole, a crossarm along local x, and an insulator at each end. Base at y = 0. */
const poleGeometry = () => merged([
  cylinder(.0125, .0085, POLE_HEIGHT + .01, 0, POLE_HEIGHT / 2 - .005, 0, WOOD),
  box(ARM_HALF * 2 + .02, .011, .011, 0, ARM_Y, 0, WOOD_DARK),
  box(.008, .018, .008, -ARM_HALF, ARM_Y + .013, 0, INSULATOR),
  box(.008, .018, .008, ARM_HALF, ARM_Y + .013, 0, INSULATOR),
]);
/** A street lamp: a steel pole and an arm reaching along local x, ending in a lamp head. */
const lampGeometry = () => merged([
  cylinder(.0085, .0065, LAMP_HEIGHT, 0, LAMP_HEIGHT / 2, 0, METAL),
  box(LAMP_REACH, .007, .007, LAMP_REACH / 2, LAMP_HEIGHT - .004, 0, METAL, .12),
  box(.05, .011, .022, LAMP_REACH + .012, LAMP_HEIGHT + .002, 0, LAMP_HEAD),
]);
/** A wayside cross on a stone base, facing local +z. */
const crossGeometry = () => merged([
  box(.034, .02, .034, 0, .01, 0, CONCRETE),
  box(.012, CROSS_HEIGHT, .012, 0, .02 + CROSS_HEIGHT / 2, 0, CROSS_WOOD),
  box(.11, .012, .012, 0, .02 + CROSS_HEIGHT * .72, 0, CROSS_WOOD),
  box(.03, .012, .03, 0, .02 + CROSS_HEIGHT + .004, 0, CROSS_WOOD, 0), // a small cap
]);

export function Roadside({ terrain }: { terrain: TerrainCell[][] }) {
  const plan = useMemo(() => roadsidePlan(terrain), [terrain]);
  const ground = (x: number, z: number) => meshHeight(terrain, x, z);

  const meshes = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: 0 });
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const instanced = (geometry: THREE.BufferGeometry, entries: { x: number; y: number; yaw: number }[]) => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, entries.length));
      entries.forEach((e, i) => {
        // Local x turns to the entry's direction on the map (x, z).
        q.setFromAxisAngle(up, e.yaw);
        mesh.setMatrixAt(i, new THREE.Matrix4().compose(pos.set(e.x, ground(e.x, e.y) - .004, e.y), q, one));
      });
      mesh.count = entries.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.raycast = () => null;
      return mesh;
    };
    const poles = instanced(poleGeometry(), plan.poles.map(p => ({ x: p.x, y: p.y, yaw: Math.atan2(-p.ay, p.ax) })));
    const lamps = instanced(lampGeometry(), plan.lamps.map(l => ({ x: l.x, y: l.y, yaw: Math.atan2(-l.dy, l.dx) })));
    // A cross faces along local z: turn it so z points at the crossroads.
    const crosses = instanced(crossGeometry(), plan.crosses.map(c => ({ x: c.x, y: c.y, yaw: Math.atan2(Math.cos(c.angle), Math.sin(c.angle)) })));

    // Wires: two a span, from the crossarm ends, each sagging in the middle.
    const wire: number[] = [];
    const top = plan.poles.map(p => ground(p.x, p.y) + ARM_Y + .02);
    for (const span of plan.spans) {
      const a = plan.poles[span.a], b = plan.poles[span.b];
      for (const side of [-1, 1]) {
        const ax = a.x + a.ax * ARM_HALF * side, az = a.y + a.ay * ARM_HALF * side, bx = b.x + b.ax * ARM_HALF * side, bz = b.y + b.ay * ARM_HALF * side;
        for (let k = 0; k < WIRE_STEPS; k++) {
          for (const t of [k / WIRE_STEPS, (k + 1) / WIRE_STEPS]) wire.push(ax + (bx - ax) * t, top[span.a] + (top[span.b] - top[span.a]) * t - SAG * 4 * t * (1 - t), az + (bz - az) * t);
        }
      }
    }
    const wireGeometry = new THREE.BufferGeometry();
    wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const wireMaterial = new THREE.LineBasicMaterial({ color: '#16191b', transparent: true, opacity: .8, depthWrite: false });
    const wires = new THREE.LineSegments(wireGeometry, wireMaterial);
    wires.frustumCulled = false; wires.raycast = () => null;
    return { poles, lamps, crosses, wires, material };
  }, [plan, terrain]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    for (const mesh of [meshes.poles, meshes.lamps, meshes.crosses]) mesh.geometry.dispose();
    meshes.wires.geometry.dispose(); (meshes.wires.material as THREE.Material).dispose(); meshes.material.dispose();
  }, [meshes]);

  // Wires are fine lines: they thin out and fade as the camera climbs, so a far view is not scored with them.
  useFrame(({ camera }) => {
    (meshes.wires.material as THREE.LineBasicMaterial).opacity = .8 * (1 - THREE.MathUtils.smoothstep(camera.position.y, 20, 42));
    meshes.wires.visible = camera.position.y < 42;
  });

  return <group name="roadside">
    <primitive object={meshes.poles} />
    <primitive object={meshes.lamps} />
    <primitive object={meshes.crosses} />
    <primitive object={meshes.wires} />
  </group>;
}
