import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, createPortal, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FACTIONS, FactionId } from '../game/factions';
import type { Unit, UnitType } from '../game/types';

const asset = (name: string) => `${import.meta.env.BASE_URL}assets/factions/${name}.glb`;
const FACTION_MODEL_PATHS = {
  aster: { infantry: asset('coalition-rifleman'), tank: asset('tank-hull') },
  vostran: { infantry: asset('union-rifleman'), tank: asset('tank-hull') },
};

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
          if (/003/.test(name)) material.color.set(f.uniform);
          if (/002/.test(name)) material.color.set(f.kit);
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
  source.rotation.y += type === 'tank' ? Math.PI : faction === 'aster' ? -Math.PI / 2 : Math.PI / 2;
  oriented.add(source); oriented.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(oriented, true);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = type === 'infantry' ? 0.27 / size.y : 0.83 / Math.max(size.x, size.z);
  oriented.scale.setScalar(scale);
  oriented.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2);
  const result = new THREE.Group(); result.add(oriented);
  variants.set(key, result);
  return result;
}

function ImportedModel({ faction, type, unit }: { faction: FactionId; type: 'infantry' | 'tank'; unit?: Unit }) {
  const loaded = useGLTF(FACTION_MODEL_PATHS[faction][type]);
  const model = useMemo(() => clone(templateFor(loaded.scene, faction, type, loaded.animations)), [loaded, faction, type]);
  const animation = useMemo(() => {
    if (type !== 'infantry' || !loaded.animations.length) return null;
    const mixer = new THREE.AnimationMixer(model);
    const idleClip = loaded.animations.find(a => /Idle_Gun_Pointing$/.test(a.name)) ?? loaded.animations[0];
    const moveClip = loaded.animations.find(a => /Run$/.test(a.name)) ?? idleClip;
    const idle = mixer.clipAction(idleClip), move = mixer.clipAction(moveClip);
    idle.play(); mixer.update(0);
    return { mixer, idle, move, moving: false };
  }, [model, loaded, type]);
  const rifleMount = useMemo(() => {
    if (type !== 'infantry' || faction !== 'vostran') return null;
    const wrist = model.getObjectByName('Wrist.R');
    if (!wrist) return null;
    const mount = new THREE.Group();
    mount.position.set(0.065, 0.17, 0.028);
    model.add(mount); model.updateMatrixWorld(true);
    // Preserve the initial gun-ready placement while following the animated wrist.
    wrist.attach(mount);
    return mount;
  }, [model, type, faction]);
  useEffect(() => () => { animation?.mixer.stopAllAction(); animation?.mixer.uncacheRoot(model); }, [animation, model]);
  useFrame((_, dt) => {
    if (!animation) return;
    const moving = !!unit && Math.hypot(unit.vel.x, unit.vel.y) > 1;
    if (moving !== animation.moving && animation.move !== animation.idle) {
      (moving ? animation.idle : animation.move).fadeOut(0.18);
      (moving ? animation.move : animation.idle).reset().fadeIn(0.18).play();
      animation.moving = moving;
    }
    animation.mixer.update(Math.min(dt, 0.05));
  });
  return <group name={`faction-model-${faction}-${type}`} userData={{ faction, unitType: type, imported: true }} dispose={null}>
    <primitive object={model} />
    {rifleMount && createPortal(<Rifle eastern />, rifleMount)}
    {type === 'tank' && faction === 'aster' && <group>
      {/* Western-style angular turret bustle and side armour over the licensed base hull. */}
      <Block at={[-0.06, 0.22, 0]} size={[0.31, 0.105, 0.29]} color={FACTIONS.aster.armor} />
      <Block at={[-0.16, 0.245, 0]} size={[0.12, 0.07, 0.32]} color="#3e4a39" />
      {[-1, 1].map(side => <Block key={side} at={[-0.06, 0.095, side * 0.205]} size={[0.48, 0.08, 0.018]} color={FACTIONS.aster.armor} />)}
    </group>}
  </group>;
}

