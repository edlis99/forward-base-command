import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const san = THREE.PropertyBinding.sanitizeNodeName;

/**
 * Ground speed (model units per second; the model stands 0.27 tall) at which
 * a locomotion clip's planted feet stay put: the median speed of each foot
 * while it is down, along the clip's direction of travel. Measured once per clip.
 */
const strideSpeeds = new WeakMap<THREE.AnimationClip, number>();
export function strideSpeed(model: THREE.Object3D, clip: THREE.AnimationClip, feet: string[], axis: 'x' | 'z'): number {
  const known = strideSpeeds.get(clip);
  if (known !== undefined) return known;
  const probe = clone(model);
  const mixer = new THREE.AnimationMixer(probe);
  mixer.clipAction(clip).play();
  const bones = feet.map(n => probe.getObjectByName(san(n))).filter((b): b is THREE.Object3D => !!b);
  const N = 60, track: THREE.Vector3[][] = bones.map(() => []);
  for (let i = 0; i <= N; i++) {
    mixer.setTime(clip.duration * i / N); probe.updateMatrixWorld(true);
    bones.forEach((b, k) => track[k].push(new THREE.Vector3().setFromMatrixPosition(b.matrixWorld)));
  }
  mixer.stopAllAction(); mixer.uncacheRoot(probe);
  const dt = clip.duration / N, speeds: number[] = [];
  for (const path of track) {
    const low = Math.min(...path.map(p => p.y)) + .006;
    for (let i = 1; i < path.length; i++) if (path[i].y < low && path[i - 1].y < low)
      speeds.push(Math.abs(axis === 'x' ? path[i].x - path[i - 1].x : path[i].z - path[i - 1].z) / dt);
  }
  speeds.sort((a, b) => a - b);
  const speed = speeds.length && speeds[speeds.length >> 1] > .02 ? speeds[speeds.length >> 1] : .45;
  strideSpeeds.set(clip, speed);
  return speed;
}

// Scratch objects for the arm solver (no allocation per frame).
const IK = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(),
  q: new THREE.Quaternion(), w: new THREE.Quaternion(), pq: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() };
const NO_TURN = new THREE.Quaternion();
/** Turn a bone so its world direction `from` lies along `to` (both get normalised), by `weight`. */
function turnBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  IK.q.setFromUnitVectors(from.normalize(), to.normalize());
  if (weight < 1) IK.q.slerpQuaternions(NO_TURN, IK.q, weight);
  bone.matrixWorld.decompose(IK.p, IK.w, IK.s);
  IK.w.premultiply(IK.q);
  bone.parent!.matrixWorld.decompose(IK.p, IK.pq, IK.s);
  bone.quaternion.copy(IK.pq.invert().multiply(IK.w));
  bone.updateMatrixWorld(true);
}
/**
 * Two-bone arm IK in world space: shoulder `a`, elbow `b` and wrist `c` reach
 * for `target`, the elbow bending towards `pole`. Out of reach, the arm
 * stretches straight towards it.
 */
export function reachFor(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, weight = 1) {
  const pa = IK.a.setFromMatrixPosition(a.matrixWorld), pb = IK.b.setFromMatrixPosition(b.matrixWorld), pc = IK.c.setFromMatrixPosition(c.matrixWorld);
  const l1 = pa.distanceTo(pb), l2 = pb.distanceTo(pc);
  const dir = IK.d.subVectors(target, pa);
  let dist = dir.length();
  if (dist < 1e-6 || l1 < 1e-6 || l2 < 1e-6) return;
  dir.divideScalar(dist);
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-5), (l1 + l2) * .999);
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const bend = IK.e.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-12) bend.subVectors(pb, pa).addScaledVector(dir, -IK.f.subVectors(pb, pa).dot(dir));
  bend.normalize();
  const elbow = IK.f.copy(pa).addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * sinA);
  turnBone(a, pb.sub(pa), elbow.sub(pa), weight);
  const pb2 = IK.b.setFromMatrixPosition(b.matrixWorld), pc2 = IK.c.setFromMatrixPosition(c.matrixWorld);
  const goal = IK.e.copy(pa).addScaledVector(dir, dist);
  turnBone(b, pc2.sub(pb2), goal.sub(pb2), weight);
}

/** Shoulder-to-wrist length of an arm, in model space. */
export function armLength(arm: THREE.Object3D[], inv: THREE.Matrix4, tmp: { pole: THREE.Vector3; hand: THREE.Vector3 }) {
  const a = tmp.pole.setFromMatrixPosition(arm[0].matrixWorld).applyMatrix4(inv);
  const b = tmp.hand.setFromMatrixPosition(arm[1].matrixWorld).applyMatrix4(inv);
  let length = a.distanceTo(b);
  a.setFromMatrixPosition(arm[2].matrixWorld).applyMatrix4(inv);
  length += a.distanceTo(b);
  return length;
}
