import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FACTIONS, FactionId } from '../game/factions';
import { FactionWeapon, TankDetails, TankTurretDetails, CarrierDetails, CarrierTurretDetails, HelicopterDetails } from './FactionEnhancements';
import { retargetClips, QUATERNIUS_TO_MIXAMO } from './retargetClips';
import { splitTurret } from './turretSplit';
import { animStep } from './animationClock';
import { armLength, reachFor, strideSpeed } from './soldierRig';
import type { Position, Unit, UnitType } from '../game/types';
import { CELL_SIZE } from '../game/constants';

const asset = (name: string) => `${import.meta.env.BASE_URL}assets/factions/${name}.glb`;
const FACTION_MODEL_PATHS = {
  aster: { infantry: asset('aster-rifleman-detailed'), tank: asset('tank-hull') },
  vostran: { infantry: asset('union-rifleman'), tank: asset('tank-hull') },
};
/** The Quaternius soldier's animation set also drives the Aster (Mixamo-rigged) soldier. */
const ANIMATION_SOURCE = asset('union-rifleman');
/** Where in the combat roll the soldier lies flat, arms forward: held as the prone / in-cover pose. */
const PRONE_AT = .16;

/** Where a unit's weapon should point (its live target), or null. */
export type AimResolver = (unit: Unit) => Position | null;


const angleDelta = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A failed optional asset keeps its local fallback; it never blanks the battlefield. */
class ModelBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.warn('Faction model unavailable; using fallback.', error.message); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Block({ at, size, color, rotation }: { at: [number, number, number]; size: [number, number, number]; color: string; rotation?: [number, number, number] }) {
  return <mesh position={at} rotation={rotation} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.88} metalness={0.12} /></mesh>;
}

function Rifle({ eastern = false }: { eastern?: boolean }) {
  return <group>
    <Block at={[0, 0, 0]} size={[0.13, 0.018, 0.014]} color="#242927" />
    <Block at={[0.075, 0.001, 0]} size={[0.08, 0.008, 0.008]} color="#282b29" />
    <Block at={[-0.075, -0.002, 0]} size={[0.05, 0.018, 0.014]} color={eastern ? '#66513a' : '#313934'} />
    <Block at={[0.015, -0.024, 0]} size={[0.018, 0.04, 0.012]} rotation={[0, 0, eastern ? -0.35 : -0.12]} color="#30352f" />
    <Block at={[0.012, 0.012, 0]} size={[0.016, 0.008, 0.009]} color="#151c19" />
  </group>;
}

const templates = new WeakMap<THREE.Object3D, Map<string, THREE.Group>>();
/** Share immutable geometry/materials within a faction; skeletons remain per soldier. */
function templateFor(scene: THREE.Group, faction: FactionId, type: 'infantry' | 'tank', animations: THREE.AnimationClip[]) {
  let variants = templates.get(scene);
  if (!variants) { variants = new Map(); templates.set(scene, variants); }
  const key = `${faction}/${type}`;
  if (variants.has(key)) return variants.get(key)!;
  const f = FACTIONS[faction], source = clone(scene) as THREE.Group;
  const materials = new Map<THREE.Material, THREE.Material>();
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true; object.receiveShadow = true;
    const isArray = Array.isArray(object.material);
    const recoloured = (isArray ? object.material as THREE.Material[] : [object.material as THREE.Material]).map(original => {
      if (materials.has(original)) return materials.get(original)!;
      const material = original.clone() as THREE.MeshStandardMaterial;
      if (material.color) {
        const name = material.name.toLowerCase();
        if (type === 'tank') {
          // Original olive hull panels; leave tracks, optics and rubber dark.
          if (/001|005/.test(name)) material.color.set(f.armor);
        } else if (faction === 'aster') {
          if (/003|soldier_clothes|soldier_fabric/i.test(name)) material.color.set(f.uniform);
          if (/002|soldier_armor|soldier_elements/i.test(name)) material.color.set(f.kit);
          if (/soldier_metal|soldier_iron/i.test(name)) material.metalness = 0.6;
        } else {
          if (name === 'swat') material.color.set(f.uniform);
          if (name === 'swat_black') material.color.set(f.kit);
        }
        material.roughness = 0.9;
      }
      materials.set(original, material);
      return material;
    });
    object.material = isArray ? recoloured : recoloured[0];
  });
  // The tank's turret is cut out of the single hull mesh so it can turn on its own.
  if (type === 'tank') splitTurret(source);
  // Sample the gun-ready animation before measuring a skinned character.
  if (type === 'infantry' && animations.length) {
    const mixer = new THREE.AnimationMixer(source);
    const clip = animations.find(a => /Idle_Gun_Pointing$/.test(a.name)) ?? animations[0];
    mixer.clipAction(clip).play(); mixer.update(0);
  }
  const oriented = new THREE.Group();
  // Simulation yaw zero faces +X. Each source model has its own forward axis:
  // the tank's gun points along -X in its file (measured from the GLB), so it
  // turns half round; the riflemen face +-Z and turn a quarter.
  // The Aster soldier's own file faces the other way, but its retargeted clips
  // turn it to face like the Vostran soldier whose motion they come from.
  source.rotation.y += type === 'tank' ? Math.PI : faction === 'aster' && !animations.length ? -Math.PI / 2 : Math.PI / 2;
  oriented.add(source); oriented.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(oriented, true);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = type === 'infantry' ? 0.27 / size.y : 0.83 / Math.max(size.x, size.z);
  oriented.scale.setScalar(scale);
  oriented.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2);
  const result = new THREE.Group(); result.add(oriented);
  result.updateMatrixWorld(true);
  const pivot = result.getObjectByName('turret-pivot');
  if (pivot) {
    // Turret ring centre in model space, where the turret-mounted details turn.
    const at = pivot.getWorldPosition(new THREE.Vector3());
    result.userData.turret = { x: at.x, y: at.y, z: at.z, scale };
  }
  variants.set(key, result);
  return result;
}

