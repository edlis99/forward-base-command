import * as THREE from 'three';

/**
 * Botanical low-/mid-poly meshes generated once per species/variant and then
 * instanced by the renderer. Unlike the old meshes, there are no faceted
 * icosahedral leaf blobs or conical tree crowns: trunks fork into actual limbs,
 * fine twigs carry dozens of separate translucent leaf/needle sprigs.
 *
 * Tree meshes are normalized to approximately one unit tall. LOD swaps the
 * number of branches and botanical sprigs, not the full-tree silhouette.
 */
export type ForestSpecies = 'pine' | 'spruce' | 'birch' | 'oak' | 'alder';
export type ForestDetail = 'near' | 'far';
export interface ForestGeometry { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; }

const cache = new Map<string, ForestGeometry>();
const golden = Math.PI * (3 - Math.sqrt(5));
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
}

class MeshWriter {
  positions: number[] = [];
  normals: number[] = [];
  uv: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  addVertex(point: THREE.Vector3, normal: THREE.Vector3, u: number, t: number, light: number) {
    const n = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.uv.push(u, t);
    this.colors.push(light, light, light);
    return n;
  }
  tube(start: THREE.Vector3, end: THREE.Vector3, r0: number, r1: number, sides = 7, light = 1) {
    const axis = end.clone().sub(start);
    if (axis.lengthSq() < .000001) return;
    axis.normalize();
    const tangent = v(1, 0, 0).cross(axis).normalize();
    if (tangent.lengthSq() < .001) tangent.set(0, 0, 1).cross(axis).normalize();
    const bitangent = axis.clone().cross(tangent).normalize();
    const base = this.positions.length / 3;
    for (let i = 0; i <= sides; i++) {
      const theta = i / sides * Math.PI * 2;
      const radial = tangent.clone().multiplyScalar(Math.cos(theta)).addScaledVector(bitangent, Math.sin(theta));
      this.addVertex(start.clone().addScaledVector(radial, r0), radial, i / sides, 0, light);
      this.addVertex(end.clone().addScaledVector(radial, r1), radial, i / sides, 1, light);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      // Counter-clockwise from outside the tube; reversed winding makes every
      // trunk disappear with FrontSide culling enabled.
      this.indices.push(a, c, b, c, d, b);
    }
  }
  sprig(center: THREE.Vector3, width: number, height: number, roll: number, tilt: number, shade: number) {
    // Each sprig is tiny, so crossing planes are individual needle branches /
    // leaves, never the entire silhouette of a tree.
    const right = v(Math.cos(roll), 0, Math.sin(roll));
    const up = v(Math.sin(tilt) * -Math.sin(roll), Math.cos(tilt), Math.sin(tilt) * Math.cos(roll));
    const facing = right.clone().cross(up).normalize();
    const hw = width * .5, hh = height * .5;
    const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const base = this.positions.length / 3;
    for (const [x, y] of corners) {
      const p = center.clone().addScaledVector(right, x).addScaledVector(up, y);
      this.addVertex(p, facing, (x / hw + 1) / 2, (y / hh + 1) / 2, shade);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

function createTree(species: ForestSpecies, variant: number, detail: ForestDetail): ForestGeometry {
  const seed = 1987 + variant * 901 + ['pine', 'spruce', 'birch', 'oak', 'alder'].indexOf(species) * 1079;
  const rand = seeded(seed);
  const wood = new MeshWriter(), leaf = new MeshWriter();
  const conifer = species === 'pine' || species === 'spruce';
  const isPine = species === 'pine';
  const isSpruce = species === 'spruce';
  const isOak = species === 'oak';
  const trunkRadius = isOak ? .063 : isPine ? .034 : isSpruce ? .035 : .030;
  const trunkLean = (rand() - .5) * .08;

  // Multi-segment, tapered trunk instead of a straight unbroken cylinder.
  const trunk = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return v(trunkLean * t + Math.sin(t * 6 + seed) * .009 * t, t, (rand() - .5) * .016 * t);
  });
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    wood.tube(trunk[i], trunk[i + 1], trunkRadius * (1 - .77 * t), trunkRadius * (1 - .77 * (i + 1) / 8), 9);
  }

  const near = detail === 'near';
  // Far trees are most of a forest: fewer limbs, but each fully leafed, so the
  // crown never reads as bare sticks from the tactical camera.
  const branchCount = isSpruce ? (near ? 58 : 26)
    : isPine ? (near ? 42 : 20)
    : isOak ? (near ? 42 : 20) : (near ? 38 : 18);
  const leafPerBranch = isSpruce ? (near ? 11 : 11)
    : isPine ? (near ? 10 : 11)
    : isOak ? (near ? 12 : 12) : (near ? 11 : 11);
  // Branch bark is darker than the trunk (birch limbs are grey, not white).
  const limbLight = species === 'birch' ? .5 : .78;
  const crownStart = isPine ? .57 : isSpruce ? .18 : isOak ? .44 : .42;

