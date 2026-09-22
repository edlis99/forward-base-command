import * as THREE from 'three';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { paintRoadNetwork } from '../game/maps/roadSurface';

export function createRoadTexture() {
  const canvas = document.createElement('canvas');
  const samples = 16;
  canvas.width = MAP_COLS * samples; canvas.height = MAP_ROWS * samples;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(samples, samples);
  paintRoadNetwork(ctx, LEIPALINGIS_ROADS, true);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4;
  return texture;
}

export function landscapeMaterial(grain: THREE.Texture, roads?: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain, bumpScale: .008, roughness: .97 });
  if (roads) {
    material.onBeforeCompile = shader => {
      shader.uniforms.campaignRoads = { value: roads };
      shader.vertexShader = 'varying vec2 campaignUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ncampaignUv = vec2(position.x / ${MAP_COLS}.0, 1.0 - position.z / ${MAP_ROWS}.0);`);
      shader.fragmentShader = 'uniform sampler2D campaignRoads;\nvarying vec2 campaignUv;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec4 paving = texture2D(campaignRoads, campaignUv);
        vec3 roadColor = pow(paving.rgb, vec3(2.2));
        diffuseColor.rgb = mix(diffuseColor.rgb, roadColor * (0.94 + 0.06 * texture2D(map, vMapUv).r), paving.a);
      `);
    };
    material.customProgramCacheKey = () => 'campaign-road-union-v1';
  }
  return material;
}
