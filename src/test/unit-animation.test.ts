import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { retargetClips, QUATERNIUS_TO_MIXAMO } from '../scene3d/retargetClips';
import { splitTurret } from '../scene3d/turretSplit';
import { reachFor, strideSpeed } from '../scene3d/soldierRig';

/** Parse a bundled GLB (the buffer is copied into this realm's ArrayBuffer, which GLTFLoader requires). */
async function load(name: string) {
  const file = readFileSync(join(process.cwd(), 'public/assets/factions', name));
  const data = new ArrayBuffer(file.byteLength);
  new Uint8Array(data).set(file);
  return new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
}
const clean = THREE.PropertyBinding.sanitizeNodeName;
const direction = (bone: THREE.Object3D, child: THREE.Object3D) =>
  child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();

describe('soldier animation transfer', () => {
  it('drives the Aster (Mixamo) skeleton with the Vostran clips: limbs point the same way', async () => {
    const source = await load('union-rifleman.glb'), target = await load('aster-rifleman-detailed.glb');
    expect(target.animations.length).toBe(0);
    const src = clone(source.scene), tgt = clone(target.scene);
    const clips = retargetClips(tgt, src, source.animations, QUATERNIUS_TO_MIXAMO);
    expect(clips.map(c => c.name)).toEqual(source.animations.map(c => c.name));
    // Chains checked: upper arms, forearms, thighs and shins on both sides.
    const chains: [string, string, string, string][] = [
      ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'UpperArm.R', 'LowerArm.R'],
      ['mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'UpperArm.L', 'LowerArm.L'],
      ['mixamorig:RightForeArm', 'mixamorig:RightHand', 'LowerArm.R', 'Wrist.R'],
      ['mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'UpperLeg.L', 'LowerLeg.L'],
      ['mixamorig:RightLeg', 'mixamorig:RightFoot', 'LowerLeg.R', 'Foot.R'],
    ];
    const sm = new THREE.AnimationMixer(src), tm = new THREE.AnimationMixer(tgt);
    for (const name of ['Walk', 'Run', 'Idle_Gun_Pointing', 'Gun_Shoot', 'Death']) {
      const sc = source.animations.find(c => c.name.endsWith('|' + name))!, tc = clips.find(c => c.name === sc.name)!;
      sm.stopAllAction(); tm.stopAllAction();
      sm.clipAction(sc).play(); tm.clipAction(tc).play();
      for (const f of [.2, .5, .8]) {
        sm.setTime(sc.duration * f); tm.setTime(sc.duration * f);
        src.updateMatrixWorld(true); tgt.updateMatrixWorld(true);
        for (const [tb, tc2, sb, sc2] of chains) {
          const t = direction(tgt.getObjectByName(clean(tb))!, tgt.getObjectByName(clean(tc2))!);
          const s = direction(src.getObjectByName(clean(sb))!, src.getObjectByName(clean(sc2))!);
          expect(t.dot(s), `${name} ${tb} at ${f}`).toBeGreaterThan(.97);
        }
      }
    }
  });
});

describe('soldier gait and rifle hold', () => {
  /** A soldier as the game shows it: facing +X, 0.27 tall. */
  async function soldier(file: string, clipsFrom?: string) {
    const own = await load(file), source = clipsFrom ? await load(clipsFrom) : own;
    const scene = clone(own.scene);
    const clips = clipsFrom ? retargetClips(clone(own.scene), clone(source.scene), source.animations, QUATERNIUS_TO_MIXAMO) : own.animations;
    scene.rotation.y = Math.PI / 2;
    const root = new THREE.Group(); root.add(scene); root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    root.scale.setScalar(.27 / (box.max.y - box.min.y)); root.updateMatrixWorld(true);
    return { root, clips };
  }
  it('measures each clip\'s stride, so the legs can keep pace with the ground (no sliding feet)', async () => {
    const rigs = [
      { ...(await soldier('union-rifleman.glb')), feet: ['Foot.L', 'Foot.R'] },
      { ...(await soldier('aster-rifleman-detailed.glb', 'union-rifleman.glb')), feet: ['mixamorig:LeftFoot', 'mixamorig:RightFoot'] },
    ];
    for (const { root, clips, feet } of rigs) {
      const clip = (n: string) => clips.find(c => c.name.endsWith('|' + n))!;
      // Model units per second for a 0.27-tall soldier: walk ~1.3 m/s, run ~3 m/s.
      const walk = strideSpeed(root, clip('Walk'), feet, 'x'), run = strideSpeed(root, clip('Run'), feet, 'x');
      expect(walk).toBeGreaterThan(.15); expect(walk).toBeLessThan(.23);
      expect(run).toBeGreaterThan(.38); expect(run).toBeLessThan(.55);
      expect(strideSpeed(root, clip('Run_Left'), feet, 'z')).toBeGreaterThan(.38);
    }
  });
  it('reaches the arms to the rifle: two-bone IK puts the hand on the grip', async () => {
    const { root, clips } = await soldier('union-rifleman.glb');
    const mixer = new THREE.AnimationMixer(root.children[0]);
    mixer.clipAction(clips.find(c => c.name.endsWith('|Idle_Gun'))!).play(); mixer.update(0);
    root.updateMatrixWorld(true);
    const [a, b, w] = ['UpperArm.R', 'LowerArm.R', 'Wrist.R'].map(n => root.getObjectByName(clean(n))!);
    const shoulder = a.getWorldPosition(new THREE.Vector3());
    for (const offset of [new THREE.Vector3(.035, -.01, -.008), new THREE.Vector3(.03, -.035, -.01), new THREE.Vector3(.02, -.02, -.02)]) {
      const target = shoulder.clone().add(offset);
      reachFor(a, b, w, target, new THREE.Vector3(-.2, -.5, 1));
      root.updateMatrixWorld(true);
      expect(w.getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(.001);
    }
  });
});

describe('tank turret split', () => {
  it('cuts the turret and gun out of the one-piece tank so they can turn', async () => {
    const tank = await load('tank-hull.glb');
    const root = clone(tank.scene);
    let before = 0;
    root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) before += (m.geometry.index?.count ?? 0) / 3; });
    const pivot = splitTurret(root);
    expect(pivot).not.toBeNull();
    let hull = 0, turret = 0;
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const tris = (m.geometry.index?.count ?? 0) / 3;
      if (m.name === 'turret') turret += tris; else hull += tris;
    });
    // Every triangle kept, the turret a real share of them.
    expect(hull + turret).toBe(before);
    expect(turret).toBeGreaterThan(60);
    expect(hull).toBeGreaterThan(turret);
    // The gun (pointing -X in the file) belongs to the turret: it reaches far beyond the hull front.
    const turretMesh = pivot!.getObjectByName('turret') as THREE.Mesh;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(turretMesh), all = new THREE.Box3().setFromObject(root);
    expect(box.min.x).toBeCloseTo(all.min.x, 3);
    // Turning the turret moves the gun round the pivot, the hull stays put.
    pivot!.rotation.y = Math.PI / 2; root.updateMatrixWorld(true);
    const turned = new THREE.Box3().setFromObject(turretMesh);
    expect(turned.max.z - turned.min.z).toBeGreaterThan(box.max.z - box.min.z + 2);
  });
});
