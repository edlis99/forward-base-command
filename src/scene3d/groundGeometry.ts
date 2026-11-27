import * as THREE from 'three';
import { TerrainCell, TerrainType } from '../game/types';
import { MAP_COLS, MAP_ROWS } from '../game/constants';
import { MapSection } from './mapSections';
import { SURFACES, surfaceFor } from './groundTextures';
import { groundHeightAt, hash2, fbm, shoreWetness, wetGroundShare } from './terrainHeight';

const W = MAP_COLS;
const H = MAP_ROWS;

/** Subdivisions per terrain cell edge. Higher = smoother blends, more verts. */
const SUB = 2;

/**
 * Ground tint per terrain type. This is the colour of the *soil surface* under
 * each cell, not the colour of the object standing on it — so a wall or a house
 * contributes trampled dirt, and forest contributes leaf litter.
 */
const GROUND_TINT: Record<TerrainType | string, string> = {
  open: '#85905d',
  tall_grass: '#93a566',
  forest: '#556445',
  hedgerow: '#74874f',
  road: '#727b72',
  gravel: '#b0a68e',
  urban: '#968b78',
  wall: '#928778',
  rubble: '#a49c90',
  sandbag: '#b6a67e',
  mud: '#7a6647',
  crater: '#6f5c40',
  trench: '#94794f',
  water: '#365f7a',
};

// Height tables and noise live in terrainHeight.ts — the single source of
// truth shared with every layer that sits on the ground. Do not re-declare
// them here or the mesh and the sampler will drift apart.