/** One Aster clip set per loaded pair: the Quaternius clips baked onto the Mixamo skeleton. */
const retargeted = new WeakMap<THREE.Object3D, THREE.AnimationClip[]>();
function infantryClips(faction: FactionId, own: { scene: THREE.Group; animations: THREE.AnimationClip[] }, source: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
  if (faction !== 'aster' || own.animations.length) return own.animations;
  let clips = retargeted.get(own.scene);
  if (!clips) {
    clips = retargetClips(clone(own.scene), clone(source.scene), source.animations, QUATERNIUS_TO_MIXAMO);
    retargeted.set(own.scene, clips);
  }
  return clips;
}

/** Prone pose offset (model space): the held combat-roll frame, centred over the unit and resting on the ground. */
const proneOffsets = new WeakMap<THREE.AnimationClip, THREE.Vector3>();
function proneOffset(model: THREE.Object3D, roll: THREE.AnimationClip) {
  let offset = proneOffsets.get(roll);
  if (!offset) {
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(roll); action.play(); mixer.setTime(roll.duration * PRONE_AT);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2 + .02, -box.min.y + .002, -(box.min.z + box.max.z) / 2);
    action.stop(); mixer.uncacheRoot(model);
    proneOffsets.set(roll, offset);
  }
  return offset;
}

/** Bones the rifle hold and the stride measurement use, per rig (GLTF strips ':' and '.' from names). */
const san = THREE.PropertyBinding.sanitizeNodeName;
const RIGS: Record<FactionId, { hips: string; neck: string; right: string[]; left: string[]; feet: string[] }> = {
  aster: {
    hips: 'mixamorig:Hips', neck: 'mixamorig:Neck', feet: ['mixamorig:LeftFoot', 'mixamorig:RightFoot'],
    right: ['mixamorig:RightArm', 'mixamorig:RightForeArm', 'mixamorig:RightHand'],
    left: ['mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftHand'],
  },
  vostran: {
    hips: 'Hips', neck: 'Neck', feet: ['Foot.L', 'Foot.R'],
    right: ['UpperArm.R', 'LowerArm.R', 'Wrist.R'], left: ['UpperArm.L', 'LowerArm.L', 'Wrist.L'],
  },
};

/**
 * How the rifle is held, in the torso's frame (forward, up, right): the grip
 * (right hand) relative to the middle of the shoulders, in arm lengths, and
 * the barrel direction. Elbow poles say which way each elbow bends. The left
 * hand holds the handguard, 0.4 arm lengths up the barrel. Lying prone the
 * torso's "up" runs along the ground towards the head.
 */
type Triple = [number, number, number];
interface Hold { grip: Triple; barrel: Triple; poleR: Triple; poleL: Triple }
const HOLDS: Record<'ready' | 'run' | 'aim' | 'prone', Hold> = {
  ready: { grip: [.55, -.62, .2], barrel: [.86, -.44, -.2], poleR: [-.3, -1, .7], poleL: [0, -1, -.4] },
  run: { grip: [.5, -.6, .24], barrel: [.74, .3, -.6], poleR: [-.3, -1, .7], poleL: [0, -1, -.3] },
  aim: { grip: [.5, -.14, .24], barrel: [1, -.03, -.03], poleR: [-.2, -.5, 1], poleL: [.1, -1, -.35] },
  prone: { grip: [.12, .6, .2], barrel: [.06, 1, -.05], poleR: [1, 0, .7], poleL: [1, 0, -.7] },
};
/** Rifle model geometry along its barrel (FactionWeapon: 0.15 long, centred): grip, handguard. */
const RIFLE_GRIP = -.0045, RIFLE_DROP = .01;

/**
 * Soldier: an animation state machine over the Quaternius clip set (the Aster
 * soldier gets the same clips retargeted to its skeleton). The legs play the
 * walk, run, strafe or back-pedal clip matching the direction of travel, at
 * the speed where the planted feet stay put (measured from each clip's
 * stride). The clips hold a pistol one-handed, so the arms are posed on top
 * by IK: both hands on the rifle, at low ready, across the chest on the run,
 * shouldered when aiming or firing (with recoil), along the ground when
 * prone. A flinch when hit, the death fall (the rifle stays in the hand).
 */
