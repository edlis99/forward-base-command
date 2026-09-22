import * as THREE from 'three';
import { MapSection } from './mapSections';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { paintRoadNetwork, roadJunctions } from '../game/maps/roadSurface';

// Gutters use global road coordinates, so filtering cannot reveal seams at
// section borders. Junction paint is computed once for the whole network.
const junctions = roadJunctions(LEIPALINGIS_ROADS.filter(r => r.class !== 'track'));
const roadBounds = LEIPALINGIS_ROADS.map(road => ({ road,
  minX: Math.min(...road.points.map(p => p[0])) - 2, maxX: Math.max(...road.points.map(p => p[0])) + 2,
  minY: Math.min(...road.points.map(p => p[1])) - 2, maxY: Math.max(...road.points.map(p => p[1])) + 2,
}));
export const ROAD_GUTTER = 2;
export function createRoadTexture(section: MapSection) {
  const canvas = document.createElement('canvas');
  const samples = 16;
  canvas.width = (section.width + ROAD_GUTTER * 2) * samples; canvas.height = (section.height + ROAD_GUTTER * 2) * samples;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(samples, samples);
  ctx.translate(ROAD_GUTTER - section.x, ROAD_GUTTER - section.y);
  const roads = roadBounds.filter(b => b.maxX >= section.x - ROAD_GUTTER && b.minX <= section.x + section.width + ROAD_GUTTER
    && b.maxY >= section.y - ROAD_GUTTER && b.minY <= section.y + section.height + ROAD_GUTTER).map(b => b.road);
  paintRoadNetwork(ctx, roads, true, junctions);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4;
  return texture;
}

export function landscapeMaterial(grain: THREE.Texture, roads: THREE.Texture | undefined, section: MapSection) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain, bumpScale: .008, roughness: .97 });
  if (roads) {
    material.onBeforeCompile = shader => {
      shader.uniforms.campaignRoads = { value: roads };
      shader.uniforms.roadBounds = { value: new THREE.Vector4(section.x - ROAD_GUTTER, section.y - ROAD_GUTTER,
        section.width + ROAD_GUTTER * 2, section.height + ROAD_GUTTER * 2) };
      shader.vertexShader = 'uniform vec4 roadBounds;\nvarying vec2 campaignUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ncampaignUv = vec2((position.x - roadBounds.x) / roadBounds.z, 1.0 - (position.z - roadBounds.y) / roadBounds.w);`);
      shader.fragmentShader = 'uniform sampler2D campaignRoads;\nvarying vec2 campaignUv;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec4 paving = texture2D(campaignRoads, campaignUv);
        vec3 roadColor = pow(paving.rgb, vec3(2.2));
        diffuseColor.rgb = mix(diffuseColor.rgb, roadColor * (0.94 + 0.06 * texture2D(map, vMapUv).r), paving.a);
      `);
    };
    material.customProgramCacheKey = () => 'campaign-road-sections-v2';
  }
  return material;
}
