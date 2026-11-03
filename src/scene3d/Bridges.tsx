import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { spanBoxes } from './bridgeSpans';

/** Instanced bridge spans for one map section (geometry from bridgeSpans.ts). */
export function Bridges({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const boxes = useMemo(() => spanBoxes(terrain, section), [terrain, section]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: .9, metalness: 0 }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    // Yaw along the road, then pitch for a deck that slopes between its banks.
    dummy.rotation.order = 'YZX';
    boxes.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, b.yaw, b.pitch ?? 0); dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, color.set(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);
  if (!boxes.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, boxes.length]} castShadow receiveShadow raycast={() => null} />;
}
