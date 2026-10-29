import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { TerrainCell } from '../game/types';
import type { MapSection } from './mapSections';
import { SETTLEMENTS } from '../game/maps/settlements';
import { fbm, groundHeightAt, hash2 } from './terrainHeight';
import { VolumetricTrees, type TreePlacement } from './VolumetricTrees';

export const TREE_SCALE = 0.48;
const ROOT = `${import.meta.env.BASE_URL}assets/nature`;
const TAU = Math.PI * 2;
interface NatureLayout {
  pine: TreePlacement[];
  broadleaf: TreePlacement[];
  fern: TreePlacement[];
  shrub: TreePlacement[];
  grass: TreePlacement[];
}
// Landscape-specific forest mix: pine-dominated stands in the Gailiūnai / Didžiasalis
// belt; birch, oak and alder dominate many other woods. This is art direction,
// not a cadastral forest-species survey.
const pineCentres = SETTLEMENTS.filter(s => s.id === 'gailiunai' || s.id === 'didziasalis');
export function pineProbability(x: number, z: number): number {
  const influence = Math.max(0, ...pineCentres.map(s => {
    const radius = 30 + Math.min(s.rx, s.ry) * .7;
    const d = Math.hypot(x - s.x, z - s.y);
    return Math.exp(-.5 * (d / radius) ** 2);
  }));
  const localMix = (fbm(x * .05 + 40, z * .05 + 13) - .5) * .16;
  return Math.max(.18, Math.min(.89, .30 + .56 * influence + localMix));
}
function scatter(terrain: TerrainCell[][], section: MapSection): NatureLayout {
  const result: NatureLayout = { pine: [], broadleaf: [], fern: [], shrub: [], grass: [] };
  const push = (kind: keyof NatureLayout, x: number, z: number, salt: number, height: number, width: number) => {
    const xx = x + .12 + hash2(x + salt * 2, z + salt) * .76;
    const zz = z + .12 + hash2(x + salt, z + salt * 3) * .76;
    result[kind].push({
      x: xx, z: zz, y: groundHeightAt(terrain, xx, zz) + .006,
      size: height, width,
      yaw: hash2(x + salt * 7, z + salt * 11) * TAU,
      rank: hash2(x + salt * 13, z + salt * 17),
    });
  };
  for (let z = section.y; z < section.y + section.height; z++)
    for (let x = section.x; x < section.x + section.width; x++) {
      if (terrain[z][x].type !== 'forest') continue;
      const edge = terrain[z - 1]?.[x]?.type !== 'forest'
        || terrain[z + 1]?.[x]?.type !== 'forest'
        || terrain[z]?.[x - 1]?.type !== 'forest'
        || terrain[z]?.[x + 1]?.type !== 'forest';
      const trees = hash2(x + 39, z + 81) < .40 ? 2 : 1;
      for (let n = 0; n < trees; n++) {
        if (hash2(x + n * 101, z + n * 173) < .07) continue;
        const salt = 19 + n * 31;
        const pine = hash2(x + salt, z + salt * 2) < pineProbability(x, z);
        const size = ((pine ? 3.35 : 2.75) + hash2(x + n * 47, z + n * 63) * (pine ? 1.6 : 1.25)) * TREE_SCALE;
        push(pine ? 'pine' : 'broadleaf', x, z, salt, size, size * (pine ? .64 : .86));
      }
      if (hash2(x + 427, z + 213) < (edge ? .65 : .30))
        push('fern', x, z, 79, .32 + hash2(x + 51, z + 33) * .27, 1);
      if (hash2(x + 277, z + 33) < (edge ? .54 : .18))
        push('shrub', x, z, 37, .29 + hash2(x + 57, z + 25) * .25, 1);
      if (hash2(x + 13, z + 239) < .68)
        push('grass', x, z, 67, .28 + hash2(x + 9, z + 203) * .38, 1);
    }
  return result;
}
function Instances({ geometry, material, plants }: {
  geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; plants: TreePlacement[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const instanced = ref.current;
    if (!instanced) return;
    const dummy = new THREE.Object3D();
    plants.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(p.size);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [plants]);
  if (!plants.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, plants.length]}
    receiveShadow={false} castShadow={false} raycast={() => null} />;
}
/** Understory meshes are licensed 3D OBJ/glTF assets, not tree billboards. */
function ImportedUnderstory({ layout, highQuality }: {
  layout: NatureLayout; highQuality: boolean;
}) {
  const shrubObj = useLoader(OBJLoader, `${ROOT}/shrub/shrub.obj`);
  const grassObj = useLoader(OBJLoader, `${ROOT}/grass/grass.obj`);
  const fernGltf = useLoader(GLTFLoader, `${ROOT}/fern_02/fern_02_1k.gltf`);
  const [shrubTex, grassTex] = useLoader(THREE.TextureLoader, [
    `${ROOT}/shrub/Textures/shrub_foliage.png`,
    `${ROOT}/grass/Textures/grass_blades.png`,
  ]);
  const mats = useMemo(() => {
    [shrubTex, grassTex].forEach(t => {
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    });
    return {
      shrub: new THREE.MeshStandardMaterial({ map: shrubTex, alphaTest: .4, side: THREE.DoubleSide, roughness: 1 }),
      grass: new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: .4, side: THREE.DoubleSide, roughness: 1 }),
    };
  }, [shrubTex, grassTex]);
  useEffect(() => () => Object.values(mats).forEach(m => m.dispose()), [mats]);
  const meshes = useMemo(() => {
    const collect = (obj: THREE.Object3D) => {
      const out: THREE.Mesh[] = [];
      obj.traverse(child => { if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh); });
      return out;
    };
    return { shrub: collect(shrubObj), grass: collect(grassObj), fern: collect(fernGltf.scene) };
  }, [shrubObj, grassObj, fernGltf.scene]);
  const shrubs = layout.shrub.slice(0, highQuality ? 55 : 16);
  const grasses = layout.grass.slice(0, highQuality ? 200 : 70);
  const ferns = layout.fern.slice(0, highQuality ? 90 : 30);
  const draw = (name: 'shrub' | 'grass', plants: TreePlacement[]) => meshes[name].map((mesh, i) => (
    <Instances key={`${name}-${i}`} geometry={mesh.geometry} material={mats[name]} plants={plants} />
  ));
  return <group name="3d-forest-understory">
    {draw('shrub', shrubs)}
    {draw('grass', grasses)}
    {meshes.fern.map((mesh, i) => <Instances key={`fern-${i}`}
      geometry={mesh.geometry} material={mesh.material}
      plants={ferns.filter((_, k) => k % Math.max(1, meshes.fern.length) === i)} />)}
  </group>;
}
class NatureBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.warn('Optional forest understory unavailable', error.message); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function RealisticVegetation({ terrain, section, highQuality }: {
  terrain: TerrainCell[][]; section: MapSection; highQuality: boolean;
}) {
  const layout = useMemo(() => scatter(terrain, section), [terrain, section]);
  return <group>
    {/* 3D trees are always present: no 2D cards during asset loading or at distance. */}
    <VolumetricTrees pine={layout.pine} broadleaf={layout.broadleaf} highQuality={highQuality} />
    <NatureBoundary><Suspense fallback={null}>
      <ImportedUnderstory layout={layout} highQuality={highQuality} />
    </Suspense></NatureBoundary>
  </group>;
}