/** Build terrain geometry and matching material weights in world coordinates. */
export function buildGroundGeometry(terrain: TerrainCell[][], section: MapSection, regional = false) {
  const nx = section.width * SUB + 1;
  const nz = section.height * SUB + 1;
  const vertCount = nx * nz;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const splatA = new Float32Array(vertCount * 3);
  const splatB = new Float32Array(vertCount * 3);

  const cellAt = (cx: number, cy: number): TerrainCell => {
    const row = terrain[Math.max(0, Math.min(H - 1, cy))];
    return row[Math.max(0, Math.min(W - 1, cx))];
  };

  const col = new THREE.Color();
  const tmp = new THREE.Color();
  const bank = new THREE.Color('#7b6c4c');

  // The nearest land (or water) cell to a point: the soil a bank over former water takes, or the bed of a
  // water share found where none of a point's own four cells is water.
  const isWet = (c: TerrainCell | undefined) => !!c && (c.type === 'water' || !!c.bridge);
  const nearestCell = (gx: number, gz: number, wet: boolean): TerrainCell => {
    const cx = Math.floor(gx), cz = Math.floor(gz);
    let best = cellAt(cx, cz), bestD = Infinity;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const c = terrain[cz + dz]?.[cx + dx];
      if (!c || isWet(c) !== wet) continue;
      const d = Math.hypot(cx + dx + .5 - gx, cz + dz + .5 - gz);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const gx = section.x + i / SUB;
      const gz = section.y + j / SUB;
      // Bilinear weights over the 4 nearest cell centres.
      const u = gx - 0.5, v = gz - 0.5;
      const ix = Math.floor(u), iz = Math.floor(v);
      const fx = u - ix, fz = v - iz;
      const wts: Array<[TerrainCell, number]> = [
        [cellAt(ix, iz), (1 - fx) * (1 - fz)],
        [cellAt(ix + 1, iz), fx * (1 - fz)],
        [cellAt(ix, iz + 1), (1 - fx) * fz],
        [cellAt(ix + 1, iz + 1), fx * fz],
      ];

      const o = (j * nx + i) * 3;
      let r = 0, g = 0, b = 0;
      // The soil is the land's, mixing into the river bed's by the shore's smooth share (the same one
      // that lowers the ground), so the colours follow the curve of the water's edge, not the cells.
      const bed = wetGroundShare(terrain, gx, gz);
      let landW = 0, bedW = 0, roadShare = 0;
      const landCells: Array<[TerrainCell, number]> = [], bedCells: Array<[TerrainCell, number]> = [];
      for (const [c, w] of wts) {
        if (w <= 0) continue;
        if (isWet(c)) { bedW += w; bedCells.push([c, w]); }
        else { landW += w; landCells.push([c, w]); if (c.roadName) roadShare += w; }
      }
      // The soil turns to the bed's (dark, damp dirt) faster than the ground falls: a shallow bed under clear water
      // would otherwise read as a flooded meadow.
      const soil = Math.min(1, bed * 2.4);
      const normalised = (cells: Array<[TerrainCell, number]>, total: number) => cells.map(([c, w]) => [c, w / total] as [TerrainCell, number]);
      // Away from water the cells' own blend; at a shore each side renormalised, then mixed (a side with
      // no cell of its own among the four takes the nearest one's soil).
      const groups: Array<[Array<[TerrainCell, number]>, number]> = bed <= 0 && bedW <= 0 ? [[landCells, 1]] : [
        [landW > 1e-6 ? normalised(landCells, landW) : [[nearestCell(gx, gz, false), 1]], 1 - soil],
        [bedW > 1e-6 ? normalised(bedCells, bedW) : [[nearestCell(gx, gz, true), 1]], soil],
      ];
      for (const [cells, share] of groups) {
        if (share <= 0) continue;
        for (const [c, w0] of cells) {
          const w = w0 * share;
          const surface = SURFACES.indexOf(surfaceFor(c, regional));
          if (surface < 3) splatA[o + surface] += w;
          else splatB[o + surface - 3] += w;
          tmp.setStyle(c.yard ? ({ courtyard: '#aaa28a', garden: '#7d8d54', orchard: '#72854b' }[c.yard]) : GROUND_TINT[regional && c.roadName ? 'open' : c.type] ?? '#5c7042');
          r += tmp.r * w; g += tmp.g * w; b += tmp.b * w;
        }
      }

      // Banks: damp, muddy-sandy ground on land within a cell or two of the water (roads excluded),
      // fading out smoothly with the distance from the shore: shift the texture blend towards wet
      // dirt and tint it damp.
      const band = shoreWetness(terrain, gx, gz, .9), shore = Math.max(0, Math.min(1, (band - .03) / .4)) * (1 - roadShare);
      const wet = shore * shore * (3 - 2 * shore) * (.72 + .28 * fbm(gx * .4 + 3, gz * .4 + 9));
      if (wet > .01) {
        for (let k = 0; k < 3; k++) { splatA[o + k] *= 1 - wet * .55; splatB[o + k] *= 1 - wet * .55; }
        splatB[o] += wet * .55;
        tmp.setRGB(r, g, b).lerp(bank, wet * .45); r = tmp.r; g = tmp.g; b = tmp.b;
      }

      const height = groundHeightAt(terrain, gx, gz);

      positions[o] = gx;
      uvs[(j * nx + i) * 2] = gx;
      uvs[(j * nx + i) * 2 + 1] = gz;
      positions[o + 1] = height;
      positions[o + 2] = gz;

      // Colour variation: broad patchiness only, biased bright so no cell
      // darkens into a black blotch.
      const patch = 0.95 + fbm(gx * 0.07, gz * 0.07) * 0.16;
      const speckle = 0.98 + hash2(gx * SUB, gz * SUB) * 0.05;
      const dry = fbm(gx * 0.05 + 11, gz * 0.05 + 7);
      // Wet ground is darker: the damp bank, and more so the bed under the water.
      col.setRGB(r, g, b).multiplyScalar(patch * speckle * (1 - .3 * bed - .1 * wet));
      // Sun-bleached patches lean ochre, damp hollows lean cool green.
      col.r *= 1 + (dry - 0.5) * 0.1;
      col.b *= 1 - (dry - 0.5) * 0.08;
      colors[o] = Math.min(1, col.r); colors[o + 1] = Math.min(1, col.g); colors[o + 2] = Math.min(1, col.b);

    }
  }

  const indices: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, bb = a + 1, c = a + nx, d = c + 1;
      // Alternate diagonal per quad so triangulation isn't visually regular.
      if ((i + j) % 2 === 0) { indices.push(a, c, bb, bb, c, d); }
      else { indices.push(a, c, d, a, d, bb); }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('splatA', new THREE.BufferAttribute(splatA, 3));
  geo.setAttribute('splatB', new THREE.BufferAttribute(splatB, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
