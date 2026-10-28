import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { TerrainCell } from '../game/types';
import type { MapSection } from './mapSections';
import { Woodland } from './Environment';
import { canopyMaterial } from './canopyReveal';
import { fbm, groundHeightAt, hash2 } from './terrainHeight';

/**
 * Whole-map forest replacement. Every forest cell receives pack-derived
 * pine/broadleaf silhouettes; nearby sections also show the actual optimized
 * pine OBJ, fern glTF, shrub OBJ and grass OBJ models. Nothing here changes
 * tactical cell cover, collision, visibility, or unit movement.
 *
 * The full pine foliage atlas is not available yet. The OBJ's leaf material
 * uses the source's smaller tree-card placeholder until it is restored.
 * See public/assets/nature/README.md for CC0 sources and limitations.
 */
const ROOT = '/assets/nature';
const TAU = Math.PI * 2;

interface Placement {
  x: number; y: number; z: number;
  size: number; width: number; yaw: number; rank: number;
}
interface NatureLayout {
  pine: Placement[];
  broadleaf: Placement[];
  fern: Placement[];
  shrub: Placement[];
  grass: Placement[];
}

function scatter(terrain: TerrainCell[][], section: MapSection): NatureLayout {
  const result: NatureLayout = { pine: [], broadleaf: [], fern: [], shrub: [], grass: [] };
  const push = (kind: keyof NatureLayout, x: number, z: number, salt: number, height: number, width: number) => {
    const xx = x + 0.13 + hash2(x + salt * 2, z + salt) * 0.74;
    const zz = z + 0.13 + hash2(x + salt, z + salt * 3) * 0.74;
    result[kind].push({
      x: xx, z: zz, y: groundHeightAt(terrain, xx, zz) + 0.006,
      size: height, width, yaw: hash2(x + salt * 7, z + salt * 11) * TAU,
      rank: hash2(x + salt * 13, z + salt * 17),
    });
  };

  for (let z = section.y; z < section.y + section.height; z++) {
    for (let x = section.x; x < section.x + section.width; x++) {
      if (terrain[z][x].type !== 'forest') continue;
      const stand = fbm(x * 0.045 + 40, z * 0.045 + 13) > 0.5;
      const edge =
        terrain[z - 1]?.[x]?.type !== 'forest' ||
        terrain[z + 1]?.[x]?.type !== 'forest' ||
        terrain[z]?.[x - 1]?.type !== 'forest' ||
        terrain[z]?.[x + 1]?.type !== 'forest';
      // Each forest cell gets a textured tree instead of procedural cones.
      // Slightly staggered pairs fill dense woodland without grid repetition.
      for (let n = 0; n < (hash2(x + 39, z + 81) < 0.35 ? 2 : 1); n++) {
        if (hash2(x + n * 101, z + n * 173) < 0.07) continue;
        const salt = 19 + n * 31;
        const pine = hash2(x + salt, z + salt * 2) < (stand ? 0.85 : 0.56);
        const size = (pine ? 3.15 : 2.50) + hash2(x + n * 47, z + n * 63) * (pine ? 1.50 : 1.15);
        push(pine ? 'pine' : 'broadleaf', x, z, salt, size, size * (pine ? 0.62 : 0.84));
      }
      if (hash2(x + 427, z + 213) < (edge ? 0.65 : 0.30))
        push('fern', x, z, 79, 1.0 + hash2(x + 51, z + 33) * 0.7, 1);
      if (hash2(x + 277, z + 33) < (edge ? 0.54 : 0.18))
        push('shrub', x, z, 37, 0.65 + hash2(x + 57, z + 25) * 0.45, 1);
      if (hash2(x + 13, z + 239) < 0.68)
        push('grass', x, z, 67, 0.7 + hash2(x + 9, z + 203) * 0.75, 1);
    }
  }
  return result;
}

