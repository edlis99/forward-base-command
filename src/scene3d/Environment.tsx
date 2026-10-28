import { useEffect, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { SETTLEMENTS } from '../game/maps/settlements';
import { groundHeightAt, hash2, fbm } from './terrainHeight';
import { canopyMaterial } from './canopyReveal';

type V3 = [number, number, number];
type Finish = 'plain' | 'timber' | 'weathered' | 'brick' | 'plaster' | 'clay' | 'slate' | 'metal';
interface Part { p: V3; s: V3; r?: V3; color: string; finish?: Finish; }
type Shape = 'box' | 'crown' | 'cone' | 'cylinder' | 'roof';
type Parts = Record<Shape, Part[]>;
const emptyParts = (): Parts => ({ box: [], crown: [], cone: [], cylinder: [], roof: [] });

/** All props are batched by geometry, with per-instance material colours. */
function Batch({ shape, parts, shadows = true, canopy = false, texture }: { shape: Shape; parts: Part[]; shadows?: boolean; canopy?: boolean; texture?: THREE.Texture }) {
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
    const a = geo.getAttribute('position');
    const uv: number[] = [];
    for (let i = 0; i < a.count; i++) uv.push(a.getX(i) + .5, a.getZ(i) + .5);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals(); return geo;
  }, [shape]);
  useEffect(() => () => roof?.dispose(), [roof]);
  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    parts.forEach((part, i) => {
      dummy.position.set(...part.p); dummy.scale.set(...part.s); dummy.rotation.set(...(part.r ?? [0, 0, 0])); dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
      color.set(part.color);
      if (texture) color.lerp(new THREE.Color('#ffffff'), .8);
      ref.current!.setColorAt(i, color);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [parts, texture]);
  if (!parts.length) return null;
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} castShadow={shadows} receiveShadow raycast={() => null}>
    {shape === 'box' && <boxGeometry />}
    {shape === 'crown' && <icosahedronGeometry args={[0.5, 1]} />}
    {shape === 'cone' && <coneGeometry args={[0.5, 1, 9]} />}
    {shape === 'cylinder' && <cylinderGeometry args={[0.5, 0.5, 1, 8]} />}
    {shape === 'roof' && <primitive object={roof} attach="geometry" />}
    {canopyMat ? <primitive object={canopyMat} attach="material" />
      : <meshStandardMaterial map={texture ?? null} roughness={texture ? .9 : .92}
          side={shape === 'roof' ? THREE.DoubleSide : THREE.FrontSide} />}
  </instancedMesh>;
}
/** Textures are cached by useLoader: all visible settlements reuse the same 1K maps. */
function BuildingBatches({ parts }: { parts: Parts }) {
  const images = useLoader(THREE.TextureLoader, [
    '/assets/buildings/wood_siding.jpg', '/assets/buildings/wood_weathered.jpg',
    '/assets/buildings/brick_red.jpg', '/assets/buildings/concrete.jpg',
    '/assets/buildings/roof_clay.jpg', '/assets/buildings/roof_slate.jpg',
    '/assets/buildings/roof_corrugated.jpg',
  ]);
  const textures = useMemo(() => {
    images.forEach(t => {
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4; t.needsUpdate = true;
    });
    return { timber: images[0], weathered: images[1], brick: images[2], plaster: images[3],
      clay: images[4], slate: images[5], metal: images[6] } as Record<Exclude<Finish, 'plain'>, THREE.Texture>;
  }, [images]);
  const groups = useMemo(() => {
    const grouped: { key: string; shape: Shape; finish: Finish; items: Part[] }[] = [];
    for (const shape of Object.keys(parts) as Shape[]) {
      const buckets = new Map<Finish, Part[]>();
      for (const part of parts[shape]) {
        const f = part.finish ?? 'plain';
        if (!buckets.has(f)) buckets.set(f, []);
        buckets.get(f)!.push(part);
      }
      for (const [finish, items] of buckets) grouped.push({ key: shape + '-' + finish, shape, finish, items });
    }
    return grouped;
  }, [parts]);
  return <group>{groups.map(g => <Batch key={g.key} shape={g.shape} parts={g.items}
    texture={g.finish === 'plain' ? undefined : textures[g.finish]} />)}</group>;
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
      const off = cell.type === 'urban' ? cell.buildingOffset : undefined;
      const cx = x + .5 + (off?.[0] ?? 0), cz = z + .5 + (off?.[1] ?? 0), y = groundHeightAt(terrain, cx, cz);
      // Geometry sits on the rear/side of a cell; its centre is a usable
      // firing slot. Clicking uses the same cell in the simulation.
      const add = (shape: Shape, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, color: string, rx = 0, rz = 0, finish: Finish = 'plain') => {
        const propScale = cell.type === 'urban' || cell.yard ? 1 : .58;
        ox *= propScale; oy *= propScale; oz *= propScale; sx *= propScale; sy *= propScale; sz *= propScale;
        parts[shape].push({ p: [cx + Math.cos(angle) * ox - Math.sin(angle) * oz, y + oy, cz + Math.sin(angle) * ox + Math.cos(angle) * oz],
          s: [sx, sy, sz], r: [rx, -angle, rz], color, finish });
      };
      if (cell.yard) {
        // Dzūkija farmstead: low picket fencing, vegetable plots and small
        // service structures behind the house. The road-facing entrance stays open.
        for (const side of [-1, 1]) {
          for (const iz of [-.40, -.19, .02, .23]) {
            add('box', side * .44, .115, iz, .026, .23, .028, '#938a70');
          }
          add('box', side * .44, .16, -.09, .026, .035, .72, '#a89f83');
        }
        for (const ox of [-.40, -.18, .18, .40]) add('box', ox, .105, -.43, .023, .21, .03, '#8e846c');
        if (cell.yard === 'garden') {
          // Garden rows and a narrow central path: not a uniform green block.
          for (const side of [-1, 1]) {
            add('box', side * .24, .012, -.17, .23, .024, .44, '#66563e');
            for (const oz of [-.32, -.19, -.06]) {
              add('box', side * .24, .049, oz, .18, .061, .055,
                hash2(x + oz * 19, z) > .5 ? '#638050' : '#537344');
            }
          }
          if (hash2(x + 71, z + 19) > .71) {
            add('cylinder', .30, .22, .22, .06, .44, .06, '#71634e');
            add('box', .30, .45, .22, .25, .04, .21, '#91816a');
            add('roof', .30, .48, .22, .36, .18, .30, '#6c5d50', 0, 0, 'slate');
          }
        } else if (cell.yard === 'orchard') {
          for (const ox of [-.22, .24]) {
            add('cylinder', ox, .25, -.22, .046, .50, .046, '#776146');
            add('crown', ox, .59, -.22, .38, .41, .39, '#708e54');
            add('crown', ox + .10, .56, -.25, .27, .29, .31, '#80985e');
          }
          add('box', -.08, .045, .28, .28, .09, .14, '#806e50');
        } else {
          // Work yard: open storage, lean-to, logs, small granary.
          add('box', -.20, .18, -.15, .50, .34, .33, '#755f48', 0, 0, 'weathered');
          add('roof', -.20, .35, -.15, .58, .18, .42, '#72716d', 0, 0, 'metal');
          add('box', -.20, .18, .03, .20, .24, .025, '#4c4034');
          for (const i of [0, 1, 2]) add('cylinder', .26, .09 + i * .10, -.22, .11, .40, .11, '#756049', Math.PI / 2);
        }
      } else if (cell.type === 'urban') {
        const kind = cell.buildingKind ?? 'house';
        const r1 = hash2(x + 11, z), r2 = hash2(x, z + 13), r3 = hash2(x + 29, z + 7);
        const pick = (arr: string[], r: number) => arr[Math.floor(r * arr.length) % arr.length];
        const WOOD = ['#886c50', '#785f47', '#997b58', '#899079', '#7d8a89', '#b1a184', '#9b755a', '#c0b295'];
        const PLASTER = ['#d3c9b6', '#e1d6c1', '#c3bcae', '#bcbbae', '#ddd7cc'];
        const BRICK = ['#a15e48', '#9b533d', '#b07456', '#8e5545'];
        const ROOF = ['#545959', '#656661', '#824e3f', '#7c5146', '#545c62', '#675e54'];
        const roofColor = r3 < .25 && town?.roof ? town.roof : pick(ROOF, r2);
        const siding = pick(WOOD, r1);
        const roofFinish: Finish = r2 < .24 ? 'clay' : r2 < .64 ? 'slate' : 'metal';
        const glass = '#3b4e51', frame = '#e4decf';

        // All measurements stay within the existing navigational cell. The
        // building still occupies exactly one tactical cell for LOS and cover.
        const wallBox = (ox: number, oy: number, oz: number, sx: number, sy: number, sz: number,
          color: string, finish: Finish) => add('box', ox, oy, oz, sx, sy, sz, color, 0, 0, finish);
        const roofTop = (ox: number, oy: number, oz: number, sx: number, sy: number, sz: number,
          color: string, finish: Finish) => add('roof', ox, oy, oz, sx, sy, sz, color, 0, 0, finish);
        const windows = (h: number, rows: number, cols: number, w: number, d: number) => {
          const winW = Math.min(.13, w / (cols + 1));
          const winH = Math.min(.17, h / (rows + 1) * .56);
          for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
            const ox = (col - (cols - 1) / 2) * (w / cols), oy = .13 + (row + .54) * (h / rows);
            for (const side of [-1, 1]) {
              const oz = -.18 + side * (d / 2 + .01);
              add('box', ox, oy, oz, winW + .035, winH + .035, .025, frame);
              add('box', ox, oy, oz + side * .015, winW, winH, .016, glass);
              add('box', ox, oy, oz + side * .024, .009, winH, .012, '#d0cabb');
              add('box', ox, oy, oz + side * .025, winW, .009, .012, '#d0cabb');
              if (cols <= 3 && row === 0 && side === 1) {
                for (const shutter of [-1, 1]) add('box', ox + shutter * (winW * .5 + .028),
                  oy, oz + .02, .025, winH + .025, .013, r1 < .5 ? '#b7b6a2' : '#6d785e');
              }
            }
          }
        };
        add('box', 0, .045, -.18, .96, .09, .76, '#8b877c');

        if (kind === 'block') {
          // Post-war panel housing is reserved for actual town centres.
          const floors = 3 + Math.floor(r1 * 2), h = floors * .30, w = .91, d = .68;
          wallBox(0, .09 + h / 2, -.18, w, h, d, pick(PLASTER, r2), 'plaster');
          add('box', 0, .11 + h, -.18, w + .055, .07, d + .05, '#666968');
          windows(h, floors, 4, w * .90, d);
          for (let f = 1; f < floors; f++) {
            add('box', .25, .09 + f * .30, -.18 + d / 2 + .06, .19, .033, .12, '#96918a');
            add('box', .25, .14 + f * .30, -.18 + d / 2 + .11, .19, .065, .014, '#656560');
          }
          add('box', -.25, .19, -.18 + d / 2 + .02, .16, .22, .025, '#756c60');
        } else if (kind === 'brick' || kind === 'civic') {
          // Interwar masonry homes, plastered public buildings and schools.
          const h = kind === 'civic' ? .80 : .56 + r1 * .16, w = .85, d = .66;
          const plaster = kind === 'civic' || r2 > .68;
          wallBox(0, .09 + h / 2, -.18, w, h, d,
            plaster ? pick(PLASTER, r1) : pick(BRICK, r1), plaster ? 'plaster' : 'brick');
          roofTop(0, .09 + h, -.18, w + .14, .38, d + .16, roofColor, r2 < .5 ? 'clay' : 'slate');
          add('box', 0, .08 + h, -.18, w + .12, .028, d + .10, '#e1d9c6');
          windows(h, kind === 'civic' ? 2 : 1, 3, w * .86, d);
          add('box', .05, .21, -.18 + d / 2 + .02, .15, .28, .029, '#645243');
          // Simple rendered plaster cornice and entrance canopy.
          add('box', .05, .39, -.18 + d / 2 + .14, .25, .038, .20, '#c7c4b6');
          add('box', .05, .10, -.18 + d / 2 + .12, .25, .04, .20, '#98918a');
        } else if (kind === 'barn') {
          // Long, relatively low threshing barns / granaries, not red US barns.
          const h = .45 + r1 * .14, w = .94, d = .60;
          wallBox(0, .09 + h / 2, -.18, w, h, d, pick(WOOD, r2), 'weathered');
          roofTop(0, .09 + h, -.18, w + .14, .41, d + .16,
            roofColor, r3 < .34 ? 'slate' : 'metal');
          // Tall double door, side braces, exposed timber posts.
          add('box', 0, .30, -.18 + d / 2 + .022, .35, .40, .030, '#544635');
          add('box', 0, .30, -.18 + d / 2 + .046, .020, .40, .01, '#9f896a');
          for (const side of [-1, 1]) {
            add('box', side * .43, .32, -.18 + d / 2 + .024, .035, .55, .025, '#b1a081');
            add('box', side * .23, .29, -.18 + d / 2 + .038, .025, .39, .020, '#a98b6c');
          }
        } else if (kind === 'workshop') {
          const h = .43 + r1 * .13, w = .91, d = .70;
          wallBox(0, .09 + h / 2, -.18, w, h, d, pick(PLASTER, r2), 'plaster');
          roofTop(0, .09 + h, -.18, w + .10, .22, d + .10, '#767978', 'metal');
          add('box', .15, .25, -.18 + d / 2 + .03, .35, .29, .024, '#626f71');
          add('box', -.29, .26, -.18 + d / 2 + .026, .16, .22, .022, '#4c5351');
          add('box', -.27, .13, .28, .24, .18, .17, '#827e66');
        } else {
          // Traditional one-storey pirkia: horizontal pine boards, large
          // pitched roof, pale window casings, porch and a smoke chimney.
          const h = .46 + r1 * .12, w = .76 + r2 * .13, d = .59;
          const cottage = kind !== 'church';
          const wall = cottage ? (r3 < .30 && town?.wall ? town.wall : siding) : '#d9d2c2';
          wallBox(0, .09 + h / 2, -.18, w, h, d, wall,
            cottage ? (r1 < .65 ? 'timber' : 'weathered') : 'plaster');
          roofTop(0, .09 + h, -.18, w + .18, .49, d + .19, roofColor,
            kind === 'church' ? 'slate' : roofFinish);
          add('box', 0, .09 + h, -.18, w + .15, .026, d + .15, '#7a7061');
          // Chimney near the rear ridge, capped with dark brick.
          add('box', -.19, .09 + h + .17, -.33, .09, .30, .10, '#b9a996');
          add('box', -.19, .09 + h + .33, -.33, .12, .045, .13, '#55524b');
          windows(h, 1, 2, w * .87, d);
          const front = -.18 + d / 2;
          add('box', 0, .18, front + .013, .11, .22, .025, '#564f45');
          add('box', 0, .11, front + .16, .32, .045, .25, '#857963');
          // One-bay wooden porch under its own gabled roof.
          for (const post of [-.15, .15]) add('box', post, .29, front + .23, .028, .38, .028, '#b2a88e');
          roofTop(0, .48, front + .17, .37, .20, .33, roofColor, roofFinish);
          if (cottage && r1 > .25) {
            // Modest white corner boarding, consistent with local cottages.
            for (const side of [-1, 1]) add('box', side * (w / 2 - .018), .32, front + .017,
              .032, .50, .023, '#d8cdb2');
          }
        }
        if (kind === 'church') {
          // Small gabled rural church and tower, not a generic skyscraper.
          add('box', .25, .69, -.16, .28, 1.38, .32, '#dbd1b9');
          roofTop(.25, 1.38, -.16, .38, .45, .38, '#565f64', 'slate');
          add('box', .25, 1.70, -.16, .029, .23, .03, '#555a56');
          add('box', .25, 1.77, -.16, .14, .025, .025, '#555a56');
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
  return <BuildingBatches parts={parts} />;
}
