import React, { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { canopyMaterial } from './canopyReveal';
import { forestGeometry, type ForestSpecies, type ForestDetail } from './ForestMeshes';
import { ImportedPines } from './ImportedPines';

export interface TreePlacement {
  x: number; y: number; z: number; size: number; width: number; yaw: number; rank: number;
}
export type TreeSpecies = ForestSpecies;

const speciesOrder: ForestSpecies[] = ['pine', 'spruce', 'birch', 'oak', 'alder'];
const ROOT = `${import.meta.env.BASE_URL}assets/nature`;
const texturePaths = [
  'pine/Textures/pine_bark.png', 'trees/pine_sprig.svg',
  'trees/spruce_bark.svg', 'trees/spruce_sprig.svg',
  'trees/birch_bark.svg', 'trees/birch_sprig.svg',
  'trees/oak_bark.svg', 'trees/oak_sprig.svg',
  'trees/alder_bark.svg', 'trees/alder_sprig.svg',
].map(p => `${ROOT}/${p}`);

interface TreeMaterials { wood: THREE.MeshStandardMaterial; foliage: THREE.MeshStandardMaterial; }
type Materials = Record<ForestSpecies, TreeMaterials>;

function useForestMaterials(): Materials {
  const textures = useLoader(THREE.TextureLoader, texturePaths);
  const result = useMemo(() => {
    const materials = {} as Materials;
    speciesOrder.forEach((species, index) => {
      const bark = textures[index * 2], foliage = textures[index * 2 + 1];
      bark.colorSpace = THREE.SRGBColorSpace;
      bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
      bark.anisotropy = 8; bark.needsUpdate = true;
      foliage.colorSpace = THREE.SRGBColorSpace;
      foliage.wrapS = foliage.wrapT = THREE.ClampToEdgeWrapping;
      foliage.anisotropy = 8; foliage.needsUpdate = true;
      const wood = new THREE.MeshStandardMaterial({
        map: bark, bumpMap: bark, bumpScale: .014, roughness: .96, metalness: 0,
        side: THREE.FrontSide,
      });
      const leaves = canopyMaterial();
      leaves.map = foliage;
      leaves.alphaTest = .34;
      leaves.side = THREE.DoubleSide;
      leaves.vertexColors = true;
      leaves.depthWrite = true;
      leaves.transparent = false;
      leaves.roughness = .94;
      // Prevent almost-black needle mats under the strong tactical sun.
      leaves.emissive.set('#354b32');
      leaves.emissiveIntensity = species === 'pine' || species === 'spruce' ? .10 : .14;
      leaves.needsUpdate = true;
      materials[species] = { wood, foliage: leaves };
    });
    return materials;
  }, [textures]);
  useEffect(() => () => {
    Object.values(result).forEach(({ wood, foliage }) => { wood.dispose(); foliage.dispose(); });
  }, [result]);
  return result;
}

interface Positioned { key: string; tree: TreePlacement; }
type SpeciesGroups = Record<ForestSpecies, Positioned[]>;
function distribute(pine: TreePlacement[], broadleaf: TreePlacement[]): SpeciesGroups {
  const result = { pine: [], spruce: [], birch: [], oak: [], alder: [] } as SpeciesGroups;
  pine.forEach((tree, index) => {
    const species = tree.rank < .19 ? 'spruce' : 'pine';
    result[species].push({ tree, key: `p${index}` });
  });
  broadleaf.forEach((tree, index) => {
    const species = tree.rank < .48 ? 'birch' : tree.rank < .83 ? 'oak' : 'alder';
    result[species].push({ tree, key: `b${index}` });
  });
  return result;
}
function InstanceGeometry({ trees, geometry, material, wood }: {
  trees: TreePlacement[];
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  wood: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new THREE.Object3D(), tint = new THREE.Color();
    trees.forEach((tree, i) => {
      dummy.position.set(tree.x, tree.y, tree.z);
      dummy.rotation.set(0, tree.yaw, 0);
      // The botanical meshes are normalized to one unit tall; the width is
      // independent so a broad oak crown never looks like a tall conifer.
      dummy.scale.set(tree.width, tree.size, tree.width);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
      const shade = .85 + .18 * tree.rank;
      tint.setRGB(shade, shade, shade);
      mesh.current!.setColorAt(i, tint);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [trees]);
  if (!trees.length) return null;
  return <instancedMesh ref={mesh} args={[geometry, material, trees.length]}
    castShadow={wood} receiveShadow={false} frustumCulled raycast={() => null} dispose={null} />;
}

function MeshBatch({ species, detail, variant, trees, materials }: {
  species: ForestSpecies;
  detail: ForestDetail;
  variant: number;
  trees: TreePlacement[];
  materials: TreeMaterials;
}) {
  const mesh = forestGeometry(species, variant, detail);
  if (!trees.length) return null;
  return <group name={`${species}-${detail}-mesh-${variant}`}>
    <InstanceGeometry geometry={mesh.wood} material={materials.wood} trees={trees} wood />
    <InstanceGeometry geometry={mesh.leaves} material={materials.foliage} trees={trees} wood={false} />
  </group>;
}

function LoadedForest({ pine, broadleaf, highQuality }: {
  pine: TreePlacement[]; broadleaf: TreePlacement[]; highQuality: boolean;
}) {
  const materials = useForestMaterials();
  const { camera } = useThree();
  const groups = useMemo(() => distribute(pine, broadleaf), [pine, broadleaf]);
  const [nearKeys, setNearKeys] = useState<string[]>([]);
  const checkTimer = useRef(0);
  const lastKeys = useRef('');
  useFrame((_, delta) => {
    checkTimer.current += Math.min(.1, delta);
    if (checkTimer.current < .8) return;
    checkTimer.current = 0;
    const selected: Array<{ key: string; distance: number }> = [];
    const x = camera.position.x;
    // Approximate centre of the fixed isometric camera's ground look-at.
    const z = camera.position.z - camera.position.y * .65;
    if (camera.position.y < (highQuality ? 95 : 55)) {
      speciesOrder.forEach(species => groups[species].forEach(({ tree, key }) => {
        const distance = Math.hypot(tree.x - x, tree.z - z);
        if (distance < (highQuality ? 35 : 22))
          selected.push({ key, distance });
      }));
    }
    const next = selected.sort((a, b) => a.distance - b.distance)
      .slice(0, highQuality ? 36 : 12).map(item => item.key).sort();
    const signature = next.join('/');
    if (signature !== lastKeys.current) { lastKeys.current = signature; setNearKeys(next); }
  });
  const batches = useMemo(() => {
    const nearSet = new Set(nearKeys);
    const results: Array<{ species: ForestSpecies; detail: ForestDetail; variant: number; trees: TreePlacement[] }> = [];
    for (const species of speciesOrder) {
      const far: TreePlacement[] = [], near: [TreePlacement[], TreePlacement[]] = [[], []];
      for (const { tree, key } of groups[species]) {
        if (nearSet.has(key)) near[tree.rank < .5 ? 0 : 1].push(tree);
        else far.push(tree);
      }
      results.push({ species, detail: 'far', variant: 0, trees: far });
      results.push({ species, detail: 'near', variant: 0, trees: near[0] });
      results.push({ species, detail: 'near', variant: 1, trees: near[1] });
    }
    return results;
  }, [groups, nearKeys]);
  const nearPines = batches.filter(batch => batch.species === 'pine' && batch.detail === 'near');
  const naturalPines = nearPines.flatMap(batch => batch.trees);
  const pineFallback = <group name="imported-pine-fallback">
    {nearPines.filter(batch => batch.trees.length).map(batch =>
      <MeshBatch key={`pine-fallback-${batch.variant}`} {...batch} materials={materials.pine} />)}
  </group>;
  return <group name="botanical-3d-forest-with-branch-meshes">
    {batches.filter(batch => batch.trees.length > 0 && !(batch.species === 'pine' && batch.detail === 'near'))
      .map(batch =>
        <MeshBatch key={`${batch.species}-${batch.detail}-${batch.variant}`}
          {...batch} materials={materials[batch.species]} />)}
    {/* Only the nearest pines use the actual licensed 3D OBJ; the rest of the
        forest uses lighter branching 3D LODs, never full-tree billboards. */}
    {highQuality && naturalPines.length > 0
      ? <ImportedPines trees={naturalPines} materials={materials.pine} fallback={pineFallback} />
      : pineFallback}
  </group>;
}

/** No low-poly tree placeholders: foliage only appears once the real botanical textures load. */
export function VolumetricTrees(props: {
  pine: TreePlacement[]; broadleaf: TreePlacement[]; highQuality: boolean;
}) {
  return <Suspense fallback={null}><LoadedForest {...props} /></Suspense>;
}
