import * as THREE from 'three';

/**
 * Bake animation clips from one humanoid rig onto another by world-space
 * rotation deltas: for every mapped bone, the change of the source bone's
 * world rotation from its rest pose is applied to the target bone's rest
 * world rotation, then converted back to the target's local space. Works
 * across different bone axes and hierarchies as long as both rigs rest in
 * the same posture (both T-pose here). The pelvis also carries the
 * source's root motion, scaled by pelvis height.
 */
export type BoneMap = Record<string, string>; // target bone name -> source bone name

/** Quaternius "CharacterArmature" (the Vostran soldier) -> Mixamo rig (the Aster soldier). */
export const QUATERNIUS_TO_MIXAMO: BoneMap = {
  'mixamorig:Hips': 'Body',
  'mixamorig:Spine': 'Abdomen',
  'mixamorig:Spine1': 'Torso',
  'mixamorig:Spine2': 'Chest',
  'mixamorig:Neck': 'Neck',
  'mixamorig:Head': 'Head',
  'mixamorig:LeftShoulder': 'Shoulder.L',
  'mixamorig:LeftArm': 'UpperArm.L',
  'mixamorig:LeftForeArm': 'LowerArm.L',
  'mixamorig:LeftHand': 'Wrist.L',
  'mixamorig:RightShoulder': 'Shoulder.R',
  'mixamorig:RightArm': 'UpperArm.R',
  'mixamorig:RightForeArm': 'LowerArm.R',
  'mixamorig:RightHand': 'Wrist.R',
  'mixamorig:LeftUpLeg': 'UpperLeg.L',
  'mixamorig:LeftLeg': 'LowerLeg.L',
  'mixamorig:LeftFoot': 'Foot.L',
  'mixamorig:RightUpLeg': 'UpperLeg.R',
  'mixamorig:RightLeg': 'LowerLeg.R',
  'mixamorig:RightFoot': 'Foot.R',
};

interface Rest { world: THREE.Quaternion; position: THREE.Vector3 }

function restPose(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const rest = new Map<THREE.Object3D, Rest>();
  root.traverse(o => {
    const world = new THREE.Quaternion(), position = new THREE.Vector3();
    o.matrixWorld.decompose(position, world, new THREE.Vector3());
    rest.set(o, { world, position });
  });
  return rest;
}

/**
 * Bake `clips` (authored on `source`) for `target`. Both roots must be in
 * their rest pose when called; neither is left animated afterwards.
 */