  for (let i = 0; i < branchCount; i++) {
    const h = crownStart + ((i + .45 * rand()) / branchCount) * (.94 - crownStart);
    const a = i * golden + variant * .72 + (rand() - .5) * .38;
    const taper = 1 - (h - crownStart) / (.98 - crownStart);
    const spread = isSpruce ? .16 + .31 * taper :
      isPine ? .15 + .29 * Math.sin(Math.PI * (h - crownStart) / (.99 - crownStart)) :
      isOak ? .28 + .19 * (taper ** .4) :
      .16 + .24 * Math.sqrt(taper);
    const length = spread * (.76 + .45 * rand());
    const direction = v(Math.cos(a), 0, Math.sin(a));
    const start = v(trunkLean * h, h, 0);
    const bend = isSpruce ? -.10 : isPine ? .035 : .14;
    const mid = start.clone().addScaledVector(direction, length * .50).add(v(0, bend * length * .5 + .04 * rand(), 0));
    const end = start.clone().addScaledVector(direction, length).add(v(0, bend * length + .09 * rand(), 0));
    // Conifer limbs are slim: thick ones showed as dark stars from above.
    const radius = (isOak ? .024 : conifer ? .0075 : .012) * (.5 + taper) * (.78 + .4 * rand());
    // The limb's wood stops short of its foliage, so no bare tips stick out.
    const woodEnd = start.clone().lerp(end, .86);
    wood.tube(start, mid, radius, radius * .67, near ? 6 : 5, limbLight);
    wood.tube(mid, woodEnd, radius * .67, .003, near ? 6 : 5, limbLight);

    // Forks with real woody secondary branches and terminal foliage sprays.
    const forkCount = near ? 3 : 2;
    for (let fork = 0; fork < forkCount; fork++) {
      const fraction = .54 + rand() * .40;
      const forkStart = start.clone().lerp(end, fraction);
      const dev = (fork - (forkCount - 1) / 2) * .52 + (rand() - .5) * .2;
      const forkDir = v(Math.cos(a + dev), 0, Math.sin(a + dev));
      const twigEnd = forkStart.clone().addScaledVector(forkDir, length * (.28 + rand() * .31))
        .add(v(0, (conifer ? -.02 : .05) + rand() * .06, 0));
      wood.tube(forkStart, twigEnd, radius * .30, .0016, 4, limbLight);
      const count = Math.max(1, Math.ceil(leafPerBranch / forkCount));
      for (let k = 0; k < count; k++) {
        // Foliage clothes the outer limb and its tip as well as the twigs:
        // leaves only on twig ends left long stretches of bare wood showing.
        const pick = rand();
        const at = pick < .5 ? twigEnd.clone().lerp(forkStart, rand() * .7)
          : pick < .75 ? start.clone().lerp(end, (conifer ? .18 : .4) + rand() * (conifer ? .82 : .6))
          : end.clone();
        const jx = (rand() - .5) * (conifer ? .085 : .11);
        const jy = (rand() - .5) * (conifer ? .08 : .13);
        const jz = (rand() - .5) * (conifer ? .085 : .11);
        at.add(v(jx, jy, jz));
        const size = isPine ? [.14, .22] : isSpruce ? [.15, .24] : isOak ? [.155, .25] : [.125, .21];
        const light = .80 + rand() * .24;
        const spin = a + rand() * Math.PI;
        leaf.sprig(at, size[0] * (.75 + rand() * .5), size[1] * (.8 + rand() * .5),
          spin, (rand() - .5) * 1.7, light);
        // A second small leaf/needle sheet at a different angle provides
        // three-dimensional parallax from the overhead tactical camera.
        if (near || k % 2 === 0) {
          const second = at.clone().add(v((rand() - .5) * .027, (rand() - .5) * .025, (rand() - .5) * .027));
          leaf.sprig(second, size[0] * (.65 + rand() * .35), size[1] * (.72 + rand() * .22),
            spin + Math.PI * .45, (rand() - .5) * 1.8, .81 + rand() * .22);
        }
      }
    }
  }
  // Leafy crown top over the trunk tip, where the highest limbs meet: without
  // it the converging bare limbs showed as a dark star from the overhead camera.
  for (let i = 0; i < (near ? 22 : 14); i++) {
    const t = rand(), r = Math.sqrt(rand()) * (conifer ? .09 : .17), th = rand() * Math.PI * 2;
    const pt = v(trunkLean + Math.cos(th) * r, .84 + rand() * .15, Math.sin(th) * r);
    leaf.sprig(pt, conifer ? .11 : .15, (conifer ? .15 : .2) + t * .08, rand() * Math.PI * 2, (rand() - .5) * 1.2, .86 + t * .16);
  }
  const result = { wood: wood.build(), leaves: leaf.build() };
  result.wood.userData = { species, detail, role: 'real branching timber' };
  result.leaves.userData = { species, detail, role: 'independent botanical leaf and needle cutouts' };
  return result;
}

/** Shared geometry instances across every forest section; no per-tree geometry builds. */
export function forestGeometry(species: ForestSpecies, variant: number, detail: ForestDetail): ForestGeometry {
  const key = `${species}/${variant}/${detail}`;
  let value = cache.get(key);
  if (!value) { value = createTree(species, variant, detail); cache.set(key, value); }
  return value;
}
