import * as THREE from 'three';
import { hash2 } from './terrainHeight';

/** Grained material without downloads: world-scaled, repeatable and crisp close up. */
export function makeGrainTexture(repeat = 1) {
  const data = new Uint8Array(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 200 + Math.floor(hash2(i % 128, Math.floor(i / 128)) * 55);
    data.set([v, v, v, 255], i * 4);
  }
  const tex = new THREE.DataTexture(data, 128, 128, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat); tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true; return tex;
}

