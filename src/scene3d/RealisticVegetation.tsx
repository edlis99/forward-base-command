import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { TerrainCell } from '../game/types';
import type { MapSection } from './mapSections';
import { groundHeightAt, hash2 } from './terrainHeight';

/**
 * Actual imported CC0 models, rendered in a small number of instanced batches
 * per visible map section. The tactical forest grid remains the authority for
 * movement, collision, cover and line of sight: these models are visuals only.
 *
 * Pine Tree 01: https://polyhaven.com/a/pine_tree_01
 * Fern 02: https://polyhaven.com/a/fern_02
 *
 * The pine's foliage atlas is currently a fallback pine-card texture. Restore
 * the full pine_foliage.png for best quality (see public/assets/nature/README.md).
 */
const ROOT = '/assets/nature';
interface Placement {
  x: number; y: number; z: number;
  scale: number; yaw: number; rank: number;
}

function placements(terrain: TerrainCell[][], section: MapSection, highQuality: boolean) {
  const pine: Placement[] = [];
  const fern: Placement[] = [];
  const maxX = section.x + section.width;
  const maxZ = section.y + section.height;

  for (let z = section.y; z < maxZ; z++) {
    for (let x = section.x; x < maxX; x++) {
      if (terrain[z][x].type !== 'forest') continue;
      const atEdge =
        terrain[z - 1]?.[x]?.type !== 'forest' ||
        terrain[z + 1]?.[x]?.type !== 'forest' ||
        terrain[z]?.[x - 1]?.type !== 'forest' ||
        terrain[z]?.[x + 1]?.type !== 'forest';

      // Prefer trees at woodland margins, where they will be visible from
      // roads and settlements; stable hashes avoid flicker on section remounts.
      const pChance = hash2(x + 573, z + 129);
      if (pChance < (atEdge ? 0.15 : 0.045)) {
        const px = x + 0.2 + hash2(x + 23, z + 37) * 0.6;
        const pz = z + 0.2 + hash2(x + 61, z + 17) * 0.6;
        pine.push({
          x: px, z: pz, y: groundHeightAt(terrain, px, pz),
          scale: 3.0 + hash2(x + 51, z + 87) * 1.7,
          yaw: hash2(x + 109, z + 211) * Math.PI * 2,
          rank: hash2(x + 79, z + 83),
        });
      }

      const fChance = hash2(x + 347, z + 531);
      if (fChance < (atEdge ? 0.29 : 0.10)) {
        const px = x + 0.16 + hash2(x + 43, z + 71) * 0.68;
        const pz = z + 0.16 + hash2(x + 19, z + 53) * 0.68;
        fern.push({
          x: px, z: pz, y: groundHeightAt(terrain, px, pz) + 0.008,
          scale: 0.9 + hash2(x + 67, z + 19) * 0.9,
          yaw: hash2(x + 47, z + 157) * Math.PI * 2,
          rank: hash2(x + 89, z + 97),
        });
      }
    }
  }
  // Bounded per-section GPU costs, even in the thickest forests.
  pine.sort((a, b) => b.rank - a.rank);
  fern.sort((a, b) => b.rank - a.rank);
  return {
    pine: pine.slice(0, highQuality ? 8 : 3),
    fern: fern.slice(0, highQuality ? 44 : 16),
  };
}

function InstancedNaturePart({
  geometry, material, positions, shadow = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  positions: Placement[];
  shadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [positions]);

  if (!positions.length) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, positions.length]}
      castShadow={shadow}
      receiveShadow={false}
      raycast={() => null}
    />
  );
}

function LoadedNature({ terrain, section, highQuality }: {
  terrain: TerrainCell[][];
  section: MapSection;
  highQuality: boolean;
}) {
  const model = useLoader(OBJLoader, `${ROOT}/pine/pine.obj`);
  const ferns = useLoader(GLTFLoader, `${ROOT}/fern_02/fern_02_1k.gltf`);
  const [trunkMap, barkMap, foliageMap] = useLoader(THREE.TextureLoader, [
    `${ROOT}/pine/Textures/pine_trunk.png`,
    `${ROOT}/pine/Textures/pine_bark.png`,
    `${ROOT}/pine/Textures/pine_foliage.png`,
  ]);

  const locations = useMemo(() => placements(terrain, section, highQuality), [terrain, section, highQuality]);

  const pineMaterials = useMemo(() => {
    // Source OBJ UVs are glTF-style (top-down), not Blender OBJ-style.
    for (const tex of [trunkMap, barkMap, foliageMap]) {
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
    return {
      pine_trunk: new THREE.MeshStandardMaterial({ map: trunkMap, roughness: 0.95 }),
      pine_bark: new THREE.MeshStandardMaterial({ map: barkMap, roughness: 0.97 }),
      pine_foliage: new THREE.MeshStandardMaterial({
        map: foliageMap, alphaTest: 0.48, side: THREE.DoubleSide,
        depthWrite: true, roughness: 0.96,
      }),
    };
  }, [trunkMap, barkMap, foliageMap]);

  useEffect(() => () => Object.values(pineMaterials).forEach(mat => mat.dispose()), [pineMaterials]);

  const pineMeshes = useMemo(() => {
    const result: THREE.Mesh[] = [];
    model.traverse(child => {
      if ((child as THREE.Mesh).isMesh) result.push(child as THREE.Mesh);
    });
    return result;
  }, [model]);

  const fernMeshes = useMemo(() => {
    const result: THREE.Mesh[] = [];
    ferns.scene.traverse(child => {
      if ((child as THREE.Mesh).isMesh) result.push(child as THREE.Mesh);
    });
    return result;
  }, [ferns.scene]);

  const materialFor = (source: THREE.Material) =>
    pineMaterials[source.name as keyof typeof pineMaterials] ?? pineMaterials.pine_trunk;

  return (
    <group>
      {pineMeshes.map((mesh, i) => {
        const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const materials = original.map(materialFor);
        return <InstancedNaturePart key={`pine-${i}`} geometry={mesh.geometry}
          material={materials.length === 1 ? materials[0] : materials}
          positions={locations.pine} shadow />;
      })}
      {/* The glTF contains four separate natural fern variants. Use one variant
          per plant rather than duplicating its four authored scene positions. */}
      {fernMeshes.map((mesh, i) =>
        <InstancedNaturePart key={`fern-${i}`} geometry={mesh.geometry}
          material={mesh.material}
          positions={locations.fern.filter((_, k) => k % fernMeshes.length === i)} />
      )}
    </group>
  );
}

export function RealisticVegetation({ terrain, section, highQuality }: {
  terrain: TerrainCell[][];
  section: MapSection;
  highQuality: boolean;
}) {
  return (
    <Suspense fallback={null}>
      <LoadedNature terrain={terrain} section={section} highQuality={highQuality} />
    </Suspense>
  );
}
