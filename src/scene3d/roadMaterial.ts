import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { LEIPALINGIS_ROADS } from '../game/maps/leipalingis';
import { paintRoadNetwork, roadJunctions } from '../game/maps/roadSurface';
import { groundTex, SURFACES, TILE_CELLS } from './groundTextures';
import { ambienceUniforms } from './ambienceUniforms';

// Gutters use global road coordinates, so filtering cannot reveal seams at
// section borders. Junction paint is computed once for the whole network.
const junctions = roadJunctions(LEIPALINGIS_ROADS.filter(r => r.class !== 'track'));
const roadBounds = LEIPALINGIS_ROADS.map(road => ({ road,
  minX: Math.min(...road.points.map(p => p[0])) - 2, maxX: Math.max(...road.points.map(p => p[0])) + 2,
  minY: Math.min(...road.points.map(p => p[1])) - 2, maxY: Math.max(...road.points.map(p => p[1])) + 2,
}));
export const ROAD_GUTTER = 2;

interface Driveway { from: [number, number]; to: [number, number]; paved: boolean }

/** Road centre-line segments bucketed on a coarse grid, for nearest-street lookups. */
const BUCKET = 4;
const segmentBuckets = (() => {
  const buckets = new Map<string, { a: number[]; b: number[]; road: typeof LEIPALINGIS_ROADS[number] }[]>();
  for (const road of LEIPALINGIS_ROADS) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i];
    for (let y = Math.floor(Math.min(a[1], b[1]) / BUCKET); y <= Math.floor(Math.max(a[1], b[1]) / BUCKET); y++)
      for (let x = Math.floor(Math.min(a[0], b[0]) / BUCKET); x <= Math.floor(Math.max(a[0], b[0]) / BUCKET); x++) {
        const key = `${x},${y}`, list = buckets.get(key) ?? [];
        list.push({ a, b, road }); buckets.set(key, list);
      }
  }
  return buckets;
})();

/** Nearest point on any road's centre line within `range` cells. */
function nearestStreet(px: number, pz: number, range: number) {
  let best: { x: number; z: number; d: number; width: number } | null = null;
  for (let y = Math.floor((pz - range) / BUCKET); y <= Math.floor((pz + range) / BUCKET); y++)
    for (let x = Math.floor((px - range) / BUCKET); x <= Math.floor((px + range) / BUCKET); x++) {
      for (const { a, b, road } of segmentBuckets.get(`${x},${y}`) ?? []) {
        const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / l2));
        const qx = a[0] + vx * t, qz = a[1] + vz * t, d = Math.hypot(qx - px, qz - pz);
        if (d <= range && (!best || d < best.d)) best = { x: qx, z: qz, d, width: road.width };
      }
    }
  return best;
}

const drivewayCache = new WeakMap<TerrainCell[][], Driveway[]>();
/**
 * Driveways: each village and town house that faces a street gets a short
 * drive from its front door straight to that street, ending at the road's
 * edge. A house that does not face a street (it stands at an angle to it, or
 * the nearest street is beside or behind it) gets none: those drives used to
 * run sideways into the fields. Visual only; cells keep their gameplay type.
 * The front is local +z of the building, i.e. (-sin a, cos a) for its propAngle.
 */
