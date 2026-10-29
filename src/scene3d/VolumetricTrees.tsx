import { useEffect, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { canopyMaterial } from './canopyReveal';

/** Low-cost, fully three-dimensional forestry. No crossed billboards or camera-facing cards. */
export interface TreePlacement {
  x: number; y: number; z: number; size: number; width: number; yaw: number; rank: number;
}
export type TreeSpecies = 'pine' | 'spruce' | 'birch' | 'oak' | 'alder';
type V3 = [number, number, number];
interface Part {
  shape: 'trunk' | 'crown' | 'conifer';
  offset: V3;
  scale: V3;
  foliage?: boolean;
  colors?: string[];
}
const geometry: Record<Part['shape'], THREE.BufferGeometry> = {
  trunk: new THREE.CylinderGeometry(.5, .62, 1, 8),
  crown: new THREE.IcosahedronGeometry(.5, 1),
  conifer: new THREE.ConeGeometry(.5, 1, 9),
};
/** Source images are stored locally, including the real pine bark PNG. The
 * other species use the 512px forest material maps bundled in /nature/trees. */
const ROOT = `${import.meta.env.BASE_URL}assets/nature`;
const TEXTURES = [
  'pine/Textures/pine_bark.png', 'trees/pine_foliage.svg',
  'trees/spruce_bark.svg', 'trees/spruce_foliage.svg',
  'trees/birch_bark.svg', 'trees/birch_foliage.svg',
  'trees/oak_bark.svg', 'trees/oak_foliage.svg',
  'trees/alder_bark.svg', 'trees/alder_foliage.svg',
].map(path => `${ROOT}/${path}`);
const MATERIAL_SLOTS: Record<TreeSpecies, [number, number]> = {
  pine: [0, 1], spruce: [2, 3], birch: [4, 5], oak: [6, 7], alder: [8, 9],
};
type TexturedMaterials = Record<TreeSpecies, { bark: THREE.MeshStandardMaterial; leaves: THREE.MeshStandardMaterial }>;

function useTreeMaterials(): TexturedMaterials {
  // useLoader caches texture objects by URL; all visible map sections reuse them.
  const images = useLoader(THREE.TextureLoader, TEXTURES);
  const materials = useMemo(() => {
    images.forEach(image => {
      image.colorSpace = THREE.SRGBColorSpace;
      image.wrapS = image.wrapT = THREE.RepeatWrapping;
      image.anisotropy = 8;
      image.needsUpdate = true;
    });
    const result = {} as TexturedMaterials;
    (Object.keys(MATERIAL_SLOTS) as TreeSpecies[]).forEach(species => {
      const [barkIndex, foliageIndex] = MATERIAL_SLOTS[species];
      const bark = images[barkIndex], leaves = images[foliageIndex];
      const barkMaterial = new THREE.MeshStandardMaterial({
        map: bark, bumpMap: bark, bumpScale: .012,
        roughness: .97, metalness: 0,
      });
      const foliageMaterial = canopyMaterial();
      foliageMaterial.map = leaves;
      foliageMaterial.bumpMap = leaves;
      foliageMaterial.bumpScale = .016;
      foliageMaterial.roughness = .98;
      foliageMaterial.side = THREE.FrontSide;
      foliageMaterial.needsUpdate = true;
      result[species] = { bark: barkMaterial, leaves: foliageMaterial };
    });
    return result;
  }, [images]);
  useEffect(() => () => {
    Object.values(materials).forEach(({ bark, leaves }) => {
      bark.dispose(); leaves.dispose();
    });
  }, [materials]);
  return materials;
}

const branch = (offset: V3, scale: V3): Part => ({ shape: 'crown', offset, scale, foliage: true });
const tiers = (offset: V3, scale: V3): Part => ({ shape: 'conifer', offset, scale, foliage: true });
const parts: Record<TreeSpecies, Part[]> = {
  pine: [
    { shape: 'trunk', offset: [0, .41, 0], scale: [.09, .82, .09] },
    branch([0, .83, 0], [.78, .24, .70]),
    branch([-.27, .79, .15], [.57, .20, .57]),
    branch([.25, .82, -.18], [.62, .21, .52]),
    branch([-.08, .95, -.08], [.51, .18, .50]),
    branch([.08, .71, .29], [.46, .19, .48]),
  ],
  spruce: [
    { shape: 'trunk', offset: [0, .44, 0], scale: [.085, .88, .085] },
    tiers([0, .54, 0], [1.06, .64, 1.06]),
    tiers([0, .73, 0], [.81, .55, .81]),
    tiers([0, .91, 0], [.50, .38, .50]),
  ],
  birch: [
    { shape: 'trunk', offset: [0, .40, 0], scale: [.075, .80, .075] },
    branch([-.09, .78, 0], [.70, .43, .70]),
    branch([.20, .73, .12], [.72, .34, .64]),
    branch([-.24, .68, -.17], [.61, .31, .63]),
    branch([0, .94, -.05], [.54, .25, .60]),
  ],
  oak: [
    { shape: 'trunk', offset: [0, .34, 0], scale: [.14, .68, .14] },
    branch([0, .78, 0], [.95, .46, .91]),
    branch([-.32, .69, .27], [.74, .36, .73]),
    branch([.32, .73, -.26], [.76, .38, .75]),
    branch([-.28, .85, -.30], [.68, .31, .67]),
    branch([.25, .88, .27], [.64, .30, .69]),
    branch([0, .98, 0], [.60, .26, .64]),
  ],
  alder: [
    { shape: 'trunk', offset: [0, .39, 0], scale: [.105, .78, .105] },
    branch([0, .78, 0], [.76, .43, .79]),
    branch([-.22, .69, .19], [.63, .32, .66]),
    branch([.22, .73, -.22], [.65, .32, .63]),
    branch([0, .93, .06], [.58, .29, .56]),
  ],
};
function TreeBatch({ trees, species, part, index, material }: {
  trees: TreePlacement[]; species: TreeSpecies; part: Part; index: number;
  material: THREE.MeshStandardMaterial;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < trees.length; i++) {
      const p = trees[i];
      // X/Z offsets rotate with the trunk, retaining distinct crowns from every viewing angle.
      const angle = p.yaw + Math.sin((index + 1) * 17 + p.rank * 31) * .24;
      const ox = part.offset[0] * p.width, oz = part.offset[2] * p.width;
      dummy.position.set(p.x + ox * Math.cos(angle) - oz * Math.sin(angle),
        p.y + part.offset[1] * p.size,
        p.z + ox * Math.sin(angle) + oz * Math.cos(angle));
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(p.width * part.scale[0], p.size * part.scale[1], p.width * part.scale[2]);
      dummy.updateMatrix();
      target.setMatrixAt(i, dummy.matrix);
      // Texture supplies the actual bark/needle/leaf colour. Instance colour
      // adjusts brightness subtly without multiplying the image by dark greens.
      const brightness = .84 + .25 * ((p.rank * 13.9 + index * 1.7) % 1);
      color.setRGB(brightness, brightness, brightness);
      target.setColorAt(i, color);
    }
    target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    target.computeBoundingSphere();
  }, [trees, species, part, index]);
  if (!trees.length) return null;
  return <instancedMesh ref={mesh} args={[geometry[part.shape], material, trees.length]}
    castShadow={!part.foliage} receiveShadow={false} raycast={() => null} />;
}
export function VolumetricTrees({ pine, broadleaf, highQuality }: {
  pine: TreePlacement[]; broadleaf: TreePlacement[]; highQuality: boolean;
}) {
  const materials = useTreeMaterials();
  const groups = useMemo((): Record<TreeSpecies, TreePlacement[]> => {
    const result: Record<TreeSpecies, TreePlacement[]> = { pine: [], spruce: [], birch: [], oak: [], alder: [] };
    pine.forEach(p => result[p.rank < .19 ? 'spruce' : 'pine'].push(p));
    broadleaf.forEach(p => result[p.rank < .48 ? 'birch' : p.rank < .83 ? 'oak' : 'alder'].push(p));
    return result;
  }, [pine, broadleaf]);
  return <group name="3d-woodland-no-billboards">
    {(Object.keys(groups) as TreeSpecies[]).map(species =>
      <group key={species} name={species}>
        {parts[species].filter((part, index) => highQuality || index < 4).map((part, index) =>
          <TreeBatch key={index} species={species} trees={groups[species]} part={part} index={index}
            material={part.foliage ? materials[species].leaves : materials[species].bark} />)}
      </group>)}
  </group>;
}
