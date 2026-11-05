import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FactionId } from '../game/factions';

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

export type Triple = [number, number, number];

/** The rifle's length in model units (the soldier stands 0.27 tall): 0.9 m. */
export const RIFLE_LENGTH = .135;
const RK = RIFLE_LENGTH / .15;
/**
 * Where the hands and the shoulder meet the rifle, in its own frame (barrel
 * +x, top +y, right side +z; centred on its bounding box). Measured from the
 * Quaternius AK-74 and SCAR-L models, which share this layout: the right side
 * of the pistol grip, the underside of the handguard from just ahead of the
 * magazine to its front, and the middle of the butt plate.
 */
export const RIFLE = {
  grip: new THREE.Vector3(-.031, -.0025, .0035).multiplyScalar(RK),
  guardFrom: .004 * RK, guardTo: .03 * RK, guardY: .0085 * RK,
  butt: new THREE.Vector3(-.075, .007, 0).multiplyScalar(RK),
};
/** The hands on the rifle, in its frame: the finger direction (wrist to knuckles) and the palm's facing. */
const HAND_ON = {
  // Right: fingers forward round the pistol grip (raked back 15 degrees), palm against its right side.
  right: { fingers: new THREE.Vector3(Math.cos(.26), -Math.sin(.26), 0), palm: new THREE.Vector3(0, 0, -1) },
  // Left: palm up under the handguard, fingers across it to the right and a little forward.
  left: { fingers: new THREE.Vector3(Math.sin(.6), 0, Math.cos(.6)), palm: new THREE.Vector3(0, 1, 0) },
};

/**
 * How the rifle is held, in the torso's frame (forward, up, right; lying
 * prone "forward" points at the ground and "up" along it towards the head):
 * which point of the rifle (butt plate or pistol grip) goes where, relative
 * to the right shoulder in arm lengths, the barrel direction and the rifle's
 * top (default: the torso's up). `blade` turns the chest right, bringing the
 * left shoulder forward as in a real firing stance, so the support hand
 * reaches the handguard; the head stays to the front. `reach` is where along
 * the handguard the left hand would like to be (0 rear, 1 front); it slides
 * back as far as needed to reach. Elbow poles say which way each elbow bends.
 */
export interface Hold {
  anchor: 'butt' | 'grip'; at: Triple; barrel: Triple; top?: Triple;
  blade: number; reach: number; poleR: Triple; poleL: Triple;
}
export const HOLDS: Record<'ready' | 'run' | 'aim' | 'prone', Hold> = {
  // Low ready: butt in the shoulder, muzzle down and in.
  ready: { anchor: 'butt', at: [.14, -.12, -.12], barrel: [.82, -.52, -.18], blade: .42, reach: .5, poleR: [-.3, -1, .7], poleL: [0, -1, -.4] },
  // Running: across the chest, muzzle up and to the left.
  run: { anchor: 'grip', at: [.45, -.85, -.15], barrel: [.5, .55, -.67], blade: 0, reach: .7, poleR: [-.3, -1, .7], poleL: [0, -1, -.3] },
  // Shouldered: butt in the shoulder pocket, sights at the cheek.
  aim: { anchor: 'butt', at: [.16, .2, -.12], barrel: [1, -.02, -.02], blade: .6, reach: 1, poleR: [-.1, -.6, 1], poleL: [.1, -1, -.3] },
  // Prone: shouldered, level along the ground, a little across the body.
  prone: { anchor: 'butt', at: [.14, .03, -.12], barrel: [0, 1, -.12], top: [-1, 0, 0], blade: 0, reach: .5, poleR: [1, 0, .7], poleL: [1, 0, -.7] },
};
/**
 * Which hold each clip of the Quaternius set gets: low ready standing and
 * walking, across the chest running, shouldered aiming, firing and strafing
 * (a soldier sidesteps facing his target), along the ground prone. Clips not
 * listed (the death fall) keep their own arms; the rifle stays in the hand.
 */
export const CLIP_HOLDS: Record<string, keyof typeof HOLDS> = {
  Idle_Gun: 'ready', Walk: 'ready', HitRecieve: 'ready', Run: 'run',
  Idle_Gun_Pointing: 'aim', Idle_Gun_Shoot: 'aim', Gun_Shoot: 'aim', Run_Shoot: 'aim', Run_Back: 'aim', Run_Left: 'aim', Run_Right: 'aim',
  Roll: 'prone',
};

