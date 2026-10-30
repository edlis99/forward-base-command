import React, { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { TreePlacement } from './VolumetricTrees';

/** Genuine imported Poly Haven pine, retained from the first nature download.
 * The OBJ is 25,146 triangles; only selected nearby pines use it.
 * The original source pine leaf atlas was missing, so the new transparent
 * Scots-pine needle-sprig atlas is used on its actual branch foliage meshes.
 */
const URL = `${import.meta.env.BASE_URL}assets/nature/pine/pine.obj`;
const normalized = new WeakMap<THREE.Group, { meshes: { geometry: THREE.BufferGeometry; foliage: boolean }[]; width: number; height: number }>();
/** Vertices [start, start + count) of a non-indexed geometry, as its own geometry. */
function slice(source: THREE.BufferGeometry, start: number, count: number) {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    const a = attr as THREE.BufferAttribute;
    g.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize, a.normalized));
  }
  return g;
}
function prepared(source: THREE.Group) {
  const cached = normalized.get(source);
  if (cached) return cached;
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const meshes: { geometry: THREE.BufferGeometry; foliage: boolean }[] = [];
  source.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const whole = node.geometry.clone();
    whole.applyMatrix4(node.matrixWorld);
    whole.translate(-center.x, -bounds.min.y, -center.z);
    const mats: THREE.Material[] = Array.isArray(node.material) ? node.material : [node.material];
    // The OBJ is one object with trunk, bark and foliage material groups.
    // Split them, or the whole tree (bark included) is drawn as needles.
    const parts = whole.groups.length > 1 && !whole.index
      ? whole.groups.map(group => ({ geometry: slice(whole, group.start, group.count), material: mats[group.materialIndex ?? 0] }))
      : [{ geometry: whole, material: mats[0] }];
    for (const { geometry: g, material } of parts) {
      // The procedural and imported pine leaves share one vertex-coloured
      // material. OBJ meshes normally have no vertex colour attribute: provide
      // neutral white so the WebGL shader does not multiply foliage to black.
      if (!g.getAttribute('color')) {
        const count = g.getAttribute('position').count;
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
      }
      g.computeBoundingSphere();
      const name = `${material?.name ?? ''} ${node.name}`.toLowerCase();
      meshes.push({ geometry: g, foliage: /foliage|leaf|needle/.test(name) });
    }
  });
  const result = { meshes, width: Math.max(size.x, size.z, .01), height: Math.max(size.y, .01) };
  normalized.set(source, result);
  return result;
}
function PinePart({ trees, geometry, material, width, height, foliage }: {
  trees: TreePlacement[];
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  width: number;
  height: number;
  foliage: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    trees.forEach((tree, i) => {
      dummy.position.set(tree.x, tree.y, tree.z);
      dummy.rotation.set(0, tree.yaw, 0);
      dummy.scale.set(tree.width / width, tree.size / height, tree.width / width);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
      tint.setRGB(.88 + tree.rank * .15, .88 + tree.rank * .15, .88 + tree.rank * .15);
      ref.current!.setColorAt(i, tint);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [trees, width, height]);
  return <instancedMesh ref={ref} args={[geometry, material, trees.length]}
    castShadow={!foliage} receiveShadow={false} frustumCulled raycast={() => null} dispose={null} />;
}
function LoadedPines({ trees, materials }: {
  trees: TreePlacement[];
  materials: { wood: THREE.MeshStandardMaterial; foliage: THREE.MeshStandardMaterial };
}) {
  const source = useLoader(OBJLoader, URL);
  const model = useMemo(() => prepared(source), [source]);
  if (!trees.length) return null;
  return <group name="real-poly-haven-scots-pine-obj">
    {model.meshes.map(({ geometry, foliage }, i) =>
      <PinePart key={i} trees={trees} geometry={geometry}
        material={foliage ? materials.foliage : materials.wood}
        width={model.width} height={model.height} foliage={foliage} />)}
  </group>;
}
class PineBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch(error: Error) { console.warn('Imported Scots pine unavailable, using branched fallback', error.message); }
  render() { return this.state.broken ? this.props.fallback : this.props.children; }
}
export function ImportedPines({ trees, materials, fallback }: {
  trees: TreePlacement[];
  materials: { wood: THREE.MeshStandardMaterial; foliage: THREE.MeshStandardMaterial };
  fallback: React.ReactNode;
}) {
  if (!trees.length) return null;
  return <PineBoundary fallback={fallback}>
    <Suspense fallback={fallback}>
      <LoadedPines trees={trees} materials={materials} />
    </Suspense>
  </PineBoundary>;
}