function allDriveways(terrain: TerrainCell[][]) {
  let drives = drivewayCache.get(terrain);
  if (drives) return drives;
  drives = [];
  for (let y = 0; y < terrain.length; y++) for (let x = 0; x < terrain[0].length; x++) {
    const c = terrain[y][x];
    if (c.type !== 'urban' || !c.settlementId || c.buildingKind === 'barn' || c.buildingKind === 'church') continue;
    const a = c.propAngle ?? 0, fx = -Math.sin(a), fz = Math.cos(a);
    const sx = x + .5 + (c.buildingOffset?.[0] ?? 0) + fx * .2, sz = y + .5 + (c.buildingOffset?.[1] ?? 0) + fz * .2;
    const street = nearestStreet(sx, sz, 2.4);
    if (!street) continue;
    const reach = street.d - street.width / 2;
    if (reach < .12) continue;
    const ux = (street.x - sx) / street.d, uz = (street.z - sz) / street.d;
    // The street must be in front of the door, not beside or behind the house.
    if (ux * fx + uz * fz < .72) continue;
    const ex = sx + ux * (reach + .04), ez = sz + uz * (reach + .04);
    // Never through or onto another building, nor across water.
    let clear = true;
    const steps = Math.max(1, Math.ceil((reach + .04) / .15));
    for (let k = 1; k <= steps && clear; k++) {
      const t = Math.min(reach + .04, k * .15), n = terrain[Math.floor(sz + uz * t)]?.[Math.floor(sx + ux * t)];
      // Its own cell only on the way out: a road edge inside the house's own cell needs no drive.
      if (!n || n.type === 'water' || (n.type === 'urban' && (n !== c || k === steps))) clear = false;
    }
    if (clear) drives.push({ from: [sx, sz], to: [ex, ez], paved: c.buildingKind === 'brick' || c.buildingKind === 'block' });
  }
  drivewayCache.set(terrain, drives);
  return drives;
}

/** Driveways whose house front lies in the given cell rectangle. */
export function drivewaysIn(terrain: TerrainCell[][], x0: number, y0: number, x1: number, y1: number) {
  return allDriveways(terrain).filter(d => d.from[0] >= x0 && d.from[0] < x1 && d.from[1] >= y0 && d.from[1] < y1);
}

export function createRoadTexture(section: MapSection, terrain?: TerrainCell[][]) {
  const canvas = document.createElement('canvas');
  const samples = 16;
  canvas.width = (section.width + ROAD_GUTTER * 2) * samples; canvas.height = (section.height + ROAD_GUTTER * 2) * samples;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(samples, samples);
  ctx.translate(ROAD_GUTTER - section.x, ROAD_GUTTER - section.y);
  const roads = roadBounds.filter(b => b.maxX >= section.x - ROAD_GUTTER && b.minX <= section.x + section.width + ROAD_GUTTER
    && b.maxY >= section.y - ROAD_GUTTER && b.minY <= section.y + section.height + ROAD_GUTTER).map(b => b.road);
  if (terrain) {
    // Driveways first, so the street paints over their ends.
    ctx.save(); ctx.lineCap = 'round';
    for (const d of drivewaysIn(terrain, section.x - ROAD_GUTTER, section.y - ROAD_GUTTER,
      section.x + section.width + ROAD_GUTTER, section.y + section.height + ROAD_GUTTER)) {
      ctx.beginPath(); ctx.moveTo(...d.from); ctx.lineTo(...d.to);
      ctx.strokeStyle = d.paved ? '#5d625f' : '#b3a98c'; ctx.lineWidth = d.paved ? .2 : .18; ctx.stroke();
    }
    ctx.restore();
  }
  paintRoadNetwork(ctx, roads, true, junctions);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4;
  return texture;
}

/**
 * Splat-blended Poly Haven landscape. Six diffuse maps are mixed per vertex
 * via splatA/splatB weights; normal/roughness come from a shared set, tiled
 * in world space so every map section lines up seamlessly.
 */