export interface RigNames {
  hips: string; neck: string;
  /** Spine bones from the pelvis up, turned to blade the torso. */
  spine: string[];
  right: string[]; left: string[];
  /** Finger chains of each hand, base to tip: index, middle, ring, pinky, thumb. */
  fingers: { right: string[][]; left: string[][] };
  /** Index in each finger chain of the knuckle, the base of the finger proper. */
  knuckle: number;
}
/** Finger chains, base to tip (with the end bones, so the last joints can curl). */
const fingersOf = (name: (finger: string, k: number) => string, joints: number, thumb: number) => [
  ...['Index', 'Middle', 'Ring', 'Pinky'].map(f => [...Array.from({ length: joints }, (_, k) => name(f, k + 1)), `${name(f, joints)}_end`]),
  [...Array.from({ length: thumb }, (_, k) => name('Thumb', k + 1)), `${name('Thumb', thumb)}_end`],
];
/** The bones the rifle hold and the stride measurement use, per soldier rig (names as in the files). */
export const SOLDIER_RIGS: Record<FactionId, RigNames & { feet: string[] }> = {
  // Mixamo rig of the Aster soldier.
  aster: {
    hips: 'mixamorig:Hips', neck: 'mixamorig:Neck', feet: ['mixamorig:LeftFoot', 'mixamorig:RightFoot'],
    spine: ['mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2'],
    right: ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'],
    left: ['mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand'],
    fingers: { right: fingersOf((f, k) => `mixamorig:RightHand${f}${k}`, 4, 4), left: fingersOf((f, k) => `mixamorig:LeftHand${f}${k}`, 4, 4) },
    knuckle: 0,
  },
  // Quaternius rig of the Vostran soldier (its fingers start with a metacarpal bone).
  vostran: {
    hips: 'Hips', neck: 'Neck', feet: ['Foot.L', 'Foot.R'], spine: ['Abdomen', 'Torso', 'Chest'],
    right: ['UpperArm.R', 'LowerArm.R', 'Wrist.R'], left: ['UpperArm.L', 'LowerArm.L', 'Wrist.L'],
    fingers: { right: fingersOf((f, k) => `${f}${k}.R`, 4, 3), left: fingersOf((f, k) => `${f}${k}.L`, 4, 3) },
    knuckle: 1,
  },
};
/** The rifle in the right hand: its transform in the wrist bone's frame, the same in every baked pose. */
export interface RifleGrip { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }

/** A hand's own frame, in its wrist bone's orientation (world units): finger direction, palm facing, palm surface. */
interface HandModel { fingers: THREE.Vector3; palm: THREE.Vector3; surface: THREE.Vector3; basis: THREE.Quaternion }
const basisOf = (fingers: THREE.Vector3, palm: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(fingers, palm, new THREE.Vector3().crossVectors(fingers, palm)));

const baked = new WeakMap<THREE.Object3D, { clips: THREE.AnimationClip[]; grip: RifleGrip }>();
/**
 * The source clips hold a pistol one-handed. Bake a two-handed rifle hold into
 * them, once per soldier model: at 30 frames a second each clip is posed, the
 * torso bladed and the rifle placed for the clip's hold, the right hand put on
 * the pistol grip and the left under the handguard (palms on the rifle,
 * fingers curled round it), and the spine, arm and finger rotations become
 * the clips' tracks. The rifle is then simply a child of the right wrist
 * (`grip`): both hands on it at every distance and through every blend
 * between clips, with no work per frame.
 */
