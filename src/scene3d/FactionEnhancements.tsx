import React, { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { FactionId } from '../game/factions';

/**
 * Original faction-specific detail meshes. These are decorative and do not
 * change projectile collision, armour statistics or the simulation footprint.
 */
function Panel({ p, s, color, metalness = .15 }: {
  p: [number, number, number]; s: [number, number, number]; color: string; metalness?: number;
}) {
  return <mesh position={p} castShadow receiveShadow raycast={() => null}>
    <boxGeometry args={s} />
    <meshStandardMaterial color={color} roughness={.78} metalness={metalness} />
  </mesh>;
}
function Drum({ p, r = .03, depth = .07, color = '#252a27', rot = [Math.PI / 2, 0, 0] as [number, number, number] }: {
  p: [number, number, number]; r?: number; depth?: number; color?: string; rot?: [number, number, number];
}) {
  return <mesh position={p} rotation={rot} castShadow raycast={() => null}>
    <cylinderGeometry args={[r, r, depth, 10]} />
    <meshStandardMaterial color={color} roughness={.8} metalness={.28} />
  </mesh>;
}

export function TankDetails({ faction }: { faction: FactionId }) {
  const west = faction === 'aster';
  const base = west ? '#56634c' : '#6b6a4c';
  const panel = west ? '#748069' : '#83816a';
  const dark = '#313c35';
  return <group name={west ? 'Bastion-detailed-armour' : 'Volk-detailed-armour'}>
    {/* Separate side skirts and angled frontal armour break the toy silhouette. */}
    {[-1, 1].map(side => <group key={side}>
      <Panel p={[-.02, .115, side * .255]} s={[.72, .115, .022]} color={base} />
      {Array.from({ length: west ? 6 : 7 }, (_, i) =>
        <Panel key={i} p={[-.295 + i * (west ? .108 : .094), .139, side * .27]}
          s={[west ? .098 : .086, .075, .015]} color={i % 2 ? base : panel} />)}
      <Panel p={[-.25, .31, side * .16]} s={[.17, .055, .055]} color={base} />
      <Drum p={[-.24, .345, side * .163]} r={.04} depth={.06} color="#252d28" />
      {/* Front smoke grenade launchers, outward-canted in two clusters. */}
      {Array.from({ length: 3 }, (_, i) =>
        <Drum key={i} p={[.075 + i * .033, .35, side * (.135 + i * .016)]}
          r={.015} depth={.08} color={dark} rot={[0, side * .52, -.28]} />)}
      <Panel p={[-.335, .285, side * .09]} s={[.09, .07, .04]} color="#3e4841" />
      <Panel p={[-.35, .32, side * .095]} s={[.066, .022, .03]} color="#a8bfab" metalness={.35} />
    </group>)}
    {/* Small modular ERA bricks on upper hull. Distinct arrangement for each side. */}
    {Array.from({ length: 4 }, (_, i) => [-1, 1].map(side =>
      <Panel key={`${i}/${side}`} p={[.12 + i * .067, .253, side * .138]}
        s={[.059, .033, .105]} color={i % 2 ? base : panel} />))}
    <Drum p={[-.12, .405, 0]} r={west ? .065 : .083} depth={.025} rot={[0, 0, 0]} color={base} />
    <Panel p={[-.12, .43, 0]} s={[.09, .013, .11]} color={dark} />
    <Panel p={[.13, .395, -.10]} s={[.06, .048, .055]} color={dark} />
    <Panel p={[.157, .39, -.10]} s={[.009, .035, .036]} color="#7e9f9c" metalness={.42} />
    <Panel p={[-.24, .31, .0]} s={[.19, .06, .23]} color={base} />
    {/* Project-authored storage rack, optional western turret bustle. */}
    {west && <group>
      <Panel p={[-.28, .285, 0]} s={[.15, .08, .29]} color="#505b48" />
      {[-.15, .15].map(z => <Panel key={z} p={[-.28, .338, z]} s={[.14, .015, .014]} color="#242e2a" />)}
    </group>}
    {!west && <group>
      {/* Eastern circular turret silhouette and small external fuel drums. */}
      {[-1, 1].map(side =>
        <Drum key={side} p={[-.34, .18, side * .11]} r={.065} depth={.09} color="#59604c" rot={[0, 0, Math.PI / 2]} />)}
    </group>}
    {[-1, 1].map(side => <group key={side}>
      <Panel p={[.345, .17, side * .14]} s={[.013, .045, .07]} color="#d0c5a0" />
      <Panel p={[-.39, .27, side * .18]} s={[.012, .03, .068]} color="#b04b3e" />
    </group>)}
    <Panel p={[-.18, .55, -.04]} s={[.004, .39, .004]} color="#2e3a33" />
    <Panel p={[-.18, .75, -.04]} s={[.018, .014, .012]} color="#1b241e" />
  </group>;
}

export function CarrierDetails({ faction }: { faction: FactionId }) {
  const west = faction === 'aster';
  const armor = west ? '#68755c' : '#73765a';
  const trim = '#3a453c';
  const roof = west ? .332 : .262;
  return <group name={west ? 'Lynx-detail-kit' : 'Bars-detail-kit'}>
    {[-1, 1].map(side => <group key={side}>
      <Panel p={[-.03, .235, side * .159]} s={[.50, .075, .025]} color={armor} />
      {Array.from({ length: 3 }, (_, i) =>
        <Panel key={i} p={[-.23 + i * .22, .25, side * .18]} s={[.165, .054, .012]} color={i % 2 ? trim : armor} />)}
      <Panel p={[-.22, roof - .015, side * .135]} s={[.13, .02, .042]} color={trim} />
      <Panel p={[-.22, roof, side * .137]} s={[.08, .011, .044]} color="#a3b7ac" metalness={.3} />
      <Panel p={[-.16, .16, side * .18]} s={[.022, .11, .024]} color="#282f28" />
      <Panel p={[-.16, .16, side * .193]} s={[.007, .037, .008]} color="#c1b99e" />
      <Panel p={[-.27, roof + .11, side * .09]} s={[.003, .27, .003]} color="#2b302b" />
      <Panel p={[.355, .18, side * .105]} s={[.015, .042, .066]} color="#d2c9ab" />
    </group>)}
    {/* Driver vision blocks and engine louvers */}
    {[-.10, 0, .10].map((z, i) =>
      <Panel key={i} p={[.31, roof - .047, z]} s={[.027, .03, .047]} color="#253e3b" metalness={.45} />)}
    {Array.from({ length: 5 }, (_, i) =>
      <Panel key={i} p={[-.31 + i * .044, roof + .006, -.035]} s={[.013, .009, .105]} color={trim} />)}
    <Drum p={[.09, roof + .065, 0]} r={west ? .08 : .07} depth={.03} color={armor} rot={[0, 0, 0]} />
    <Panel p={[.105, roof + .10, 0]} s={[.11, .025, .12]} color={trim} />
    <Panel p={[.27, roof + .11, 0]} s={[.26, .02, .022]} color="#262e29" />
    {/* Rear personnel hatch and external stowage */}
    <Panel p={[-.36, .24, 0]} s={[.025, .18, .2]} color={trim} />
    {[-.06, .06].map(z => <Panel key={z} p={[-.38, .235, z]} s={[.01, .08, .018]} color="#a39b83" />)}
  </group>;
}

export function HelicopterDetails({ faction }: { faction: FactionId }) {
  const west = faction === 'aster';
  const metal = west ? '#566951' : '#747154';
  return <group name={west ? 'Kestrel-detail-kit' : 'Korshun-detail-kit'}>
    {[-1, 1].map(side => <group key={side}>
      <Panel p={[.13, .042, side * .081]} s={[.085, .055, .014]} color="#2c4848" metalness={.3} />
      <Panel p={[-.105, .015, side * .095]} s={[.12, .058, .012]} color="#294442" metalness={.25} />
      <Panel p={[-.035, -.018, side * .137]} s={[.25, .019, .075]} color={metal} />
      <Drum p={[-.013, -.03, side * .196]} r={.035} depth={.17} color="#38483d" rot={[Math.PI / 2, 0, 0]} />
      {[-.065, .04].map(x=>
        <Panel key={x} p={[x, -.032, side * .208]} s={[.014, .009, .019]} color="#b9ab7e" />)}
      <Panel p={[-.23, .065, side * .03]} s={[.075, .03, .019]} color="#2f352d" />
    </group>)}
    <Panel p={[-.28, .012, 0]} s={[.16, .04, .042]} color={metal} />
    <Panel p={[-.52, .052, 0]} s={[.11, .014, .23]} color={metal} />
    <Panel p={[.01, .16, 0]} s={[.065, .023, .065]} color="#313d35" />
    <Panel p={[.105, -.035, 0]} s={[.062, .02, .052]} color="#d7c9aa" />
    <Panel p={[-.36, .088, 0]} s={[.003, .23, .003]} color="#29362c" />
  </group>;
}

// The weapons are genuine Quaternius Ultimate Guns Pack GLBs (CC0).
// Unlike procedural gun silhouettes, these have modelled stocks, grips and
// receivers. They are normalized against source dimensions at runtime.
const WEAPON_PATHS = {
  aster: 'scarl',
  vostran: 'ak74',
};
function LoadedWeapon({ faction }: { faction: FactionId }) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}assets/factions/${WEAPON_PATHS[faction]}.glb`);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const b = new THREE.Box3().setFromObject(clone);
    const size = b.getSize(new THREE.Vector3());
    const centre = b.getCenter(new THREE.Vector3());
    const scale = .19 / Math.max(size.x, size.y, size.z, .0001);
    clone.position.sub(centre.multiplyScalar(1));
    const root = new THREE.Group();
    root.scale.setScalar(scale);
    root.add(clone);
    return root;
  }, [gltf.scene]);
  return <primitive object={model} dispose={null} />;
}
class RifleBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
export function FactionWeapon({ faction }: { faction: FactionId }) {
  return <RifleBoundary><Suspense fallback={null}><LoadedWeapon faction={faction}/></Suspense></RifleBoundary>;
}