function Instances({ geometry, material, plants, shadow = false, cards = false }: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  plants: Placement[];
  shadow?: boolean;
  cards?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ref.current || plants.length === 0) return;
    const tmp = new THREE.Object3D();
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i];
      tmp.position.set(p.x, p.y + (cards ? p.size * 0.5 : 0), p.z);
      tmp.rotation.set(0, p.yaw, 0);
      tmp.scale.set(cards ? p.width : p.size, p.size, cards ? p.width : p.size);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [plants, cards]);

  if (plants.length === 0) return null;
  return <instancedMesh
    ref={ref} args={[geometry, material, plants.length]}
    frustumCulled castShadow={shadow} receiveShadow={false} raycast={() => null}
  />;
}

function ForestCards({ plants, texture }: { plants: Placement[]; texture: THREE.Texture }) {
  const geo = useMemo(() => {
    const a = new THREE.PlaneGeometry(1, 1);
    const b = new THREE.PlaneGeometry(1, 1);
    b.rotateY(Math.PI / 2);
    // Two crossing vertical quads remain visible from a top-down camera.
    // Using two InstancedMeshes avoids expensive merge/clone operations.
    return [a, b];
  }, []);
  useEffect(() => () => geo.forEach(g => g.dispose()), [geo]);

  const material = useMemo(() => {
    const m = canopyMaterial();
    m.map = texture;
    m.side = THREE.DoubleSide;
    m.alphaTest = 0.42;
    m.roughness = 0.97;
    m.needsUpdate = true;
    return m;
  }, [texture]);
  useEffect(() => () => material.dispose(), [material]);

  return <group>
    <Instances geometry={geo[0]} material={material} plants={plants} cards />
    <Instances geometry={geo[1]} material={material} plants={plants} cards />
  </group>;
}

