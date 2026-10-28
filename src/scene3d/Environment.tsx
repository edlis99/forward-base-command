import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { SETTLEMENTS } from '../game/maps/settlements';
import { groundHeightAt, hash2, fbm } from './terrainHeight';
import { canopyMaterial } from './canopyReveal';

type V3 = [number, number, number];
interface Part { p: V3; s: V3; r?: V3; color: string; }
type Shape = 'box' | 'crown' | 'cone' | 'cylinder' | 'roof';
type Parts = Record<Shape, Part[]>;
const emptyParts = (): Parts => ({ box: [], crown: [], cone: [], cylinder: [], roof: [] });

/** All props are batched by geometry, with per-instance material colours. */
function Batch({ shape, parts, shadows = true, canopy = false }: { shape: Shape; parts: Part[]; shadows?: boolean; canopy?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const canopyMat = useMemo(() => (canopy ? canopyMaterial() : undefined), [canopy]);
  useEffect(() => () => canopyMat?.dispose(), [canopyMat]);
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
    {canopyMat ? <primitive object={canopyMat} attach="material" />
      : <meshStandardMaterial roughness={0.92} side={shape === 'roof' ? THREE.DoubleSide : THREE.FrontSide} />}
  </instancedMesh>;
}
function Batches({ parts, canopy = false }: { parts: Parts; canopy?: boolean }) {
  // With canopy on, leaf shapes (crowns, cones) thin out above your troops; trunks stay solid.
  return <group>{(Object.keys(parts) as Shape[]).map(shape => <Batch key={shape} shape={shape} parts={parts[shape]}
    canopy={canopy && (shape === 'crown' || shape === 'cone')} />)}</group>;
}

export function Woodland({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const parts = useMemo(() => {
    const parts = emptyParts();
    for (let z = section.y; z < section.y + section.height; z++) for (let x = section.x; x < section.x + section.width; x++) {
      const cell = terrain[z][x];
      if (cell.type !== 'forest') continue;
      // Woods change character across the map like real Dzukija forest: pine
      // stands on sandy ground, mixed spruce, birch and oak elsewhere.
      const pineStand = fbm(x * .045 + 40, z * .045 + 13) > .5;
      const trees = hash2(x + 21, z + 3) < .55 ? 2 : 1;
      for (let k = 0; k < trees; k++) {
        const roll = hash2(x + k * 31, z + k * 17);
        if (roll < 0.07) continue; // small openings in the canopy
        const px = x + .12 + hash2(x + 5 + k, z) * .76, pz = z + .12 + hash2(x, z + 7 + k) * .76;
        const y = groundHeightAt(terrain, px, pz);
        const height = (trees === 2 ? 1.5 : 1.8) + hash2(x + 3 + k, z + 9) * 1.6;
        const species = pineStand ? (roll < .82 ? 'pine' : roll < .92 ? 'spruce' : 'birch')
          : (roll < .3 ? 'spruce' : roll < .58 ? 'birch' : roll < .72 ? 'pine' : 'oak');
        const shade = .86 + hash2(x + 13 + k, z + 29) * .28;
        const tint = (hex: string) => { const c = new THREE.Color(hex); c.multiplyScalar(shade); return '#' + c.getHexString(); };
        if (species === 'pine') {
          // Scots pine: tall bare orange-brown trunk, small dark crown high up.
          parts.cylinder.push({ p: [px, y + height * .42, pz], s: [.075, height * .84, .075], color: '#8a5b3d' });
          for (let c = 0; c < 2; c++) {
            const a = roll * 40 + c * 2.4;
            parts.crown.push({ p: [px + Math.cos(a) * .1, y + height * (.86 + c * .1), pz + Math.sin(a) * .1],
              s: [height * .34, height * .2, height * .34], r: [roll, a, .2], color: tint(['#2f4a33', '#3b5637'][c]) });
          }
        } else if (species === 'spruce') {
          parts.cylinder.push({ p: [px, y + height * .3, pz], s: [.08, height * .6, .08], color: '#5a4636' });
          for (let layer = 0; layer < 3; layer++) {
            parts.cone.push({ p: [px, y + height * (.42 + layer * .2), pz],
              s: [height * (.42 - layer * .1), height * .5, height * (.42 - layer * .1)],
              r: [0, roll * 7 + layer, 0], color: tint(['#24403a', '#2c4a3f', '#365443'][layer]) });
          }
        } else if (species === 'birch') {
          parts.cylinder.push({ p: [px, y + height * .38, pz], s: [.06, height * .76, .06], color: '#ddd8c4' });
          for (let stripe = 1; stripe <= 3; stripe++) parts.cylinder.push({ p: [px, y + stripe * height * .14, pz], s: [.063, .02, .063], color: '#4a4842' });
          for (let c = 0; c < 2; c++) {
            const a = roll * 30 + c * 2.7;
            parts.crown.push({ p: [px + Math.cos(a) * .12, y + height * (.72 + c * .12), pz + Math.sin(a) * .12],
              s: [height * .36, height * .42, height * .36], r: [roll, a, .1], color: tint(['#7d9a52', '#93a85c'][c]) });
          }
        } else {
          // Oak: stout trunk, broad irregular crown.
          parts.cylinder.push({ p: [px, y + height * .28, pz], s: [.12, height * .56, .12], color: '#5b4a3a' });
          for (let c = 0; c < 3; c++) {
            const a = roll * 30 + c * 2.1, off = c === 0 ? 0 : height * .16;
            parts.crown.push({ p: [px + Math.cos(a) * off, y + height * (.62 + c * .08), pz + Math.sin(a) * off],
              s: [height * .5, height * .4, height * .5], r: [roll, a, .15], color: tint(['#3e5e35', '#4b6b3c', '#577545'][c]) });
          }
        }
      }
      // Undergrowth at the wood edge, where troops actually fight from.
      const edge = [terrain[z - 1]?.[x], terrain[z + 1]?.[x], terrain[z]?.[x - 1], terrain[z]?.[x + 1]].some(n => n && n.type !== 'forest');
      if (edge && hash2(x + 7, z + 77) < .6) {
        const y = groundHeightAt(terrain, x + .5, z + .5);
        parts.crown.push({ p: [x + .3 + hash2(x, z + 3) * .4, y + .18, z + .3 + hash2(x + 3, z) * .4], s: [.6, .36, .6], color: '#5d6e3f' });
      }
    }
    return parts;
  }, [terrain, section]);
  return <Batches parts={parts} canopy />;
}

export function RuralBuildingsAndProps({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const parts = useMemo(() => {
    const parts = emptyParts();
    for (let z = section.y; z < section.y + section.height; z++) for (let x = section.x; x < section.x + section.width; x++) {
      const cell = terrain[z][x];
      if (cell.type !== 'urban' && !cell.prop && !cell.yard) continue;
      const angle = cell.propAngle ?? 0;
      const town = SETTLEMENTS.find(s => s.id === cell.settlementId);
      const cx = x + .5, cz = z + .5, y = groundHeightAt(terrain, cx, cz);
      // Geometry sits on the rear/side of a cell; its centre is a usable
      // firing slot. Clicking uses the same cell in the simulation.
      const add = (shape: Shape, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, color: string, rx = 0, rz = 0) => {
        const propScale = cell.type === 'urban' || cell.yard ? 1 : .58;
        ox *= propScale; oy *= propScale; oz *= propScale; sx *= propScale; sy *= propScale; sz *= propScale;
        parts[shape].push({ p: [cx + Math.cos(angle) * ox - Math.sin(angle) * oz, y + oy, cz + Math.sin(angle) * ox + Math.cos(angle) * oz],
          s: [sx, sy, sz], r: [rx, -angle, rz], color });
      };
      if (cell.yard) {
        // Open entrance on the south edge; low side fences and garden beds.
        for (const side of [-1, 1]) {
          add('box', side * .43, .08, -.08, .025, .12, .68, '#8b896d');
          add('box', side * .43, .1, -.39, .045, .2, .045, '#77735c');
        }
        if (cell.yard === 'garden') {
          for (const side of [-1, 1]) {
            add('box', side * .20, .013, -.14, .22, .026, .42, '#6c6047');
            for (const oz of [-.28, -.15, -.02]) add('box', side * .20, .055, oz, .17, .08, .04, '#647847');
          }
        } else if (cell.yard === 'orchard') {
          for (const ox of [-.22, .22]) {
            add('cylinder', ox, .23, -.2, .045, .46, .045, '#6f6045');
            add('crown', ox, .55, -.2, .36, .4, .36, '#7e9554');
          }
        } else add('box', .25, .09, -.26, .22, .18, .2, '#8a8067');
      } else if (cell.type === 'urban') {
        // Lithuanian town and countryside: painted wooden cottages, brick
        // houses, Soviet-era apartment blocks in the large towns, long barns,
        // sheds. Each building picks its own size and colours.
        const kind = cell.buildingKind ?? 'house';
        const r1 = hash2(x + 11, z), r2 = hash2(x, z + 13), r3 = hash2(x + 29, z + 7);
        const pick = (arr: string[], r: number) => arr[Math.floor(r * arr.length) % arr.length];
        const WOOD = ['#8a6a4a', '#7b5d43', '#a0805c', '#6f7f62', '#5f7a86', '#b49a6a', '#9a6e52', '#c2b28a'];
        const PLASTER = ['#d8cfb8', '#cfc4a8', '#e0d6c0', '#c9c1b0', '#d6cbb0', '#d9d2c2'];
        const BRICK = ['#9a4f3c', '#a85d45', '#8c4a39', '#b06a4f'];
        const ROOF = ['#5f625e', '#6e716b', '#7a3f31', '#8c4a36', '#4f5a5e', '#665446'];
        const roof = r3 < .3 && town?.roof ? town.roof : pick(ROOF, r2);
        const glass = '#3f4f52', frame = '#e3dcc2';
        const windows = (h: number, rows: number, cols: number, w: number, d: number) => {
          for (let row = 0; row < rows; row++) for (let c = 0; c < cols; c++) {
            const ox = (c - (cols - 1) / 2) * (w / cols), oy = .16 + (row + .55) * (h / rows);
            for (const side of [1, -1]) {
              add('box', ox, oy, -.18 + side * (d / 2 + .006), .11, .13, .02, frame);
              add('box', ox, oy, -.18 + side * (d / 2 + .014), .08, .1, .02, glass);
            }
          }
        };
        add('box', 0, .04, -.18, .96, .08, .72, '#8c897c'); // plinth / yard edge
        if (kind === 'block') {
          // Three to five storeys, flat roof, window grid, balconies.
          const floors = 3 + Math.floor(r1 * 3), h = floors * .32, w = .94, d = .66;
          add('box', 0, .08 + h / 2, -.18, w, h, d, pick(PLASTER, r2));
          add('box', 0, .1 + h, -.18, w + .03, .05, d + .03, '#5d605c');
          windows(h, floors, 4, w * .92, d);
          for (let f = 1; f < floors; f++) add('box', .22, .1 + f * .32, -.18 + d / 2 + .05, .22, .03, .1, '#8f8c84');
        } else if (kind === 'brick' || kind === 'civic') {
          const h = kind === 'civic' ? .82 : .62 + r1 * .2, w = .84, d = .6;
          add('box', 0, .08 + h / 2, -.18, w, h, d, kind === 'civic' ? pick(PLASTER, r1) : (r2 < .6 ? pick(BRICK, r1) : pick(PLASTER, r1)));
          add('roof', 0, .08 + h, -.18, w + .08, .32, d + .08, roof);
          windows(h, 2, 3, w * .9, d);
          add('box', .0, .2, -.18 + d / 2 + .01, .14, .26, .02, '#4e4438');
        } else if (kind === 'barn') {
          // Long, dark timber, big roof, wide door.
          const h = .42 + r1 * .12, w = .94, d = .58;
          add('box', 0, .08 + h / 2, -.18, w, h, d, pick(['#6b5a46', '#7a6650', '#5d4f40', '#8a6d52'], r2));
          add('roof', 0, .08 + h, -.18, w + .06, .4, d + .1, pick(['#5f625e', '#4f5450', '#6e716b', '#7a3f31'], r3));
          add('box', 0, .26, -.18 + d / 2 + .01, .34, .34, .02, '#4a3e30');
          add('box', 0, .26, -.18 + d / 2 + .02, .02, .34, .02, '#9c8c6c');
        } else if (kind === 'workshop') {
          const h = .4 + r1 * .1, w = .9, d = .66;
          add('box', 0, .08 + h / 2, -.18, w, h, d, pick(['#8d9496', '#9aa09a', '#a09a8a', '#7f8a8c'], r2));
          add('roof', 0, .08 + h, -.18, w + .05, .14, d + .06, '#7d8486');
          add('box', .14, .22, -.18 + d / 2 + .01, .34, .28, .02, '#5d6668');
          add('box', -.28, .1, .28, .22, .16, .18, '#77765d');
        } else {
          // Wooden cottage (or church body): one storey, gable roof, chimney, painted boards.
          const h = .38 + r1 * .14, w = .72 + r2 * .14, d = .52;
          const wall = kind === 'church' ? '#d6cbb1' : (r3 < .25 && town?.wall ? town.wall : pick(WOOD, r1 * 7.3));
          add('box', 0, .08 + h / 2, -.18, w, h, d, wall);
          add('roof', 0, .08 + h, -.18, w + .14, .38, d + .12, roof);
          add('box', -.18, .08 + h + .12, -.24, .08, .22, .09, '#9a8676');
          windows(h, 1, 2, w * .85, d);
          add('box', .04, .17, -.18 + d / 2 + .01, .11, .2, .02, '#594d3e');
          if (kind !== 'church') for (const side of [-1, 1]) {
            add('box', side * .46, .16, .28, .03, .28, .03, '#908471');
            add('box', side * .46, .19, .06, .025, .05, .44, '#a2957c');
          }
        }
        if (kind === 'church') {
          add('box', .26, .62, -.15, .28, 1.24, .3, '#e0d7bf');
          add('cone', .26, 1.5, -.15, .42, .55, .42, '#5f6b6d');
          add('box', .26, 1.86, -.15, .022, .22, .022, '#535e58');
          add('box', .26, 1.9, -.15, .11, .022, .022, '#535e58');
        }
      } else if (cell.prop === 'boulder') {
        add('crown', -.16, .22, -.25, .62, .46, .48, '#858c7d');
        add('crown', .27, .13, -.19, .36, .29, .4, '#9b9e8d');
      } else if (cell.prop === 'scrub') {
        for (const ox of [-.3, 0, .3]) {
          add('crown', ox, .2, -.2, .46, .42, .45, ox === 0 ? '#6c7d42' : '#83915a');
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
    }
    return parts;
  }, [terrain, section]);
  return <Batches parts={parts} />;
}