function ImportedInfantry({ faction, unit, scale = 1 }: { faction: FactionId; unit?: Unit; scale?: number }) {
  const loaded = useGLTF(FACTION_MODEL_PATHS[faction].infantry);
  const source = useGLTF(ANIMATION_SOURCE);
  const clips = useMemo(() => infantryClips(faction, loaded, source), [faction, loaded, source]);
  const model = useMemo(() => clone(templateFor(loaded.scene, faction, 'infantry', clips)), [loaded, faction, clips]);
  const poseRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const rig = useMemo(() => {
    const r = RIGS[faction], bone = (n: string) => model.getObjectByName(san(n)) ?? null;
    const right = r.right.map(bone), left = r.left.map(bone), hips = bone(r.hips), neck = bone(r.neck);
    if (right.some(b => !b) || left.some(b => !b) || !hips || !neck) return null;
    const mount = new THREE.Group();
    mount.name = 'rifle-mount';
    model.add(mount);
    return { right: right as THREE.Object3D[], left: left as THREE.Object3D[], hips, neck, mount, attached: false };
  }, [model, faction]);
  const anim = useMemo(() => {
    const mixer = new THREE.AnimationMixer(model);
    const get = (name: string) => clips.find(c => c.name === name || c.name.endsWith('|' + name));
    const action = (name: string, once = false) => {
      const clip = get(name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      return a;
    };
    const roll = get('Roll');
    const prone = roll ? mixer.clipAction(roll) : null;
    const offset = roll ? proneOffset(clone(model), roll) : new THREE.Vector3();
    const idle = action('Idle_Gun') ?? action('Idle_Gun_Pointing') ?? (clips[0] ? mixer.clipAction(clips[0]) : null);
    if (idle) { idle.play(); mixer.update(0); }
    const feet = RIGS[faction].feet;
    const stride = (a: THREE.AnimationAction | null, axis: 'x' | 'z') => a ? strideSpeed(model, a.getClip(), feet, axis) : .45;
    const walk = action('Walk'), run = action('Run'), runShoot = action('Run_Shoot');
    const back = action('Run_Back'), leftward = action('Run_Left'), rightward = action('Run_Right');
    return {
      mixer, idle, aim: action('Idle_Gun_Pointing'), walk, run, runShoot, back, leftward, rightward,
      shoot: action('Idle_Gun_Shoot', true) ?? action('Gun_Shoot', true), hit: action('HitRecieve', true), death: action('Death', true),
      prone, offset, current: idle, lastFire: unit?.lastFireTime ?? 0, lastHit: unit?.lastDamageTime ?? 0, shotAt: -99, hitAt: -99, clock: 0,
      speeds: new Map<THREE.AnimationAction | null, number>([[walk, stride(walk, 'x')], [run, stride(run, 'x')], [runShoot, stride(runShoot, 'x')],
        [back, stride(back, 'x')], [leftward, stride(leftward, 'z')], [rightward, stride(rightward, 'z')]]),
      running: false, recoil: 0, ik: 1, hold: { ...HOLDS.ready, grip: [...HOLDS.ready.grip] as Triple, barrel: [...HOLDS.ready.barrel] as Triple,
        poleR: [...HOLDS.ready.poleR] as Triple, poleL: [...HOLDS.ready.poleL] as Triple },
    };
    // unit is read for its starting fire/damage times only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, clips, faction]);
  useEffect(() => () => { anim.mixer.stopAllAction(); anim.mixer.uncacheRoot(model); }, [anim, model]);
  // Per-frame scratch space.
  const tmp = useMemo(() => ({ inv: new THREE.Matrix4(), m: new THREE.Matrix4(), sr: new THREE.Vector3(), sl: new THREE.Vector3(), hip: new THREE.Vector3(),
    nk: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3(), mid: new THREE.Vector3(), grip: new THREE.Vector3(),
    barrel: new THREE.Vector3(), up: new THREE.Vector3(), side: new THREE.Vector3(), hand: new THREE.Vector3(), pole: new THREE.Vector3(),
    world: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  useFrame((_, dt) => {
    const a = anim, step = animStep(dt);
    if (!a.idle) return;
    a.clock += step;
    const now = a.clock;
    let shot = false;
    if (unit) {
      if (unit.lastFireTime !== a.lastFire) { a.lastFire = unit.lastFireTime; a.shotAt = now; shot = true; }
      if (unit.lastDamageTime !== a.lastHit) { a.lastHit = unit.lastDamageTime; a.hitAt = now; }
    }
    // Ground speed in model units per second (the unit group scales the 0.27-tall model by `scale`).
    const speed = unit ? Math.hypot(unit.vel.x, unit.vel.y) : 0;
    const v = speed / CELL_SIZE / Math.max(.01, scale);
    const moving = speed > 1;
    // Direction of travel relative to where the soldier faces (he keeps facing a target while moving).
    const rel = unit && moving ? angleDelta(Math.atan2(unit.vel.y, unit.vel.x) - unit.facing) : 0;
    const down = !!unit && unit.alive && !moving && (unit.prone || (unit.inCover && !unit.targetPos));
    if (a.running ? v < .27 : v > .3) a.running = !a.running;
    let want = a.idle, restart = false;
    if (unit && !unit.alive && a.death) want = a.death;
    else if (down && a.prone) want = a.prone;
    else if (now - a.hitAt < .45 && a.hit) want = a.hit;
    else if (moving) {
      const firing = now - a.shotAt < 1.2;
      if (Math.abs(rel) > 2.2) want = (a.running ? a.back : a.walk) ?? a.walk ?? a.idle;
      else if (Math.abs(rel) > .96) want = (rel > 0 ? a.rightward : a.leftward) ?? a.walk ?? a.idle;
      else want = (a.running ? (firing && a.runShoot ? a.runShoot : a.run) : a.walk) ?? a.walk ?? a.run ?? a.idle;
    }
    else if (now - a.shotAt < .5 && a.shoot) { want = a.shoot; restart = shot; }
    else if (unit && (unit.aiming || unit.engaging || unit.attackTarget) && a.aim) want = a.aim;
    if (want !== a.current || restart) {
      if (want !== a.current) a.current?.fadeOut(.18);
      want.reset().setEffectiveWeight(1).fadeIn(restart ? .04 : .18).play();
      if (want === a.prone) { want.time = want.getClip().duration * PRONE_AT; want.paused = true; }
      a.current = want;
    }
    // Leg cadence from ground speed, so the planted feet do not slide (the
    // walk played backwards when stepping back slowly). Above the clip range
    // the stride is capped: quicker than that only looks frantic.
    const natural = a.speeds.get(want);
    if (natural) {
      const backwards = want === a.walk && Math.abs(rel) > 2.2;
      const ts = Math.min(want === a.walk ? 1.7 : 3.2, Math.max(want === a.walk ? .45 : .6, v / natural));
      want.timeScale = backwards ? -ts : ts;
    }
    a.mixer.update(step);
    // The held prone frame comes from a moving roll: centre it on the unit and lay it on the ground.
    const pose = poseRef.current;
    if (pose) {
      const k = Math.min(1, step * 6), proneNow = want === a.prone;
      pose.position.lerp(proneNow ? a.offset : ZERO, k);
    }
    if (!rig) return;
    if (shot) a.recoil = 1;
    a.recoil *= Math.exp(-step * 16);
    const dead = !!unit && !unit.alive;
    if (dead && !rig.attached) {
      // The rifle goes down with the soldier, in his right hand.
      model.updateWorldMatrix(true, true);
      rig.right[2].attach(rig.mount);
      rig.attached = true;
    }
    a.ik = dead ? Math.max(0, a.ik - step * 4) : 1;
    if (a.ik <= 0) return;
    model.getWorldPosition(tmp.world);
    // Arms are only posed where you can see them.
    if (tmp.world.distanceToSquared(camera.position) > 45 * 45) return;
    // Shouldered whenever he has a target, also on the move; across the chest when running.
    const engaged = !!unit && (unit.aiming || unit.engaging || now - a.shotAt < 1.2);
    const holdName = want === a.prone ? 'prone'
      : want === a.aim || want === a.shoot || want === a.runShoot || (moving && engaged) ? 'aim'
      : moving && a.running ? 'run' : 'ready';
    const target = HOLDS[holdName], h = a.hold, k = 1 - Math.exp(-step * 10);
    for (const key of ['grip', 'barrel', 'poleR', 'poleL'] as const) for (let i = 0; i < 3; i++) h[key][i] += (target[key][i] - h[key][i]) * k;
    // Torso frame from the animated skeleton, in model space.
    model.updateWorldMatrix(true, true);
    const inv = tmp.inv.copy(model.matrixWorld).invert();
    const sr = tmp.sr.setFromMatrixPosition(rig.right[0].matrixWorld).applyMatrix4(inv);
    const sl = tmp.sl.setFromMatrixPosition(rig.left[0].matrixWorld).applyMatrix4(inv);
    const hip = tmp.hip.setFromMatrixPosition(rig.hips.matrixWorld).applyMatrix4(inv);
    const nk = tmp.nk.setFromMatrixPosition(rig.neck.matrixWorld).applyMatrix4(inv);
    const r = tmp.r.subVectors(sr, sl).normalize();
    const u = tmp.u.subVectors(nk, hip);
    u.addScaledVector(r, -u.dot(r)).normalize();
    const f = tmp.f.crossVectors(u, r).normalize();
    const L = armLength(rig.right, inv, tmp);
    const local = (t: Triple, out: THREE.Vector3) => out.set(0, 0, 0).addScaledVector(f, t[0]).addScaledVector(u, t[1]).addScaledVector(r, t[2]);
    const mid = tmp.mid.addVectors(sr, sl).multiplyScalar(.5);
    const barrel = local(h.barrel, tmp.barrel).addScaledVector(u, .25 * a.recoil).normalize();
    const grip = local(h.grip, tmp.grip).multiplyScalar(L).add(mid).addScaledVector(f, -.1 * L * a.recoil);
    const up = tmp.up.copy(u).addScaledVector(barrel, -u.dot(barrel)).normalize();
    const side = tmp.side.crossVectors(barrel, up);
    // Rifle in model space: barrel along +x, top along +y (in the hand once he falls).
    if (!rig.attached) {
      tmp.m.makeBasis(barrel, up, side);
      rig.mount.quaternion.setFromRotationMatrix(tmp.m);
      rig.mount.position.copy(grip).addScaledVector(barrel, -RIFLE_GRIP).addScaledVector(up, RIFLE_DROP);
    }
    const toWorld = (p: THREE.Vector3) => p.applyMatrix4(model.matrixWorld);
    const pole = (t: Triple) => local(t, tmp.pole).transformDirection(model.matrixWorld);
    reachFor(rig.right[0], rig.right[1], rig.right[2], toWorld(tmp.hand.copy(grip)), pole(h.poleR), a.ik);
    const support = tmp.hand.copy(grip).addScaledVector(barrel, .4 * L).addScaledVector(up, .004);
    reachFor(rig.left[0], rig.left[1], rig.left[2], toWorld(support), pole(h.poleL), a.ik);
  });
  return <group name={`faction-model-${faction}-infantry`} userData={{ faction, unitType: 'infantry', imported: true }} dispose={null}>
    <group ref={poseRef}><primitive object={model} /></group>
    {rig && createPortal(<FactionWeapon faction={faction} />, rig.mount)}
  </group>;
}
const ZERO = new THREE.Vector3();

/**
 * Tank: the turret turns towards the target at a realistic traverse rate and
 * returns forward when there is none; each shot kicks the turret back and
 * rocks the hull. Turret-mounted details turn with it.
 */
function ImportedTank({ faction, unit, aimAt, wrecked }: { faction: FactionId; unit?: Unit; aimAt?: AimResolver; wrecked?: boolean }) {
  const loaded = useGLTF(FACTION_MODEL_PATHS[faction].tank);
  const model = useMemo(() => clone(templateFor(loaded.scene, faction, 'tank', loaded.animations)), [loaded, faction]);
  const parts = useMemo(() => {
    const pivot = model.getObjectByName('turret-pivot') ?? null;
    const turret = pivot?.getObjectByName('turret') ?? null;
    const info = model.userData.turret as { x: number; y: number; z: number; scale: number } | undefined;
    return { pivot, turret, base: turret?.position.clone() ?? new THREE.Vector3(), info };
  }, [model]);
  const detail = useRef<THREE.Group>(null), detailKick = useRef<THREE.Group>(null), rock = useRef<THREE.Group>(null);
  const state = useRef({ yaw: 0, recoil: 0, lastFire: unit?.lastFireTime ?? 0, wreckYaw: .6 + Math.random() * 1.6 });
  useFrame((_, dt) => {
    const s = state.current, step = animStep(dt);
    if (wrecked) { s.yaw = s.wreckYaw; s.recoil = 0; }
    else {
      const target = unit && aimAt?.(unit);
      const goal = target ? angleDelta(Math.atan2(target.y - unit!.pos.y, target.x - unit!.pos.x) - unit!.facing) : 0;
      const d = angleDelta(goal - s.yaw);
      s.yaw += Math.max(-1.3 * step, Math.min(1.3 * step, d));
      if (unit && unit.lastFireTime !== s.lastFire) { s.lastFire = unit.lastFireTime; s.recoil = 1; }
      s.recoil = Math.max(0, s.recoil - step * 3.2);
    }
    // Fast kick back, slower run-out.
    const kick = s.recoil > .8 ? (1 - s.recoil) / .2 : s.recoil / .8;
    if (parts.pivot) parts.pivot.rotation.y = -s.yaw;
    if (parts.turret) parts.turret.position.x = parts.base.x + kick * .32;
    if (detail.current) detail.current.rotation.y = -s.yaw;
    if (detailKick.current && parts.info) detailKick.current.position.x = -kick * .32 * parts.info.scale;
    if (rock.current) rock.current.rotation.z = kick * .03;
  });
  const t = parts.info;
  return <group name={`faction-model-${faction}-tank`} userData={{ faction, unitType: 'tank', imported: true }} dispose={null}>
    <group ref={rock}>
      <primitive object={model} />
      <TankDetails faction={faction} />
      <group ref={detail} position={t ? [t.x, 0, t.z] : [-.13, 0, 0]}>
        <group ref={detailKick}><group position={t ? [-t.x, 0, -t.z] : [.13, 0, 0]}>
          <TankTurretDetails faction={faction} />
          {faction === 'aster' && <group>
            {/* Western-style angular turret bustle over the licensed base hull. */}
            <Block at={[-0.06, 0.22, 0]} size={[0.31, 0.105, 0.29]} color={FACTIONS.aster.armor} />
            <Block at={[-0.16, 0.245, 0]} size={[0.12, 0.07, 0.32]} color="#3e4a39" />
          </group>}
        </group></group>
      </group>
      {faction === 'aster' && [-1, 1].map(side => <Block key={side} at={[-0.06, 0.095, side * 0.205]} size={[0.48, 0.08, 0.018]} color={FACTIONS.aster.armor} />)}
    </group>
  </group>;
}

/** Original faction-specific APC geometry: high western cabin vs low eastern boat hull. Wheels roll with speed; the weapon station tracks targets. */
function Carrier({ faction, unit, aimAt, scale = .6, wrecked }: { faction: FactionId; unit?: Unit; aimAt?: AimResolver; scale?: number; wrecked?: boolean }) {
  const f = FACTIONS[faction], eastern = faction === 'vostran';
  const hull = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.36, 0.10); shape.lineTo(0.27, 0.10); shape.lineTo(0.39, 0.18);
    shape.lineTo(0.26, eastern ? 0.25 : 0.32); shape.lineTo(-0.28, eastern ? 0.25 : 0.32);
    shape.lineTo(-0.36, 0.18); shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.31, bevelEnabled: false });
    g.translate(0, 0, -0.155); g.computeVertexNormals(); return g;
  }, [eastern]);
  useEffect(() => () => hull.dispose(), [hull]);
  const wheels = useRef<(THREE.Group | null)[]>([]), station = useRef<THREE.Group>(null), turret = useRef<THREE.Group>(null);
  const state = useRef({ roll: 0, yaw: 0 });
  useFrame((_, dt) => {
    if (wrecked || !unit) return;
    const s = state.current, step = animStep(dt);
    // Wheel radius .087 model units; unit speed px/s -> cells/s -> model units/s.
    const forward = (unit.vel.x * Math.cos(unit.facing) + unit.vel.y * Math.sin(unit.facing)) / 32 / scale;
    s.roll -= forward * step / .087;
    for (const w of wheels.current) if (w) w.rotation.z = s.roll;
    const target = aimAt?.(unit);
    const goal = target ? angleDelta(Math.atan2(target.y - unit.pos.y, target.x - unit.pos.x) - unit.facing) : 0;
    s.yaw += Math.max(-2 * step, Math.min(2 * step, angleDelta(goal - s.yaw)));
    if (station.current) station.current.rotation.y = -s.yaw;
    if (turret.current) turret.current.rotation.y = -s.yaw;
  });
  const cx = eastern ? 0.08 : -0.03;
  return <group name={`faction-model-${faction}-apc`} userData={{ faction, unitType: 'apc' }}>
    <mesh geometry={hull} castShadow receiveShadow><meshStandardMaterial color={f.armor} roughness={0.9} /></mesh>
    {[-0.25, -0.09, 0.09, 0.25].flatMap((x, i) => [-1, 1].map(side => <group key={`${i}/${side}`} position={[x, 0.105, side * 0.18]}
      ref={el => { wheels.current[i * 2 + (side + 1) / 2] = el; }}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.087, 0.087, 0.065, 12]} /><meshStandardMaterial color="#242824" roughness={1} /></mesh>
      <mesh position={[0, 0, side * 0.037]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.043, 0.043, 0.008, 10]} /><meshStandardMaterial color={f.kit} roughness={0.8} /></mesh>
      {/* Hub bolts make the wheel's turning visible. */}
      {[0, 1, 2].map(k => <mesh key={k} position={[Math.cos(k * 2.09) * .028, Math.sin(k * 2.09) * .028, side * 0.042]}><boxGeometry args={[.012, .012, .006]} /><meshStandardMaterial color="#1d211d" /></mesh>)}
    </group>))}
    <group ref={turret} position={[cx, 0, 0]}><group position={[-cx, 0, 0]}>
      <mesh position={[cx, eastern ? 0.275 : 0.355, 0]} castShadow>
        <cylinderGeometry args={[eastern ? 0.065 : 0.055, 0.085, 0.065, eastern ? 10 : 4]} /><meshStandardMaterial color={f.kit} roughness={0.85} />
      </mesh>
      <Block at={[0.16, eastern ? 0.29 : 0.385, 0]} size={[eastern ? 0.21 : 0.13, 0.014, 0.015]} color="#262d27" />
    </group></group>
    <Block at={[-0.32, 0.18, 0]} size={[0.012, 0.12, 0.21]} color={f.kit} />
    <Block at={[-0.25, 0.36, -0.11]} size={[0.005, 0.24, 0.005]} color="#282e26" />
    {[-1, 1].map(side => <Block key={side} at={[0.29, 0.205, side * 0.10]} size={[0.02, 0.025, 0.035]} color="#d6c9a0" />)}
    <CarrierDetails faction={faction} />
    <group ref={station} position={[.09, 0, 0]}><group position={[-.09, 0, 0]}><CarrierTurretDetails faction={faction} /></group></group>
  </group>;
}