export function retargetClips(target: THREE.Object3D, source: THREE.Object3D, clips: THREE.AnimationClip[], boneMap: BoneMap, fps = 30): THREE.AnimationClip[] {
  // GLTFLoader strips reserved characters from node names (':' and '.'): 'mixamorig:Hips' -> 'mixamorigHips'.
  const clean = THREE.PropertyBinding.sanitizeNodeName;
  const map: BoneMap = Object.fromEntries(Object.entries(boneMap).map(([t, s]) => [clean(t), clean(s)]));
  const targetRest = restPose(target), sourceRest = restPose(source);
  const pairs: { t: THREE.Object3D; s: THREE.Object3D }[] = [];
  // Parents before children, so each target bone's parent is already posed.
  target.traverse(t => {
    const name = map[t.name];
    const s = name ? source.getObjectByName(name) : undefined;
    if (s) pairs.push({ t, s });
  });
  const pelvis = pairs.find(p => p.t.name === Object.keys(map)[0]);
  if (!pelvis) return [];
  // Rest-pose correction: the rigs rest in slightly different A-poses (arms
  // 63 vs 51 degrees down), so align each target bone with its source bone
  // at rest, measured along the bone towards its next mapped child.
  const correction = new Map<THREE.Object3D, THREE.Quaternion>();
  const pos = (o: THREE.Object3D, rest: Map<THREE.Object3D, Rest>) => rest.get(o)!.position;
  for (const pair of pairs) {
    if (pair === pelvis) { correction.set(pair.t, new THREE.Quaternion()); continue; }
    let child: { t: THREE.Object3D; s: THREE.Object3D } | undefined;
    pair.t.traverse(o => { if (!child && o !== pair.t) child = pairs.find(p => p.t === o); });
    const c = new THREE.Quaternion();
    if (child) {
      const dt = pos(child.t, targetRest).clone().sub(pos(pair.t, targetRest)).normalize();
      const ds = pos(child.s, sourceRest).clone().sub(pos(pair.s, sourceRest)).normalize();
      if (dt.lengthSq() > .5 && ds.lengthSq() > .5) c.setFromUnitVectors(dt, ds);
    }
    correction.set(pair.t, c);
  }
  const sourceHeight = Math.max(1e-6, sourceRest.get(pelvis.s)!.position.y - sourceRest.get(source)!.position.y);
  const targetHeight = Math.max(1e-6, targetRest.get(pelvis.t)!.position.y - targetRest.get(target)!.position.y);
  const scale = targetHeight / sourceHeight;

  const mixer = new THREE.AnimationMixer(source);
  const q = new THREE.Quaternion(), parentWorld = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  const sw = new THREE.Quaternion(), sp = new THREE.Vector3(), scl = new THREE.Vector3();
  const local = new Map<THREE.Object3D, THREE.Quaternion>(pairs.map(p => [p.t, p.t.quaternion.clone()]));
  const restLocal = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  target.traverse(o => restLocal.set(o, { q: o.quaternion.clone(), p: o.position.clone() }));

  const baked = clips.map(clip => {
    const action = mixer.clipAction(clip);
    action.play();
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(frames);
    const values = new Map<THREE.Object3D, Float32Array>(pairs.map(p => [p.t, new Float32Array(frames * 4)]));
    const pelvisPositions = new Float32Array(frames * 3);
    for (let f = 0; f < frames; f++) {
      const time = Math.min(clip.duration, f / fps);
      times[f] = time;
      mixer.setTime(time);
      source.updateMatrixWorld(true);
      for (const { t, s } of pairs) {
        s.matrixWorld.decompose(sp, sw, scl);
        // World delta of the source bone, applied to the (rest-aligned) target rest world rotation.
        q.copy(sw).multiply(tmp.copy(sourceRest.get(s)!.world).invert()).multiply(correction.get(t)!).multiply(targetRest.get(t)!.world);
        t.parent!.matrixWorld.decompose(sp, parentWorld, scl);
        t.quaternion.copy(parentWorld.invert().multiply(q));
        t.updateMatrixWorld(true);
        local.get(t)!.copy(t.quaternion);
        values.get(t)!.set([t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w], f * 4);
        if (t === pelvis.t) {
          // Root motion: the source pelvis offset from rest, in the target's units.
          s.matrixWorld.decompose(sp, sw, scl);
          const offset = sp.sub(sourceRest.get(s)!.position).multiplyScalar(scale);
          const world = targetRest.get(t)!.position.clone().add(offset);
          t.parent!.worldToLocal(world);
          pelvisPositions.set([world.x, world.y, world.z], f * 3);
        }
      }
    }
    action.stop();
    mixer.uncacheAction(clip);
    const tracks: THREE.KeyframeTrack[] = pairs.map(({ t }) => new THREE.QuaternionKeyframeTrack(`${t.name}.quaternion`, times, values.get(t)!));
    tracks.push(new THREE.VectorKeyframeTrack(`${pelvis.t.name}.position`, times, pelvisPositions));
    // Restore the rest pose so the target can be cloned or measured afterwards.
    target.traverse(o => { const r = restLocal.get(o); if (r) { o.quaternion.copy(r.q); o.position.copy(r.p); } });
    target.updateMatrixWorld(true);
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
  mixer.uncacheRoot(source);
  source.traverse(o => { o.updateMatrixWorld(true); });
  return baked;
}
