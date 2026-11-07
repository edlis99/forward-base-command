import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateTerrain } from '../game/terrain';
import { COVER_RES, grassMask, grassOf, meshHeight, softGround, TrampleMap } from '../scene3d/groundCover';
import { buildGroundGeometry } from '../scene3d/groundGeometry';
import { MAP_SECTIONS } from '../scene3d/mapSections';

const terrain = generateTerrain('leipalingis_region', 1917);
const cells = terrain.flat();
/** A cell of the playable map (the border is out of bounds) that passes `test`. */
const find = (test: (c: (typeof cells)[number]) => boolean) => cells.find(c => !c.blocksMovement && test(c)) ?? cells.find(test)!;

describe('grass and the tracks in it', () => {
  it('grows grass on pasture and meadow, none on roads, yards, woods, water or bridges', () => {
    const pasture = find(c => c.type === 'open' && !c.yard && !c.prop && !c.roadName);
    const meadow = find(c => c.type === 'tall_grass' && !c.prop);
    expect(grassOf(pasture)).toEqual({ cover: 1, tall: .12 });
    expect(grassOf(meadow)).toEqual({ cover: 1, tall: 1 });
    for (const c of [find(c => c.type === 'road'), find(c => c.type === 'forest'), find(c => c.type === 'water'), find(c => !!c.bridge), find(c => c.type === 'urban')])
      expect(grassOf(c).cover).toBe(0);
    // A field's stone wall, boulder, hay or logs stand in the grass: no bare square under each.
    expect(grassOf(find(c => !!c.prop && c.type === 'sandbag'))).toEqual({ cover: 1, tall: .12 });
    // The map-wide texture follows the cells (four texels a cell).
    const mask = grassMask(terrain), data = mask.image.data as Uint8Array, width = mask.image.width;
    const texel = (c: (typeof cells)[number]) => (Math.floor(c.y / 32) * COVER_RES + 2) * width + Math.floor(c.x / 32) * COVER_RES + 2;
    expect(data[texel(meadow) * 2]).toBeGreaterThan(200);
    expect(data[texel(meadow) * 2 + 1]).toBeGreaterThan(200);
    expect(data[texel(find(c => c.type === 'water' && !c.bridge)) * 2]).toBe(0);
  });
  it('knows the ground exactly as it is drawn, triangle by triangle (rings, grass and tracks sit on it)', () => {
    // A steep river bank by the start, where the corners' blend was 0.04 cell under the drawn ground.
    const section = MAP_SECTIONS.find(s => s.x <= 28 && 28 < s.x + s.width && s.y <= 110 && 110 < s.y + s.height)!;
    const mesh = new THREE.Mesh(buildGroundGeometry(terrain, section, true), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster();
    let worst = 0;
    for (let k = 0; k < 100; k++) {
      const x = 27.013 + (k % 10) * .2, z = 109.507 + Math.floor(k / 10) * .2;
      ray.set(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0));
      worst = Math.max(worst, Math.abs(ray.intersectObject(mesh)[0].point.y - meshHeight(terrain, x, z)));
    }
    expect(worst).toBeLessThan(1e-5);
  });
  it('takes tracks on soft ground only: not on a road or a bridge deck', () => {
    expect(softGround(find(c => c.type === 'tall_grass'))).toBe(true);
    expect(softGround(find(c => c.type === 'open' && !c.roadName && !c.prop))).toBe(true);
    expect(softGround(find(c => c.type === 'road'))).toBe(false);
    expect(softGround(find(c => !!c.bridge))).toBe(false);
  });
  it('lays the grass flat along a track at once, a little with each soldier, and lets it recover over minutes', () => {
    const map = new TrampleMap();
    // A tank drives 3 cells east: the grass under it is flat, a cell to the side untouched.
    map.stroke(10, 10.5, 13, 10.5, .14, 1);
    expect(map.at(11.5, 10.5)).toBeGreaterThan(.95);
    expect(map.at(11.5, 11.6)).toBe(0);
    // Soldiers wear a path in: one pass bends it, three flatten it.
    map.stroke(20, 20.5, 22, 20.5, .05, .5, true);
    const once = map.at(21, 20.5);
    map.stroke(20, 20.5, 22, 20.5, .05, .5, true); map.stroke(20, 20.5, 22, 20.5, .05, .5, true);
    expect(once).toBeGreaterThan(.3); expect(once).toBeLessThan(.6);
    expect(map.at(21, 20.5)).toBeGreaterThan(.95);
    // Three minutes of game time: about half back up; ten: mostly; twenty: gone.
    for (let t = 0; t < 180; t += .5) map.update(.5);
    expect(map.at(11.5, 10.5)).toBeGreaterThan(.35); expect(map.at(11.5, 10.5)).toBeLessThan(.65);
    for (let t = 0; t < 420; t += .5) map.update(.5);
    expect(map.at(11.5, 10.5)).toBeLessThan(.2);
    for (let t = 0; t < 600; t += .5) map.update(.5);
    expect(map.at(11.5, 10.5)).toBe(0);
  });
});