export function landscapeMaterial(_grain: THREE.Texture, roads: THREE.Texture | undefined, section: MapSection) {
  const normal = groundTex('grass', 'normal');
  const rough = groundTex('dirt', 'roughness');
  normal.repeat.set(1 / TILE_CELLS, 1 / TILE_CELLS);
  rough.repeat.set(1 / TILE_CELLS, 1 / TILE_CELLS);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, normalMap: normal, normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: rough, roughness: 1, metalness: 0,
  });
  material.name = 'Poly Haven terrain';
  const diffuse = SURFACES.map(s => groundTex(s, 'diffuse'));
  material.onBeforeCompile = shader => {
    SURFACES.forEach((_, i) => { shader.uniforms[`gDiff${i}`] = { value: diffuse[i] }; });
    shader.uniforms.gTile = { value: 1 / TILE_CELLS };
    shader.uniforms.asphaltTex = { value: diffuse[5] };
    shader.uniforms.uTime = ambienceUniforms.uTime;
    shader.vertexShader = 'attribute vec3 splatA;\nattribute vec3 splatB;\nuniform float gTile;\nvarying vec3 vSplatA;\nvarying vec3 vSplatB;\nvarying vec2 gUv;\n' + shader.vertexShader;
    let begin = '#include <begin_vertex>\nvSplatA = splatA; vSplatB = splatB; gUv = position.xz * gTile;';
    if (roads) {
      shader.uniforms.campaignRoads = { value: roads };
      shader.uniforms.roadBounds = { value: new THREE.Vector4(section.x - ROAD_GUTTER, section.y - ROAD_GUTTER,
        section.width + ROAD_GUTTER * 2, section.height + ROAD_GUTTER * 2) };
      shader.vertexShader = 'uniform vec4 roadBounds;\nvarying vec2 campaignUv;\n' + shader.vertexShader;
      begin += '\ncampaignUv = vec2((position.x - roadBounds.x) / roadBounds.z, 1.0 - (position.z - roadBounds.y) / roadBounds.w);';
    }
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', begin);
    shader.fragmentShader = SURFACES.map((_, i) => `uniform sampler2D gDiff${i};`).join('\n')
      + '\nvarying vec3 vSplatA;\nvarying vec3 vSplatB;\nvarying vec2 gUv;\nuniform float uTime;\nuniform float gTile;\n'
      + 'float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n'
      + 'float cNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);\n'
      + '  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y); }\n'
      + (roads ? 'uniform sampler2D campaignRoads;\nvarying vec2 campaignUv;\n' : '')
      + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      // Second, rotated sample breaks up visible tile repetition.
      vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * gUv * 0.37 + 0.31;
      #define GS(t) (texture2D(t, gUv).rgb * 0.65 + texture2D(t, uvB).rgb * 0.35)
      // The installed grass texture is dry, yellow-brown grass; tint it to
      // Lithuanian summer green (crops golden-green, forest floor a touch greener).
      vec3 tex = GS(gDiff0) * vec3(0.74, 1.02, 0.60) * vSplatA.x + GS(gDiff1) * vec3(0.92, 1.0, 0.72) * vSplatA.y + GS(gDiff2) * vec3(0.86, 0.98, 0.78) * vSplatA.z
               + GS(gDiff3) * vSplatB.x + GS(gDiff4) * vSplatB.y + GS(gDiff5) * vSplatB.z;
      float wsum = dot(vSplatA, vec3(1.0)) + dot(vSplatB, vec3(1.0));
      tex = wsum > 0.001 ? tex / wsum : GS(gDiff0);
      // Vertex colours keep the old patchiness as a gentle brightness/tint shift.
      float lum = dot(vColor.rgb, vec3(0.333));
      vec3 tint = mix(vec3(1.0), vColor.rgb / max(lum, 0.02), 0.25);
      diffuseColor.rgb = tex * tint * clamp(0.75 + lum * 1.3, 0.85, 1.3);
      ${roads ? `
      vec4 paving = texture2D(campaignRoads, campaignUv);
      vec3 roadColor = pow(paving.rgb, vec3(2.2));
      vec3 asph = texture2D(gDiff5, gUv * 1.6).rgb;
      float detail = dot(asph, vec3(0.333)) / 0.18;
      diffuseColor.rgb = mix(diffuseColor.rgb, roadColor * clamp(detail, 0.7, 1.35), paving.a);` : ''}
      // Drifting cloud shadows: big soft patches sliding slowly across the land.
      vec2 cw = gUv / gTile;
      float cloud = cNoise(cw * 0.012 + vec2(uTime * 0.006, uTime * 0.0025)) * 0.65 + cNoise(cw * 0.031 + vec2(uTime * 0.01, 0.0)) * 0.35;
      diffuseColor.rgb *= 1.0 - smoothstep(0.52, 0.74, cloud) * 0.26;
    `);
  };
  material.customProgramCacheKey = () => `polyhaven-landscape-v4-${roads ? 'r' : 'n'}`;
  return material;
}
