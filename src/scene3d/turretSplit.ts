import * as THREE from 'three';

/**
 * The licensed tank model is one mesh, so its turret cannot turn on its own.
 * Its parts are separate pieces of geometry, though: split them into hull and
 * turret by position. The turret body is the largest piece standing on the
 * hull deck; with it go every piece on top of its footprint (hatches,
 * cupola, antennas, launchers) and the gun pieces in front of it. The
 * turret ends up under a pivot group (named `turret-pivot`) at the centre of
 * the turret ring, turning about the model's up axis.
 *
 * `root` is the model root (its own space is the reference, Y up). The mesh
 * transforms are baked into the geometry, so a non-uniformly scaled mesh node
 * cannot shear the turret as it turns. Returns the pivot, or null when no
 * plausible turret is found (the model is then left untouched).
 */
export function splitTurret(root: THREE.Object3D): THREE.Group | null {
  root.updateMatrixWorld(true);
  const mesh = (() => { let m: THREE.Mesh | null = null; root.traverse(o => { if (!m && (o as THREE.Mesh).isMesh) m = o as THREE.Mesh; }); return m as THREE.Mesh | null; })();
  if (!mesh) return null;
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const geometry = mesh.geometry.clone().applyMatrix4(toRoot);
  const position = geometry.getAttribute('position');
  const index = geometry.index ?? new THREE.BufferAttribute(new Uint32Array(Array.from({ length: position.count }, (_, i) => i)), 1);
  const triangles = index.count / 3;

  // Pieces: triangles connected through shared corner positions.
  const key = (i: number) => `${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)},${position.getZ(i).toFixed(4)}`;
  const ids = new Map<string, number>(), parent: number[] = [];
  const idOf = (i: number) => { const k = key(i); let id = ids.get(k); if (id === undefined) { id = parent.length; ids.set(k, id); parent.push(id); } return id; };
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const corner = new Int32Array(index.count);
  for (let i = 0; i < index.count; i++) corner[i] = idOf(index.getX(i));
  for (let t = 0; t < triangles; t++) {
    const a = find(corner[t * 3]);
    parent[find(corner[t * 3 + 1])] = a; parent[find(corner[t * 3 + 2])] = a;
  }
  interface Piece { tris: number[]; box: THREE.Box3 }
  const pieces = new Map<number, Piece>();
  const v = new THREE.Vector3();
  for (let t = 0; t < triangles; t++) {
    const r = find(corner[t * 3]);
    let p = pieces.get(r);
    if (!p) { p = { tris: [], box: new THREE.Box3() }; pieces.set(r, p); }
    p.tris.push(t);
    for (let k = 0; k < 3; k++) p.box.expandByPoint(v.fromBufferAttribute(position, index.getX(t * 3 + k)));
  }
  const all = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
  const height = all.max.y - all.min.y;
  // Turret body: the biggest piece that starts in the upper part of the model.
  const body = [...pieces.values()].filter(p => p.box.min.y > all.min.y + height * .4)
    .sort((a, b) => b.tris.length - a.tris.length)[0];
  if (!body) return null;
  const deck = body.box.min.y - height * .02;
  const size = body.box.getSize(new THREE.Vector3()), centre = body.box.getCenter(new THREE.Vector3());
  const reach = new THREE.Box3(body.box.min.clone().addScaledVector(size, -.12), body.box.max.clone().addScaledVector(size, .12));
  const turret = new Set<Piece>();
  for (const p of pieces.values()) {
    if (p.box.min.y < deck) continue;
    const c = p.box.getCenter(new THREE.Vector3());
    const onTop = c.x >= reach.min.x && c.x <= reach.max.x && c.z >= reach.min.z && c.z <= reach.max.z;
    // The gun: a long piece on the turret's centre line, reaching to its front face.
    const pz = p.box.getSize(new THREE.Vector3());
    const gun = Math.abs(c.z - centre.z) < size.z * .12 && pz.x > pz.z * 2 && p.box.max.x <= body.box.min.x + size.x * .25 && p.box.max.x >= body.box.min.x - size.x * 3;
    if (onTop || gun) turret.add(p);
  }
  if (turret.size < 2) return null;

  // Two index buffers over the same vertices, keeping the material groups.
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index.count, materialIndex: 0 }];
  const inTurret = new Uint8Array(triangles);
  for (const p of turret) for (const t of p.tris) inTurret[t] = 1;
  const subset = (want: number) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geometry.attributes)) g.setAttribute(name, attr);
    const out: number[] = [];
    for (const group of groups) {
      const start = out.length;
      for (let t = group.start / 3; t < (group.start + group.count) / 3; t++) if (inTurret[t] === want) out.push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
      if (out.length > start) g.addGroup(start, out.length - start, group.materialIndex ?? 0);
    }
    g.setIndex(out);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  };
  const hullMesh = mesh, turretMesh = new THREE.Mesh(subset(1), mesh.material);
  hullMesh.geometry = subset(0);
  // The baked geometry is in root space: the hull mesh hangs straight off the root.
  hullMesh.parent?.remove(hullMesh);
  hullMesh.position.set(0, 0, 0); hullMesh.quaternion.identity(); hullMesh.scale.set(1, 1, 1);
  root.add(hullMesh);
  turretMesh.name = 'turret'; turretMesh.castShadow = hullMesh.castShadow; turretMesh.receiveShadow = hullMesh.receiveShadow;
  const pivot = new THREE.Group();
  pivot.name = 'turret-pivot';
  pivot.position.set(centre.x, deck, centre.z);
  turretMesh.position.set(-centre.x, -deck, -centre.z);
  pivot.add(turretMesh);
  root.add(pivot);
  root.updateMatrixWorld(true);
  return pivot;
}