/** Helicopter: rotors spin, the nose dips into forward flight, it banks into turns and bobs in the hover. */
function Helicopter({ faction, unit, wrecked }: { faction: FactionId; unit?: Unit; wrecked?: boolean }) {
  const f = FACTIONS[faction], eastern = faction === 'vostran';
  const rotor = useRef<THREE.Group>(null), tail = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null);
  const state = useRef({ pitch: 0, bank: 0, facing: unit?.facing ?? 0, t: Math.random() * 10 });
  useFrame((_, dt) => {
    const s = state.current, step = animStep(dt);
    if (wrecked) {
      if (body.current) { body.current.position.y = .05; body.current.rotation.set(.35, 0, .5); }
      return;
    }
    if (rotor.current) rotor.current.rotation.y += step * 30;
    if (tail.current) tail.current.rotation.z += step * 40;
    s.t += step;
    const forward = unit ? (unit.vel.x * Math.cos(unit.facing) + unit.vel.y * Math.sin(unit.facing)) / Math.max(1, unit.speed) : 0;
    const turnRate = unit ? angleDelta(unit.facing - s.facing) / Math.max(step, 1e-3) : 0;
    if (unit) s.facing = unit.facing;
    s.pitch += (-Math.max(-.2, Math.min(.25, forward * .22)) - s.pitch) * Math.min(1, step * 2.5);
    s.bank += (Math.max(-.35, Math.min(.35, turnRate * .25)) - s.bank) * Math.min(1, step * 2.5);
    if (body.current) {
      body.current.position.y = 1.5 + Math.sin(s.t * 1.7) * .03;
      body.current.rotation.order = 'YZX';
      body.current.rotation.set(s.bank, 0, s.pitch);
    }
  });
  return <group name={`faction-model-${faction}-helicopter`} userData={{ faction, unitType: 'helicopter' }}>
    <group ref={body} position={[0, 1.5, 0]}>
      <mesh scale={[eastern ? 0.31 : 0.27, eastern ? 0.11 : 0.09, 0.10]} castShadow><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color={f.armor} roughness={0.85} /></mesh>
      <mesh position={[0.18, 0.015, 0]} scale={[0.13, 0.08, 0.083]} castShadow><sphereGeometry args={[1, 10, 7]} /><meshStandardMaterial color="#283e3e" roughness={0.4} /></mesh>
      <Block at={[-0.34, 0.015, 0]} size={[0.42, 0.035, 0.035]} color={f.armor} />
      <Block at={[-0.53, 0.07, 0]} size={[0.045, 0.15, 0.02]} color={f.armor} />
      <group ref={rotor} position={[0, 0.15, 0]}>
        {[0, Math.PI / 2].map(angle => <Block key={angle} at={[0, 0, 0]} rotation={[0, angle, 0]} size={[0.94, 0.009, 0.025]} color="#30372f" />)}
      </group>
      <group ref={tail} position={[-0.54, 0.08, 0.025]}><Block at={[0, 0, 0]} size={[0.025, 0.18, 0.008]} color="#242d26" /></group>
      {eastern ? [-1, 1].map(side => <group key={side}>
        <Block at={[-0.04, -0.015, side * 0.15]} size={[0.14, 0.015, 0.19]} color={f.armor} />
        <mesh position={[-0.1, -0.12, side * 0.10]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.025, 8]} /><meshStandardMaterial color="#232b25" /></mesh>
      </group>) : [-1, 1].map(side => <Block key={side} at={[0, -0.12, side * 0.09]} size={[0.42, 0.015, 0.018]} color="#30382f" />)}
      <HelicopterDetails faction={faction} />
    </group>
  </group>;
}

