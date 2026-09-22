import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { SETTLEMENTS } from '../game/maps/settlements';
import { groundHeightAt, hash2 } from './terrainHeight';

type V3 = [number, number, number];
interface Part { p: V3; s: V3; r?: V3; color: string; }
type Shape = 'box' | 'crown' | 'cone' | 'cylinder' | 'roof';
type Parts = Record<Shape, Part[]>;
const emptyParts = (): Parts => ({ box: [], crown: [], cone: [], cylinder: [], roof: [] });

/** All props are batched by geometry, with per-instance material colours. */
function Batch({ shape, parts, shadows = true }: { shape: Shape; parts: Part[]; shadows?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const roof = useMemo(() => {
    if (shape !== 'roof') return undefined;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -.5,0,-.5, .5,0,-.5, 0,.5,-.5, -.5,0,.5, 0,.5,.5, .5,0,.5,
      -.5,0,-.5, 0,.5,-.5, -.5,0,.5, 0,.5,-.5, 0,.5,.5, -.5,0,.5,
      0,.5,-.5, .5,0,-.5, .5,0,.5, 0,.5,-.5, .5,0,.5, 0,.5,.5,
    ], 3));
    geo.computeVertexNormals(); return geo;
  }, [shape]);
  useEffect(() => () => roof?.dispose(), [roof]);
  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    parts.forEach((part, i) => {
      dummy.position.set(...part.p); dummy.scale.set(...part.s); dummy.rotation.set(...(part.r ?? [0, 0, 0])); dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix); ref.current!.setColorAt(i, color.set(part.color));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [parts]);
  if (!parts.length) return null;
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} castShadow={shadows} receiveShadow raycast={() => null}>
    {shape === 'box' && <boxGeometry />}
    {shape === 'crown' && <icosahedronGeometry args={[0.5, 1]} />}
    {shape === 'cone' && <coneGeometry args={[0.5, 1, 9]} />}
    {shape === 'cylinder' && <cylinderGeometry args={[0.5, 0.5, 1, 8]} />}
    {shape === 'roof' && <primitive object={roof} attach="geometry" />}
    <meshStandardMaterial roughness={0.92} side={shape === 'roof' ? THREE.DoubleSide : THREE.FrontSide} />
  </instancedMesh>;
}
function Batches({ parts }: { parts: Parts }) {
  return <group>{(Object.keys(parts) as Shape[]).map(shape => <Batch key={shape} shape={shape} parts={parts[shape]} />)}</group>;
}

export function Woodland({ terrain }: { terrain: TerrainCell[][] }) {
  const parts = useMemo(() => {
    const parts = emptyParts();
    terrain.forEach((row, z) => row.forEach((cell, x) => {
      if (cell.type !== 'forest') return;
      const roll = hash2(x, z);
      if (roll < 0.1) return; // irregular openings beneath a connected canopy
      const px = x + .16 + hash2(x + 5, z) * .68, pz = z + .16 + hash2(x, z + 7) * .68;
      const y = groundHeightAt(terrain, px, pz);
      const height = 1.4 + hash2(x + 3, z + 9) * 1.7;
      const pine = roll < .48, birch = roll > .78;
      parts.cylinder.push({ p: [px, y + height * .35, pz], s: [.09, height * .7, .09], color: birch ? '#d4d0b8' : '#675344' });
      if (pine) {
        for (let layer = 0; layer < 3; layer++) {
          parts.cone.push({ p: [px, y + height * (.48 + layer * .19), pz],
            s: [height * (.49 - layer * .10), height * .54, height * (.49 - layer * .10)],
            r: [0, roll * 7 + layer, 0], color: ['#315748', '#39624b', '#497151'][layer] });
        }
      } else {
        for (let cluster = 0; cluster < 3; cluster++) {
          const a = roll * 30 + cluster * 2.1;
          const offset = cluster === 0 ? 0 : height * .13;
          parts.crown.push({ p: [px + Math.cos(a) * offset, y + height * (.62 + cluster * .12), pz + Math.sin(a) * offset],
            s: [height * .62, height * .6, height * .62], r: [roll, a, .15],
            color: birch ? ['#729055', '#8c9c5c', '#a4ac66'][cluster] : ['#44663c', '#587747', '#6b8651'][cluster] });
        }
      }
      if (roll > .7) parts.crown.push({ p: [x + .12, y + .16, z + .75], s: [.55, .4, .7], color: '#657245' });
      if (birch) for (let stripe = 1; stripe <= 3; stripe++) {
        parts.cylinder.push({ p: [px, y + stripe * height * .12, pz], s: [.093, .025, .093], color: '#716f61' });
      }
    }));
    return parts;
  }, [terrain]);
  return <Batches parts={parts} />;
}