function ImportedNature({ terrain, section, highQuality }: {
  terrain: TerrainCell[][]; section: MapSection; highQuality: boolean;
}) {
  const { camera } = useThree();
  const pineObj = useLoader(OBJLoader, `${ROOT}/pine/pine.obj`);
  const shrubObj = useLoader(OBJLoader, `${ROOT}/shrub/shrub.obj`);
  const grassObj = useLoader(OBJLoader, `${ROOT}/grass/grass.obj`);
  const fernGltf = useLoader(GLTFLoader, `${ROOT}/fern_02/fern_02_1k.gltf`);

  const [pineTrunk, pineBark, pineFoliage, pineCard, broadleafCard, shrubTex, grassTex] =
    useLoader(THREE.TextureLoader, [
      `${ROOT}/pine/Textures/pine_trunk.png`,
      `${ROOT}/pine/Textures/pine_bark.png`,
      `${ROOT}/pine/Textures/pine_foliage.png`,
      `${ROOT}/pine/Textures/pine_card.png`,
      `${ROOT}/broadleaf/Textures/broadleaf_card.png`,
      `${ROOT}/shrub/Textures/shrub_foliage.png`,
      `${ROOT}/grass/Textures/grass_blades.png`,
    ]);

  const layout = useMemo(() => scatter(terrain, section), [terrain, section]);
  // Detailed 25K-triangle trees only in the camera's neighbourhood.
  const [near, setNear] = useState(false);
  const clock = useRef(0);
  useFrame((_, delta) => {
    clock.current += delta;
    if (clock.current < 0.7) return;
    clock.current = 0;
    const px = camera.position.x;
    const pz = camera.position.z - camera.position.y * 0.55 / 0.85;
    const cx = section.x + section.width / 2;
    const cz = section.y + section.height / 2;
    const d = Math.hypot(px - cx, pz - cz);
    const next = d < (highQuality ? 75 : 37) && camera.position.y < (highQuality ? 130 : 80);
    setNear(prev => prev === next ? prev : next);
  });

  const detailLimit = highQuality ? 10 : 3;
  // Keep every tree visually represented by either a card or a mesh.
  const sortedPines = useMemo(() =>
    [...layout.pine].sort((a, b) => b.rank - a.rank), [layout.pine]);
  const detail = near ? sortedPines.slice(0, detailLimit) : [];
  const pineCards = near ? sortedPines.slice(detailLimit) : sortedPines;

  const plantMaterials = useMemo(() => {
    // These OBJ exports use glTF-style top-down UVs, so disable the loader's
    // default Y flip. Billboard textures keep their usual orientation.
    [pineTrunk, pineBark, pineFoliage, shrubTex, grassTex].forEach(t => {
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    });
    [pineCard, broadleafCard].forEach(t => {
      t.flipY = true; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    });
    const foliage = canopyMaterial();
    foliage.map = pineFoliage;
    foliage.alphaTest = 0.46;
    foliage.side = THREE.DoubleSide;
    foliage.needsUpdate = true;
    return {
      pine_trunk: new THREE.MeshStandardMaterial({ map: pineTrunk, roughness: 0.95 }),
      pine_bark: new THREE.MeshStandardMaterial({ map: pineBark, roughness: 0.95 }),
      pine_foliage: foliage,
      shrub_foliage: new THREE.MeshStandardMaterial({
        map: shrubTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.98,
      }),
      grass_blades: new THREE.MeshStandardMaterial({
        map: grassTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.98,
      }),
    };
  }, [pineTrunk, pineBark, pineFoliage, pineCard, broadleafCard, shrubTex, grassTex]);
  useEffect(() => () => Object.values(plantMaterials).forEach(m => m.dispose()), [plantMaterials]);

  const objects = useMemo(() => {
    const collect = (obj: THREE.Object3D) => {
      const meshes: THREE.Mesh[] = [];
      obj.traverse(child => { if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh); });
      return meshes;
    };
    return {
      pine: collect(pineObj),
      shrub: collect(shrubObj),
      grass: collect(grassObj),
      fern: collect(fernGltf.scene),
    };
  }, [pineObj, shrubObj, grassObj, fernGltf.scene]);

  const batchOBJ = (meshes: THREE.Mesh[], plants: Placement[], prefix: string, shadows: boolean) =>
    meshes.map((mesh, i) => {
      const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mats = sources.map(m =>
        plantMaterials[m.name as keyof typeof plantMaterials] ?? plantMaterials.pine_trunk);
      return <Instances key={`${prefix}-${i}`} geometry={mesh.geometry}
        material={mats.length === 1 ? mats[0] : mats}
        plants={plants} shadow={shadows} />;
    });

  const fernLimit = highQuality ? 90 : 30;
  const shrubLimit = highQuality ? 55 : 16;
  const grassLimit = highQuality ? 200 : 70;
  const ferns = layout.fern.slice(0, fernLimit);
  const shrubs = layout.shrub.slice(0, shrubLimit);
  const grass = layout.grass.slice(0, grassLimit);

  return <group>
    {/* Crossed texture cards keep even faraway woodland continuous. */}
    <ForestCards plants={pineCards} texture={pineCard} />
    <ForestCards plants={layout.broadleaf} texture={broadleafCard} />
    {batchOBJ(objects.pine, detail, 'pine', highQuality)}
    {batchOBJ(objects.shrub, shrubs, 'shrub', false)}
    {batchOBJ(objects.grass, grass, 'grass', false)}
    {/* Poly Haven fern pack has four variants; place one variant per fern. */}
    {objects.fern.map((mesh, i) => <Instances key={`fern-${i}`}
      geometry={mesh.geometry} material={mesh.material}
      plants={ferns.filter((_, k) => k % Math.max(1, objects.fern.length) === i)} />)}
  </group>;
}

class NatureFallback extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function RealisticVegetation({ terrain, section, highQuality }: {
  terrain: TerrainCell[][]; section: MapSection; highQuality: boolean;
}) {
  const fallback = <Woodland terrain={terrain} section={section} />;
  return <NatureFallback fallback={fallback}>
    <Suspense fallback={fallback}>
      <ImportedNature terrain={terrain} section={section} highQuality={highQuality} />
    </Suspense>
  </NatureFallback>;
}