function Fallback({ faction, type }: { faction: FactionId; type: UnitType }) {
  const f = FACTIONS[faction];
  if (type === 'infantry') return <group>
    <Block at={[0, 0.14, 0]} size={[0.07, 0.14, 0.07]} color={f.uniform} />
    <mesh position={[0, 0.24, 0]}><sphereGeometry args={[0.04, 8, 6]} /><meshStandardMaterial color={f.kit} /></mesh>
    <group position={[0.06, 0.17, 0]}><Rifle eastern={faction === 'vostran'} /></group>
  </group>;
  return <group><Block at={[0, 0.12, 0]} size={[0.65, 0.17, 0.38]} color={f.armor} /><Block at={[0.03, 0.24, 0]} size={[0.26, 0.12, 0.25]} color={f.kit} /><Block at={[0.28, 0.25, 0]} size={[0.4, 0.02, 0.02]} color="#29332b" /></group>;
}

/**
 * A destroyed vehicle: its own model burnt black (materials replaced on this
 * copy only), with a rising smoke column and, at first, flames.
 */
function Wreck({ children, height = .35 }: { children: React.ReactNode; height?: number }) {
  const group = useRef<THREE.Group>(null);
  const burnt = useMemo(() => new Map<THREE.Material, THREE.Material>(), []);
  useFrame(() => {
    // Models load asynchronously: burn any newly appeared mesh.
    group.current?.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.burnt) return;
      const swap = (m: THREE.Material) => {
        let b = burnt.get(m);
        if (!b) {
          b = new THREE.MeshStandardMaterial({ color: '#1f1c19', roughness: 1, metalness: .05 });
          burnt.set(m, b);
        }
        return b;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
      mesh.userData.burnt = true;
    });
  });
  useEffect(() => () => burnt.forEach(m => m.dispose()), [burnt]);
  return <group>
    <group ref={group}>{children}</group>
    <WreckSmoke height={height} />
  </group>;
}