/** Original faction-specific APC geometry: high western cabin vs low eastern boat hull. */
function Carrier({ faction }: { faction: FactionId }) {
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
  return <group name={`faction-model-${faction}-apc`} userData={{ faction, unitType: 'apc' }}>
    <mesh geometry={hull} castShadow receiveShadow><meshStandardMaterial color={f.armor} roughness={0.9} /></mesh>
    {[-0.25, -0.09, 0.09, 0.25].flatMap((x, i) => [-1, 1].map(side => <group key={`${i}/${side}`}>
      <mesh position={[x, 0.105, side * 0.18]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.087, 0.087, 0.065, 12]} /><meshStandardMaterial color="#242824" roughness={1} /></mesh>
      <mesh position={[x, 0.105, side * 0.217]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.043, 0.043, 0.008, 10]} /><meshStandardMaterial color={f.kit} roughness={0.8} /></mesh>
    </group>))}
    <mesh position={[eastern ? 0.08 : -0.03, eastern ? 0.275 : 0.355, 0]} castShadow>
      <cylinderGeometry args={[eastern ? 0.065 : 0.055, 0.085, 0.065, eastern ? 10 : 4]} /><meshStandardMaterial color={f.kit} roughness={0.85} />
    </mesh>
    <Block at={[0.16, eastern ? 0.29 : 0.385, 0]} size={[eastern ? 0.21 : 0.13, 0.014, 0.015]} color="#262d27" />
    <Block at={[-0.32, 0.18, 0]} size={[0.012, 0.12, 0.21]} color={f.kit} />
    <Block at={[-0.25, 0.36, -0.11]} size={[0.005, 0.24, 0.005]} color="#282e26" />
    {[-1, 1].map(side => <Block key={side} at={[0.29, 0.205, side * 0.10]} size={[0.02, 0.025, 0.035]} color="#d6c9a0" />)}
  </group>;
}

function Helicopter({ faction }: { faction: FactionId }) {
  const f = FACTIONS[faction], eastern = faction === 'vostran';
  const rotor = useRef<THREE.Group>(null), tail = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (rotor.current) rotor.current.rotation.y += dt * 30; if (tail.current) tail.current.rotation.z += dt * 40; });
  return <group name={`faction-model-${faction}-helicopter`} userData={{ faction, unitType: 'helicopter' }} position={[0, 1.5, 0]}>
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

export function FactionUnitModel({ faction, type, unit }: { faction: FactionId; type: UnitType; unit?: Unit }) {
  if (type === 'apc') return <Carrier faction={faction} />;
  if (type === 'helicopter') return <Helicopter faction={faction} />;
  const fallback = <Fallback faction={faction} type={type} />;
  return <ModelBoundary fallback={fallback}><Suspense fallback={fallback}><ImportedModel faction={faction} type={type} unit={unit} /></Suspense></ModelBoundary>;
}

export function FactionPreview({ faction }: { faction: FactionId }) {
  return <Canvas orthographic frameloop="demand" dpr={[1, 1.5]} camera={{ position: [1.3, 1, 1.6], zoom: 150, near: 0.1, far: 50 }} gl={{ alpha: true, antialias: true }}>
    <ambientLight intensity={1.4} /><directionalLight position={[2, 4, 3]} intensity={3} />
    <group position={[-0.28, -0.12, 0]} rotation={[0, -0.3, 0]}><FactionUnitModel faction={faction} type="tank" /></group>
    <group position={[0.36, -0.12, -0.1]} rotation={[0, -0.3, 0]} scale={0.8}><FactionUnitModel faction={faction} type="apc" /></group>
    <group position={[0.25, -0.12, 0.22]} scale={1.6}><FactionUnitModel faction={faction} type="infantry" /></group>
  </Canvas>;
}