export function RuralBuildingsAndProps({ terrain }: { terrain: TerrainCell[][] }) {
  const parts = useMemo(() => {
    const parts = emptyParts();
    terrain.forEach((row, z) => row.forEach((cell, x) => {
      if (cell.type !== 'urban' && !cell.prop) return;
      const angle = cell.propAngle ?? 0;
      const town = SETTLEMENTS.find(s => s.id === cell.settlementId);
      const cx = x + .5, cz = z + .5, y = groundHeightAt(terrain, cx, cz);
      // Geometry sits on the rear/side of a cell; its centre is a usable
      // firing slot. Clicking uses the same cell in the simulation.
      const add = (shape: Shape, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, color: string, rx = 0, rz = 0) => {
        const propScale = cell.type === 'urban' ? 1 : .58;
        ox *= propScale; oy *= propScale; oz *= propScale; sx *= propScale; sy *= propScale; sz *= propScale;
        parts[shape].push({ p: [cx + Math.cos(angle) * ox - Math.sin(angle) * oz, y + oy, cz + Math.sin(angle) * ox + Math.cos(angle) * oz],
          s: [sx, sy, sz], r: [rx, -angle, rz], color });
      };
      if (cell.type === 'urban') {
        const h = cell.buildingKind === 'civic' ? .72 : .44 + hash2(x + 11, z) * .16;
        const wall = town?.wall ?? ['#c2b79c', '#a8af99', '#c7b58f', '#948b78'][Math.floor(hash2(x, z) * 4)];
        const roof = town?.roof ?? ['#794e3e', '#6d7473', '#8e5c42'][Math.floor(hash2(x + 7, z) * 3)];
        add('box', 0, .06, -.18, .94, .12, .67, '#8c897c');
        add('box', 0, h / 2 + .1, -.18, .8, h, .55, wall);
        add('roof', 0, h + .1, -.18, .96, .44, .7, roof);
        add('box', -.21, h + .19, -.24, .10, .25, .11, '#a38e7b');
        add('box', .04, .19, .103, .12, .25, .025, '#594d3e');
        for (const side of [-1, 1]) {
          add('box', side * .26, h * .63, .108, .17, .2, .025, '#e3dcc2');
          add('box', side * .26, h * .63, .125, .12, .15, .02, '#485d5c');
          add('box', side * .29, h * .65, -.461, .16, .18, .025, '#526260');
        }
        add('box', .04, .055, .24, .24, .1, .2, '#aaa58e');
        if (cell.buildingKind === 'church') {
          add('box', .22, .6, -.15, .3, 1.2, .32, '#d6cbb1');
          add('cone', .22, 1.45, -.15, .45, .55, .45, '#657375');
          add('box', .22, 1.81, -.15, .025, .22, .025, '#535e58');
          add('box', .22, 1.84, -.15, .12, .025, .025, '#535e58');
        } else if (cell.buildingKind === 'barn') {
          add('box', 0, .24, .105, .40, .35, .025, '#594a36');
          add('box', 0, .24, .125, .025, .35, .02, '#aa9d7e');
        } else if (cell.buildingKind === 'workshop') {
          add('box', .12, .25, .11, .32, .33, .025, '#627371');
          add('box', -.24, .09, .3, .2, .18, .16, '#797859');
        }
        for (const side of [-1, 1]) {
          add('box', side * .46, .22, .28, .04, .43, .04, '#908471');
          add('box', side * .46, .25, .04, .035, .07, .52, '#a2957c');
          add('box', side * .46, .11, .04, .035, .07, .52, '#a2957c');
        }
      } else if (cell.prop === 'logs') {
        for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 3 - layer; i++) {
          add('cylinder', (i - 1 + layer * .5) * .19, .11 + layer * .16, -.26, .18, .74, .18, '#66513b', Math.PI / 2);
          add('cylinder', (i - 1 + layer * .5) * .19, .11 + layer * .16, .115, .14, .015, .14, '#b4996d', Math.PI / 2);
        }
      } else if (cell.prop === 'hay') {
        for (const ox of [-.25, .25]) {
          add('cylinder', ox, .24, -.24, .46, .36, .46, '#b3a26b', Math.PI / 2);
          add('cylinder', ox, .24, -.05, .34, .018, .34, '#c8b97f', Math.PI / 2);
          add('cylinder', ox, .24, -.04, .19, .019, .19, '#a28d5a', Math.PI / 2);
        }
      } else if (cell.prop === 'stone_wall') {
        for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 4; i++) {
          add('box', -.33 + i * .22 + (layer % 2) * .03, .075 + layer * .13, -.33, .205, .12, .23,
            ['#8f9586', '#a0a091', '#7d877c'][(i + layer) % 3]);
        }
      } else if (cell.prop === 'wreck') {
        add('box', 0, .23, -.22, .78, .19, .36, '#70674f');
        add('box', -.27, .42, -.22, .24, .3, .36, '#858065');
        add('box', -.27, .46, -.029, .17, .11, .02, '#354a4c');
        add('box', .16, .37, -.37, .46, .15, .04, '#8a7960');
        add('box', .16, .37, -.07, .46, .15, .04, '#8a7960');
        for (const ox of [-.26, .25]) for (const oz of [-.43, -.015]) {
          add('cylinder', ox, .14, oz, .21, .07, .21, '#343a37', Math.PI / 2);
        }
      } else {
        for (const ox of [-.3, .3]) add('box', ox, .2, -.3, .13, .4, .22, '#797866');
        add('box', 0, .3, -.3, .92, .16, .09, '#c6bfa0');
        for (const ox of [-.3, 0, .3]) add('box', ox, .3, -.245, .11, .165, .018, '#965c46');
        add('box', .29, .1, .29, .3, .2, .25, '#7d805b');
      }
    }));
    return parts;
  }, [terrain]);
  return <Batches parts={parts} />;
}
