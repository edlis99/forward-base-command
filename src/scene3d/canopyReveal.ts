import * as THREE from 'three';

/**
 * See-through canopy, Broken Arrow style: leaves within REVEAL_RADIUS cells
 * above one of your soldiers are thinned into a fine stipple so you can see
 * troops in a wood. Only tree crowns use this; trunks, ground and shadows are
 * untouched. Positions are fed every frame by <CanopyReveal/> in Scene3D.
 */
export const MAX_REVEAL = 24;
export const REVEAL_RADIUS = 2.2; // cells
export const revealUniforms = {
  revealPts: { value: Array.from({ length: MAX_REVEAL }, () => new THREE.Vector3(-999, -999, -999)) },
  revealCount: { value: 0 },
};

export function canopyMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92 });
  m.onBeforeCompile = shader => {
    shader.uniforms.revealPts = revealUniforms.revealPts;
    shader.uniforms.revealCount = revealUniforms.revealCount;
    shader.vertexShader = 'varying vec3 vRevealPos;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vRevealPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vRevealPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    shader.fragmentShader = `uniform vec3 revealPts[${MAX_REVEAL}];\nuniform int revealCount;\nvarying vec3 vRevealPos;\n` +
      shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      for (int i = 0; i < ${MAX_REVEAL}; i++) {
        if (i >= revealCount) break;
        vec2 d = vRevealPos.xz - revealPts[i].xz;
        if (dot(d, d) < ${(REVEAL_RADIUS * REVEAL_RADIUS).toFixed(2)} && vRevealPos.y > revealPts[i].y + 0.35) {
          float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (n < 0.82) discard;
        }
      }`);
  };
  m.customProgramCacheKey = () => 'canopy-reveal-v1';
  return m;
}
