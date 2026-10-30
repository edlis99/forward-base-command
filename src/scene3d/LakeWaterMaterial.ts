import { useEffect, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { ambienceUniforms } from './ambienceUniforms';

// Two genuinely seamless local normal maps; the wind direction and scales
// deliberately differ to avoid obvious repeating tiles across wide lakes.
export const LAKE_NORMAL_URLS = [
  `${import.meta.env.BASE_URL}assets/water/lake_ripples_a.png`,
  `${import.meta.env.BASE_URL}assets/water/lake_ripples_b.png`,
];

export function useLakeWaterMaterial(): THREE.MeshPhysicalMaterial {
  const maps = useLoader(THREE.TextureLoader, LAKE_NORMAL_URLS);
  const material = useMemo(() => {
    maps.forEach(texture => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 8;
      // Normal maps are data; sRGB conversion would distort their normals.
      texture.colorSpace = THREE.NoColorSpace;
      texture.needsUpdate = true;
    });

    const water = new THREE.MeshPhysicalMaterial({
      color: '#486b65',
      roughness: 0.21,
      metalness: 0,
      clearcoat: 0.92,
      clearcoatRoughness: 0.095,
      transparent: true,
      opacity: 0.91,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    water.name = 'Dzūkija calm freshwater – animated PBR ripples';
    water.onBeforeCompile = shader => {
      shader.uniforms.lakeNormalA = { value: maps[0] };
      shader.uniforms.lakeNormalB = { value: maps[1] };
      shader.uniforms.lakeTime = ambienceUniforms.uTime;
      shader.vertexShader = `
        attribute float lakeShore;
        varying vec2 vLakeWorld;
        varying float vLakeShore;
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLakeWorld = position.xz;
        vLakeShore = lakeShore;`,
      );
      shader.fragmentShader = `
        uniform sampler2D lakeNormalA;
        uniform sampler2D lakeNormalB;
        uniform float lakeTime;
        varying vec2 vLakeWorld;
        varying float vLakeShore;
      ` + shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Two slow, differently oriented ripples: fine wind ripples above
        // broad lake undulation, with stable world-space UVs across sections.
        vec2 uvA = vLakeWorld * 0.66 + lakeTime * vec2(0.008, -0.004);
        vec2 uvB = vLakeWorld * 1.37 + lakeTime * vec2(-0.005, 0.009);
        vec3 nA = texture2D(lakeNormalA, uvA).xyz * 2.0 - 1.0;
        vec3 nB = texture2D(lakeNormalB, uvB).xyz * 2.0 - 1.0;
        vec2 slope = (nA.xy * 0.62 + nB.xy * 0.38) * 0.31;
        normal = normalize(normal + mat3(viewMatrix) * vec3(slope.x, 0.0, slope.y));
        vec3 viewToEye = normalize(vViewPosition);
        float facing = clamp(dot(normal, viewToEye), 0.0, 1.0);
        float fresnel = pow(1.0 - facing, 3.3);
        // Cool sky reflection above muted green-blue inland freshwater.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.49, 0.60, 0.64), fresnel * 0.66);
        // Shallower water close to reeds/sandy banks reads slightly lighter.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.37, 0.49, 0.40), vLakeShore * 0.24);
        // A subtle fine sparkle, not bright white ocean foam.
        vec3 sun = normalize(mat3(viewMatrix) * vec3(0.68, 0.66, 0.34));
        float glint = pow(max(0.0, dot(reflect(-viewToEye, normal), sun)), 84.0);
        diffuseColor.rgb += vec3(0.55, 0.59, 0.50) * glint * 0.12;`,
      );
    };
    water.customProgramCacheKey = () => 'inland-lake-water-v1';
    return water;
  }, [maps]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}