export function bakeRifleHold(model: THREE.Object3D, clips: THREE.AnimationClip[], rig: RigNames, fps = 30) {
  const known = baked.get(model);
  if (known) return known;
  const probe = clone(model);
  probe.updateMatrixWorld(true);
  const bone = (n: string) => probe.getObjectByName(san(n)) ?? null;
  const right = rig.right.map(bone), left = rig.left.map(bone), hips = bone(rig.hips), neck = bone(rig.neck);
  const spine = rig.spine.map(bone).filter((b): b is THREE.Object3D => !!b);
  const chains = (side: string[][]) => side.map(chain => chain.map(bone).filter((b): b is THREE.Object3D => !!b));
  const fingersR = chains(rig.fingers.right), fingersL = chains(rig.fingers.left);
  const skinned = (() => { let m: THREE.SkinnedMesh | null = null; probe.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !m) m = o as THREE.SkinnedMesh; }); return m as THREE.SkinnedMesh | null; })();
  if (right.some(b => !b) || left.some(b => !b) || !hips || !neck || !skinned
    || [...fingersR, ...fingersL].slice(0, 4).some(c => c.length <= rig.knuckle) || fingersR.length < 4 || fingersL.length < 4) {
    const none = { clips, grip: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) } };
    baked.set(model, none);
    return none;
  }
  const R = right as THREE.Object3D[], Lf = left as THREE.Object3D[];
  const at = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
  const worldQ = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  /** Give a bone a world orientation. */
  const setWorldQ = (o: THREE.Object3D, q: THREE.Quaternion) => {
    o.quaternion.copy(worldQ(o.parent!).invert().multiply(q));
    o.updateMatrixWorld(true);
  };

  // Fingers: straight from the bind pose, then curled round a grip. Each
  // joint turns towards the palm; the result is relative to the hand, so the
  // same local rotations serve every pose.
  const rest = clone(model);
  let restMesh: THREE.SkinnedMesh | null = null;
  rest.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !restMesh) restMesh = o as THREE.SkinnedMesh; });
  (restMesh as THREE.SkinnedMesh | null)?.skeleton.pose();
  const restQ = (b: THREE.Object3D) => rest.getObjectByName(b.name)?.quaternion ?? b.quaternion;
  const fingerBones = [...fingersR, ...fingersL].flat();
  fingerBones.forEach(b => b.quaternion.copy(restQ(b)));
  probe.updateMatrixWorld(true);
  const handModel = (wrist: THREE.Object3D, fingers: THREE.Object3D[][], side: 1 | -1): HandModel => {
    const w = at(wrist), knuckles = fingers.slice(0, 4).map(c => at(c[rig.knuckle]));
    const k = knuckles.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(4);
    const length = k.distanceTo(w);
    const f = k.clone().sub(w).normalize();
    const across = knuckles[3].clone().sub(knuckles[0]);
    across.addScaledVector(f, -across.dot(f)).normalize();
    const n = new THREE.Vector3().crossVectors(f, across).multiplyScalar(side);
    const surface = w.clone().lerp(k, .5).addScaledVector(n, .15 * length).sub(w);
    const toLocal = worldQ(wrist).invert();
    const fl = f.applyQuaternion(toLocal), nl = n.applyQuaternion(toLocal);
    return { fingers: fl, palm: nl, surface: surface.applyQuaternion(toLocal), basis: basisOf(fl, nl) };
  };
  const handR = handModel(R[2], fingersR, 1), handL = handModel(Lf[2], fingersL, -1);
  const curl = (fingers: THREE.Object3D[][], hand: HandModel, wrist: THREE.Object3D) => {
    const palm = hand.palm.clone().applyQuaternion(worldQ(wrist));
    fingers.forEach((chain, c) => {
      const thumb = c === 4, from = thumb ? 1 : rig.knuckle;
      for (let k = from; k < Math.min(chain.length - 1, from + 3); k++) {
        const b = chain[k], d = at(chain[k + 1]).sub(at(b)).normalize();
        const axis = new THREE.Vector3().crossVectors(d, palm);
        if (axis.lengthSq() < 1e-8) continue;
        const angle = (thumb ? .45 : 1) * [1, 1.15, .7][k - from];
        setWorldQ(b, new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle).multiply(worldQ(b)));
      }
    });
  };
  curl(fingersR, handR, R[2]);
  curl(fingersL, handL, Lf[2]);
  const fingerPose = fingerBones.map(b => b.quaternion.clone());

  // The rifle in the right hand: fixed by where the palm and fingers sit on the grip.
  const onRifleR = basisOf(HAND_ON.right.fingers, HAND_ON.right.palm), onRifleL = basisOf(HAND_ON.left.fingers, HAND_ON.left.palm);
  const rifleInHand = handR.basis.clone().multiply(onRifleR.clone().invert());
  const wristScale = R[2].getWorldScale(new THREE.Vector3());
  const grip: RifleGrip = {
    quaternion: rifleInHand,
    position: handR.surface.clone().sub(RIFLE.grip.clone().applyQuaternion(rifleInHand)).divide(wristScale),
    scale: new THREE.Vector3(1, 1, 1).divide(wristScale),
  };

  const mixer = new THREE.AnimationMixer(probe);
  // Stopping restores the bones the solver turned before the next sample
  // (the mixer only writes values that changed). A looping clip wraps at its
  // end, so the last frame is sampled a hair before it.
  // Bones a clip leaves alone keep their first pose: reset those the solver turns.
  const initial = [...R, ...Lf, ...spine, neck!].map(b => [b, b.quaternion.clone()] as const);
  const pose = (clip: THREE.AnimationClip, t: number) => {
    mixer.stopAllAction();
    for (const [b, q] of initial) b.quaternion.copy(q);
    mixer.clipAction(clip).reset().play(); mixer.setTime(Math.min(t, clip.duration - 1e-4));
  };
  const reachOf = (arm: THREE.Object3D[]) => at(arm[0]).distanceTo(at(arm[1])) + at(arm[1]).distanceTo(at(arm[2]));
  /** Put a hand's palm at `contact`, oriented `onRifle` against the rifle `q`; returns where the wrist must go. */
  const handTarget = (hand: HandModel, onRifle: THREE.Quaternion, q: THREE.Quaternion, contact: THREE.Vector3) => {
    const w = q.clone().multiply(onRifle).multiply(hand.basis.clone().invert());
    return { w, wrist: contact.clone().sub(hand.surface.clone().applyQuaternion(w)) };
  };
  const qU = new THREE.Quaternion();
  const frame = (hold: Hold) => {
    probe.updateMatrixWorld(true);
    const sr = at(R[0]), sl = at(Lf[0]), r = sr.clone().sub(sl).normalize();
    const u = at(neck!).sub(at(hips!));
    u.addScaledVector(r, -u.dot(r)).normalize();
    const f = new THREE.Vector3().crossVectors(u, r).normalize();
    // Blade the torso: the chest turns right over the spine, the head back to the front.
    if (hold.blade && spine.length) {
      const share = hold.blade / spine.length;
      for (const b of spine) setWorldQ(b, qU.setFromAxisAngle(u, -share).multiply(worldQ(b)));
      setWorldQ(neck!, qU.setFromAxisAngle(u, hold.blade).multiply(worldQ(neck!)));
    }
    const local = (t: Triple) => new THREE.Vector3().addScaledVector(f, t[0]).addScaledVector(u, t[1]).addScaledVector(r, t[2]);
    return { f, u, r, local };
  };
  const out = clips.map(clip => {
    const hold = HOLDS[CLIP_HOLDS[clip.name.split('|').pop() ?? '']];
    const fingerTracks = fingerBones.map((b, i) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0], fingerPose[i].toArray()));
    const fingerNames = new Set(fingerTracks.map(t => t.name));
    if (!hold) return new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks.filter(tr => !fingerNames.has(tr.name)), ...fingerTracks]);
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const posed = [...R, ...Lf, ...(hold.blade ? [...spine, neck!] : [])];
    const times = new Float32Array(frames), values = posed.map(() => new Float32Array(frames * 4));
    for (let k = 0; k < frames; k++) {
      const t = Math.min(clip.duration, k / fps);
      times[k] = t;
      pose(clip, t);
      const { f, local } = frame(hold);
      probe.updateMatrixWorld(true);
      const sr = at(R[0]), L = reachOf(R);
      // The rifle where the hold puts it.
      const barrel = local(hold.barrel).normalize();
      const top = local(hold.top ?? [0, 1, 0]);
      top.addScaledVector(barrel, -top.dot(barrel)).normalize();
      if (top.lengthSq() < .5) top.copy(f);
      const q = basisOf(barrel, top);
      const anchor = (hold.anchor === 'butt' ? RIFLE.butt : RIFLE.grip).clone().applyQuaternion(q);
      const origin = sr.clone().add(local(hold.at).multiplyScalar(L)).sub(anchor);
      // Right hand on the pistol grip, wrist turned to carry the rifle.
      const rh = handTarget(handR, onRifleR, q, origin.clone().add(RIFLE.grip.clone().applyQuaternion(q)));
      reachFor(R[0], R[1], R[2], rh.wrist, local(hold.poleR));
      setWorldQ(R[2], rh.w);
      // Left hand under the handguard of the rifle where it actually is now,
      // as far forward as it reaches.
      const held = new THREE.Matrix4().compose(grip.position, grip.quaternion, grip.scale).premultiply(R[2].matrixWorld);
      const rq = new THREE.Quaternion(), ro = new THREE.Vector3();
      held.decompose(ro, rq, new THREE.Vector3());
      const shoulderL = at(Lf[0]), reachL = reachOf(Lf) * .985;
      let lh = null as ReturnType<typeof handTarget> | null;
      for (let x = RIFLE.guardFrom + (RIFLE.guardTo - RIFLE.guardFrom) * hold.reach; ; x -= .002) {
        const xx = Math.max(RIFLE.guardFrom, x);
        lh = handTarget(handL, onRifleL, rq, ro.clone().add(new THREE.Vector3(xx, RIFLE.guardY, -.0005 * RK).applyQuaternion(rq)));
        if (xx <= RIFLE.guardFrom || lh.wrist.distanceTo(shoulderL) <= reachL) break;
      }
      reachFor(Lf[0], Lf[1], Lf[2], lh!.wrist, local(hold.poleL));
      setWorldQ(Lf[2], lh!.w);
      posed.forEach((b, i) => values[i].set([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], k * 4));
    }
    const names = new Set([...posed.map(b => `${b.name}.quaternion`), ...fingerNames]);
    const tracks = clip.tracks.filter(tr => !names.has(tr.name));
    posed.forEach((b, i) => tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, values[i])));
    return new THREE.AnimationClip(clip.name, clip.duration, [...tracks, ...fingerTracks]);
  });
  mixer.stopAllAction(); mixer.uncacheRoot(probe);
  const result = { clips: out, grip };
  baked.set(model, result);
  return result;
}