const smokeGeometry = new THREE.SphereGeometry(1, 8, 6);
function WreckSmoke({ height }: { height: number }) {
  const puffs = useMemo(() => Array.from({ length: 7 }, (_, i) => ({
    mesh: new THREE.Mesh(smokeGeometry, new THREE.MeshBasicMaterial({ color: '#2b2825', transparent: true, depthWrite: false, opacity: 0 })),
    age: i / 7, drift: Math.random() * Math.PI * 2,
  })), []);
  const fire = useMemo(() => new THREE.Mesh(smokeGeometry, new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, depthWrite: false, opacity: .8 })), []);
  const age = useRef(0);
  useEffect(() => () => { puffs.forEach(p => (p.mesh.material as THREE.Material).dispose()); (fire.material as THREE.Material).dispose(); }, [puffs, fire]);
  useFrame((_, dt) => {
    const step = animStep(dt);
    const life = (age.current += step);
    // Thick black smoke at first, thinning over a minute and a half.
    const strength = Math.max(.15, 1 - life / 90);
    for (const p of puffs) {
      p.age += step / 4.5;
      if (p.age > 1) { p.age -= 1; p.drift = Math.random() * Math.PI * 2; }
      const a = p.age, r = .07 + a * .38;
      p.mesh.position.set(Math.cos(p.drift) * a * .25, height + a * 1.6, Math.sin(p.drift) * a * .25);
      p.mesh.scale.setScalar(r);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.PI * Math.min(1, a * 1.15)) * .5 * strength;
    }
    const flames = Math.max(0, 1 - life / 25);
    fire.visible = flames > 0;
    if (flames > 0 && step > 0) {
      fire.position.set(0, height * .8, 0);
      fire.scale.setScalar(.04 + (.03 + Math.random() * .03) * flames);
      (fire.material as THREE.MeshBasicMaterial).opacity = (.4 + Math.random() * .3) * Math.min(1, flames * 2);
    }
  });
  return <group>{puffs.map((p, i) => <primitive key={i} object={p.mesh} />)}<primitive object={fire} /></group>;
}

export function FactionUnitModel({ faction, type, unit, aimAt, scale, wrecked }: {
  faction: FactionId; type: UnitType; unit?: Unit; aimAt?: AimResolver; scale?: number; wrecked?: boolean;
}) {
  let model: React.ReactNode;
  if (type === 'apc') model = <Carrier faction={faction} unit={unit} aimAt={aimAt} scale={scale} wrecked={wrecked} />;
  else if (type === 'helicopter') model = <Helicopter faction={faction} unit={unit} wrecked={wrecked} />;
  else {
    const fallback = <Fallback faction={faction} type={type} />;
    model = <ModelBoundary fallback={fallback}><Suspense fallback={fallback}>
      {type === 'infantry' ? <ImportedInfantry faction={faction} unit={unit} scale={scale} /> : <ImportedTank faction={faction} unit={unit} aimAt={aimAt} wrecked={wrecked} />}
    </Suspense></ModelBoundary>;
  }
  return wrecked && type !== 'infantry' ? <Wreck height={type === 'helicopter' ? .2 : .35}>{model}</Wreck> : <>{model}</>;
}

export function FactionPreview({ faction }: { faction: FactionId }) {
  return <Canvas orthographic frameloop="demand" dpr={[1, 1.5]} camera={{ position: [1.3, 1, 1.6], zoom: 150, near: 0.1, far: 50 }} gl={{ alpha: true, antialias: true }}>
    <ambientLight intensity={1.4} /><directionalLight position={[2, 4, 3]} intensity={3} />
    <group position={[-0.28, -0.12, 0]} rotation={[0, -0.3, 0]}><FactionUnitModel faction={faction} type="tank" /></group>
    <group position={[0.36, -0.12, -0.1]} rotation={[0, -0.3, 0]} scale={0.8}><FactionUnitModel faction={faction} type="apc" /></group>
    <group position={[0.25, -0.12, 0.22]} scale={1.6}><FactionUnitModel faction={faction} type="infantry" /></group>
  </Canvas>;
}
