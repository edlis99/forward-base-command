import { useEffect, useMemo, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { TerrainCell } from '../game/types';
import { MapSection } from './mapSections';
import { SETTLEMENTS } from '../game/maps/settlements';
import { groundHeightAt, hash2, fbm } from './terrainHeight';
import { canopyMaterial } from './canopyReveal';
import { METRE, brickPlan, chimneyOf, cottagePlan } from './villagePlans';


type V3 = [number, number, number];
type Finish = 'plain' | 'timber' | 'weathered' | 'brick' | 'plaster' | 'clay' | 'slate' | 'metal';
interface Part { p: V3; s: V3; r?: V3; color: string; finish?: Finish; }
/**
 * Unit shapes, base at y = 0 for the roof shapes: `gable` is a closed
 * triangular prism (attic and gable walls), `slope` its two roof faces only
 * (so the gable walls show under the overhang), `hip` a hipped roof and
 * `spire` a four-sided pyramid. Their ridges run along z.
 */
type Shape = 'box' | 'crown' | 'cone' | 'cylinder' | 'gable' | 'slope' | 'hip' | 'spire';
type Parts = Record<Shape, Part[]>;
const emptyParts = (): Parts => ({ box: [], crown: [], cone: [], cylinder: [], gable: [], slope: [], hip: [], spire: [] });
const ROOF_SHAPES = new Set<Shape>(['gable', 'slope', 'hip', 'spire']);

/** Flat-shaded roof geometry; faces along the ridge map the texture along it, end faces map it upright. */
function roofGeometry(shape: 'gable' | 'slope' | 'hip' | 'spire'): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [];
  const tri = (a: V3, b: V3, c: V3) => {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = ab.cross(new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]));
    const side = Math.abs(n.x) > Math.abs(n.z);
    for (const p of [a, b, c]) { pos.push(...p); uv.push(side ? p[2] + .5 : p[0] + .5, p[1]); }
  };
  const quad = (a: V3, b: V3, c: V3, d: V3) => { tri(a, b, c); tri(a, c, d); };
  const A: V3 = [-.5, 0, -.5], B: V3 = [.5, 0, -.5], C: V3 = [.5, 0, .5], D: V3 = [-.5, 0, .5];
  if (shape === 'gable' || shape === 'slope') {
    const T: V3 = [0, 1, -.5], T2: V3 = [0, 1, .5];
    quad(A, D, T2, T); quad(B, T, T2, C);
    if (shape === 'gable') { tri(A, T, B); tri(D, C, T2); }
  } else if (shape === 'hip') {
    const P: V3 = [0, 1, -.22], Q: V3 = [0, 1, .22];
    quad(A, D, Q, P); quad(B, P, Q, C); tri(A, P, B); tri(D, C, Q);
  } else {
    const T: V3 = [0, 1, 0];
    tri(A, T, B); tri(B, T, C); tri(C, T, D); tri(D, T, A);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * The concrete map is a warm sandstone tan, which turned every plastered wall
 * and fieldstone brown. Plaster and stone use a neutral grey copy instead, so
 * a part's own colour (white, cream, grey stone) shows through its texture.
 */
const neutralCopies = new WeakMap<THREE.Texture, THREE.Texture>();
function neutralTexture(source: THREE.Texture): THREE.Texture {
  const cached = neutralCopies.get(source);
  if (cached) return cached;
  const image = source.image as CanvasImageSource | undefined, size = 512;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || !image) return source;
  canvas.width = canvas.height = size;
  ctx.drawImage(image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size), px = data.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += .3 * px[i] + .59 * px[i + 1] + .11 * px[i + 2];
  const mean = sum / (size * size);
  for (let i = 0; i < px.length; i += 4) {
    const l = .3 * px[i] + .59 * px[i + 1] + .11 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, 228 + (l - mean) * .75));
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  neutralCopies.set(source, texture);
  return texture;
}
/** How far a textured part's colour is washed towards white (the texture carries the colour). */
const TINT_WASH: Partial<Record<Finish, number>> = { plaster: 0 };

/** All props are batched by geometry, with per-instance material colours. */
function Batch({ shape, parts, shadows = true, canopy = false, texture, wash = .62 }: { shape: Shape; parts: Part[]; shadows?: boolean; canopy?: boolean; texture?: THREE.Texture; wash?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const canopyMat = useMemo(() => (canopy ? canopyMaterial() : undefined), [canopy]);
  useEffect(() => () => canopyMat?.dispose(), [canopyMat]);
  const roof = useMemo(() => (ROOF_SHAPES.has(shape) ? roofGeometry(shape as 'gable') : undefined), [shape]);
  useEffect(() => () => roof?.dispose(), [roof]);
  useEffect(() => {
    if (!ref.current) return;
    const dummy = new THREE.Object3D(), color = new THREE.Color(), white = new THREE.Color('#ffffff');
    parts.forEach((part, i) => {
      dummy.position.set(...part.p); dummy.scale.set(...part.s); dummy.rotation.set(...(part.r ?? [0, 0, 0])); dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
      color.set(part.color);
      if (texture) color.lerp(white, wash);
      ref.current!.setColorAt(i, color);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [parts, texture, wash]);
  if (!parts.length) return null;
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} castShadow={shadows} receiveShadow raycast={() => null}>
    {shape === 'box' && <boxGeometry />}
    {shape === 'crown' && <icosahedronGeometry args={[0.5, 1]} />}
    {shape === 'cone' && <coneGeometry args={[0.5, 1, 9]} />}
    {shape === 'cylinder' && <cylinderGeometry args={[0.5, 0.5, 1, 10]} />}
    {roof && <primitive object={roof} attach="geometry" />}
    {canopyMat ? <primitive object={canopyMat} attach="material" />
      : <meshStandardMaterial map={texture ?? null} roughness={texture ? .9 : .92}
          side={shape === 'slope' ? THREE.DoubleSide : THREE.FrontSide} />}
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
    return { timber: images[0], weathered: images[1], brick: images[2], plaster: neutralTexture(images[3]),
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
    texture={g.finish === 'plain' ? undefined : textures[g.finish]} wash={TINT_WASH[g.finish]} />)}</group>;
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

const GLASS = '#2e3c40', STONE = '#8b867b', DARK = '#3d3a35';
const WOOD = ['#886c50', '#785f47', '#997b58', '#899079', '#7d8a89', '#b1a184', '#9b755a', '#c0b295'];
const PLASTER = ['#d3c9b6', '#e1d6c1', '#c3bcae', '#bcbbae', '#ddd7cc', '#d8c89e'];
const BRICK = ['#a15e48', '#9b533d', '#b07456', '#8e5545', '#cfc6b4'];
const ROOF = ['#545959', '#656661', '#824e3f', '#7c5146', '#545c62', '#675e54'];
const FRAMES = ['#e8e4d8', '#e8e4d8', '#dfe3e0', '#b9c9cf'];
const SHUTTERS = ['#5f7d5b', '#6f8fa6', '#8a5a3c', '#c9c1ad', '#5b6f7c'];
const HIVES = ['#c9a640', '#6f8fa6', '#7f9a5a', '#d9d2bd'];

/**
 * Village buildings, yards and cover props, in metres (see METRE). Every cell
 * has a local frame: x along the street frontage, +z towards the street, y up.
 */
export function RuralBuildingsAndProps({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const parts = useMemo(() => {
    const parts = emptyParts();
    for (let z = section.y; z < section.y + section.height; z++) for (let x = section.x; x < section.x + section.width; x++) {
      const cell = terrain[z][x];
      if (cell.type !== 'urban' && !cell.prop && !cell.yard) continue;
      const angle = cell.propAngle ?? 0, cos = Math.cos(angle), sin = Math.sin(angle);
      const town = SETTLEMENTS.find(s => s.id === cell.settlementId);
      const off = cell.type === 'urban' ? cell.buildingOffset : undefined;
      const cx = x + .5 + (off?.[0] ?? 0), cz = z + .5 + (off?.[1] ?? 0), y = groundHeightAt(terrain, cx, cz);
      const r1 = hash2(x + 11, z), r2 = hash2(x, z + 13), r3 = hash2(x + 29, z + 7), r4 = hash2(x + 3, z + 31);
      const pick = <T,>(arr: T[], r: number) => arr[Math.floor(r * arr.length) % arr.length];
      /** One part at local position p (metres) with size s (metres); r = [rx, yaw, rz] in the local frame. */
      const put = (shape: Shape, p: V3, s: V3, color: string, finish: Finish = 'plain', r: V3 = [0, 0, 0]) => {
        const lx = p[0] * METRE, lz = p[2] * METRE;
        parts[shape].push({ p: [cx + cos * lx - sin * lz, y + p[1] * METRE, cz + sin * lx + cos * lz],
          s: [s[0] * METRE, s[1] * METRE, s[2] * METRE], r: [r[0], -angle + r[1], r[2]], color, finish });
      };
      const ALONG_X: V3 = [0, 0, Math.PI / 2], ALONG_Z: V3 = [0, Math.PI / 2, Math.PI / 2];

      /** Window in a wall: `axis` 'z' for the front/back walls (plane is their z), 'x' for the sides. */
      const windowOn = (axis: 'x' | 'z', n: number, plane: number, along: number, sill: number, w: number, h: number,
        frame: string, shutters?: string, simple = false) => {
        const at = (out: number, a: number): [number, number] => axis === 'x' ? [plane + n * out, a] : [a, plane + n * out];
        const size = (a: number, hh: number, t: number): V3 => axis === 'x' ? [t, hh, a] : [a, hh, t];
        const yc = sill + h / 2;
        let [px, pz] = at(.03, along); put('box', [px, yc, pz], size(w + .2, h + .2, .08), frame);
        [px, pz] = at(.06, along); put('box', [px, yc, pz], size(w, h, .04), GLASS);
        if (simple) return;
        [px, pz] = at(.085, along);
        put('box', [px, yc, pz], size(.07, h, .02), frame);
        put('box', [px, sill + h * .64, pz], size(w, .07, .02), frame);
        [px, pz] = at(.1, along); put('box', [px, sill - .05, pz], size(w + .32, .08, .18), frame);
        if (shutters) for (const s of [-1, 1]) {
          [px, pz] = at(.05, along + s * (w / 2 + .24));
          put('box', [px, yc, pz], size(.42, h + .1, .05), shutters);
        }
      };
      const doorOn = (axis: 'x' | 'z', n: number, plane: number, along: number, base: number, w: number, h: number, color: string, frame: string) => {
        const at = (out: number): [number, number] => axis === 'x' ? [plane + n * out, along] : [along, plane + n * out];
        const size = (a: number, hh: number, t: number): V3 => axis === 'x' ? [t, hh, a] : [a, hh, t];
        let [px, pz] = at(.03); put('box', [px, base + h / 2 + .05, pz], size(w + .22, h + .12, .08), frame);
        [px, pz] = at(.06); put('box', [px, base + h / 2, pz], size(w, h, .05), color);
        if (base > .12) { [px, pz] = at(.45); put('box', [px, base / 2, pz], size(w + .7, base, .9), STONE, 'plaster'); }
      };
      /**
       * Pitched roof over a w x d plan (centre zc): solid gable walls and attic
       * under two roof faces that overhang the walls. Ridge along z, or along x
       * when `alongX`. Returns the ridge height (metres).
       */
      const pitched = (w: number, d: number, zc: number, eave: number, pitch: number, wall: string, wallFinish: Finish,
        roof: string, roofFinish: Finish, alongX = false, finial = false, ox = 0) => {
        const t = Math.tan(pitch), oh = .5, og = .45;
        const span = alongX ? d : w, len = alongX ? w : d, yaw = alongX ? Math.PI / 2 : 0;
        put('gable', [ox, eave, zc], [span, span / 2 * t, len], wall, wallFinish, [0, yaw, 0]);
        const base = eave - oh * t + .1, rise = (span / 2 + oh) * t, top = base + rise;
        put('slope', [ox, base, zc], [span + 2 * oh, rise, len + 2 * og], roof, roofFinish, [0, yaw, 0]);
        // Ridge cap, eave fascias and the barge boards along the gable edges.
        put('box', [ox, top + .03, zc], alongX ? [len + 2 * og + .05, .14, .3] : [.3, .14, len + 2 * og + .05], DARK);
        const blen = (span / 2 + oh) / Math.cos(pitch);
        for (const s of [-1, 1]) {
          const across = s * (span / 2 + oh);
          if (alongX) put('box', [ox, base - .08, zc + across], [len + 2 * og, .2, .07], '#5a4c3e');
          else put('box', [ox + across, base - .08, zc], [.07, .2, len + 2 * og], '#5a4c3e');
          for (const e of [-1, 1]) {
            if (alongX) put('box', [ox + e * (len / 2 + og), base + rise / 2, zc + across / 2], [blen, .24, .07], '#d8cfba', 'plain', [0, yaw, s * pitch]);
            else put('box', [ox + across / 2, base + rise / 2, zc + e * (len / 2 + og)], [blen, .24, .07], '#d8cfba', 'plain', [0, 0, -s * pitch]);
          }
        }
        if (finial && !alongX) {
          // Crossed horse-head boards at the street gable apex (žirgeliai).
          for (const s of [-1, 1]) put('box', [ox, top + .22, zc + len / 2 + og], [.85, .1, .07], '#d8cfba', 'plain', [0, 0, s * .75]);
        }
        return top;
      };
      const hipped = (w: number, d: number, zc: number, eave: number, rise: number, roof: string, roofFinish: Finish, alongX = false) => {
        const yaw: V3 = [0, alongX ? Math.PI / 2 : 0, 0];
        put('hip', [0, eave - .05, zc], alongX ? [d + 1, rise, w + 1] : [w + 1, rise, d + 1], roof, roofFinish, yaw);
        put('box', [0, eave - .12, zc], [w + 1.04, .16, d + 1.04], '#5a4c3e');
        return eave + rise;
      };
      const chimney = (px: number, pz: number, from: number, to: number) => {
        put('box', [px, (from + to) / 2, pz], [.62, to - from, .62], '#9c8676', 'brick');
        put('box', [px, to + .06, pz], [.8, .12, .8], DARK);
      };
      const plinth = (w: number, d: number, zc: number, h: number, color = STONE) =>
        put('box', [0, (h - .7) / 2, zc], [w + .3, h + .7, d + .3], color, 'plaster');

      if (cell.yard) {
        // Farmstead yard: a rail fence on three sides, the side facing the
        // house or street left open. Trees are drawn with the woodland.
        const post = '#7d7158', rail = '#9a8e72';
        for (const s of [-1, 1]) {
          for (const pz of [-7.1, -3.6, -.1, 3.4, 6.6]) put('box', [s * 7.1, .62, pz], [.14, 1.24, .14], post);
          for (const h of [.5, 1.02]) put('box', [s * 7.1, h, -.25], [.06, .09, 13.7], rail);
        }
        for (const px of [-3.6, 0, 3.6]) put('box', [px, .62, -7.1], [.14, 1.24, .14], post);
        for (const h of [.5, 1.02]) put('box', [0, h, -7.1], [14.2, .09, .06], rail);
        if (cell.yard === 'garden') {
          // Vegetable beds either side of a path, or on one side with a granary
          // (svirnas) or a greenhouse on the other.
          for (const s of r1 > .3 ? [-1] : [-1, 1]) for (let i = 0; i < 5; i++) {
            const pz = -4.6 + i * 1.55;
            put('box', [s * 3.4, .08, pz], [5.2, .16, 1.0], '#5e4d38');
            put('box', [s * 3.4, .24, pz], [4.8, .18, .5], hash2(x + i * 3 + s, z) > .5 ? '#5f7c47' : '#6f8a4e');
          }
          if (r1 > .55) {
            // Svirnas: small timber granary on stone pads with a deep porch roof.
            const gx = 4.2, gz = -4.4;
            put('box', [gx, .25, gz], [3.4, .5, 3.0], STONE, 'plaster');
            put('box', [gx, 1.6, gz], [3.2, 2.2, 2.8], pick(WOOD, r2), 'weathered');
            pitched(3.2, 2.8, gz, 2.7, .8, pick(WOOD, r2), 'weathered', pick(ROOF, r3), r3 < .5 ? 'slate' : 'metal', false, false, gx);
            doorOn('z', 1, gz + 1.4, gx, .5, .9, 1.7, '#5b4a39', '#cfc6b0');
          } else if (r1 > .3) {
            // Polythene greenhouse.
            put('box', [4, 1.0, -4.6], [2.8, 2.0, 4.6], '#d6ddd6');
            put('gable', [4, 2.0, -4.6], [2.8, .8, 4.6], '#e1e6e1');
          }
        } else if (cell.yard === 'orchard') {
          // Fruit trees (woodland layer) over mown grass, and a row of beehives.
          const hives = 2 + Math.floor(r2 * 3);
          for (let i = 0; i < hives; i++) {
            const hx = -3.2 + i * 1.6, hz = 4.6, colour = pick(HIVES, hash2(x + i, z + 5));
            put('box', [hx, .2, hz], [.5, .4, .5], '#6b5a45');
            put('box', [hx, .72, hz], [.62, .64, .55], colour, 'timber');
            put('gable', [hx, 1.04, hz], [.72, .22, .66], '#59605c', 'metal');
          }
        } else {
          // Work yard: open woodshed, stacked firewood and a sweep well (svirtis) or a farm cart.
          put('box', [-3.4, 1.1, -5.6], [5.4, 2.2, .14], pick(WOOD, r2), 'weathered');
          for (const px of [-6, -.8]) for (const pz of [-5.6, -3.2]) put('box', [px, 1.15, pz], [.16, 2.3, .16], '#6d5d48');
          put('box', [-3.4, 2.3, -4.4], [5.8, .1, 3.0], '#6e706b', 'metal', [-.2, 0, 0]);
          for (let i = 0; i < 2; i++) {
            put('box', [-5 + i * 3.2, .7, -4.6], [2.8, 1.4, 1.1], '#8a6a48', 'weathered');
            put('box', [-5 + i * 3.2, .7, -4.02], [2.7, 1.3, .04], '#b89a6e');
          }
          if (r1 > .45) {
            const wx = 2.4, wz = 1.4;
            put('cylinder', [wx, .42, wz], [1.4, .84, 1.4], '#8f8a7e', 'plaster');
            put('cylinder', [wx + 2.6, 1.8, wz], [.24, 3.6, .24], '#6a5a46');
            // Sweep pole pivoting on the post top: the long arm rises over the
            // well and carries the bucket pole, the short arm a counterweight.
            put('cylinder', [wx + 1.97, 4.43, wz], [.13, 6.48, .13], '#7a684f', 'plain', [0, 0, .652]);
            put('cylinder', [wx, 4.0, wz], [.06, 6.0, .06], '#5a4a39');
            put('box', [wx + 3.94, 1.85, wz], [.5, .5, .4], '#77746c');
          } else {
            put('box', [3.2, .95, 1.4], [3.4, .5, 1.6], '#7d6a52', 'weathered');
            for (const sx of [-1.2, 1.2]) for (const sz of [-.95, .95]) put('cylinder', [3.2 + sx, .55, 1.4 + sz], [1.1, .1, 1.1], '#4f4337', 'plain', ALONG_Z);
            put('box', [5.6, .75, 1.4], [2.4, .08, .1], '#6a5a46');
          }
        }
      } else if (cell.type === 'urban') {
        const kind = cell.buildingKind ?? 'house';
        const roofColor = r3 < .25 && town?.roof ? town.roof : pick(ROOF, r2);
        const roofFinish: Finish = r2 < .24 ? 'clay' : r2 < .64 ? 'slate' : 'metal';
        const frame = pick(FRAMES, r4), shutter = pick(SHUTTERS, hash2(x + 7, z + 19));

        if (kind === 'block') {
          // Soviet-era three- or four-storey block of flats with a flat roof and balconies.
          const floors = 3 + (r1 > .5 ? 1 : 0), FH = 2.9, W = 14.4, D = 10.2, zc = -2.4, P = .8, H = floors * FH;
          plinth(W, D, zc, P, '#77746c');
          put('box', [0, P + H / 2, zc], [W, H, D], pick(PLASTER, r2), 'plaster');
          put('box', [0, P + H + .2, zc], [W + .2, .4, D + .2], '#5d5f5c');
          put('box', [W * .3, P + H + 1.5, zc - 1.5], [2.6, 2.6, 2.4], pick(PLASTER, r2), 'plaster');
          for (let f = 0; f < floors; f++) {
            const sill = P + f * FH + .85;
            for (let i = 0; i < 4; i++) {
              const along = (i - 1.5) * 3.3;
              if (!(f === 0 && i === 1)) windowOn('z', 1, zc + D / 2, along, sill, 1.4, 1.45, frame, undefined, true);
              windowOn('z', -1, zc - D / 2, along, sill, 1.4, 1.45, frame, undefined, true);
            }
            for (const s of [-1, 1]) windowOn('x', s, s * W / 2, zc, sill, 1.2, 1.4, frame, undefined, true);
            if (f > 0) for (const along of [-4.95, 4.95]) {
              put('box', [along, P + f * FH + .05, zc + D / 2 + .6], [2.8, .14, 1.2], '#8f8c84');
              put('box', [along, P + f * FH + .6, zc + D / 2 + 1.16], [2.8, .95, .08], '#9b978c');
            }
          }
          doorOn('z', 1, zc + D / 2, -1.65, P, 1.4, 2.2, '#5b5048', '#8c877c');
          put('box', [-1.65, P + 2.65, zc + D / 2 + .75], [2.6, .16, 1.5], '#8f8c84');
        } else if (kind === 'civic') {
          // Interwar school or district office: two storeys under a hipped roof, columned porch.
          const W = 14.6, D = 9.6, zc = -2.6, P = .8, E = 6.6, front = zc + D / 2;
          plinth(W, D, zc, P);
          put('box', [0, P + E / 2, zc], [W, E, D], pick(PLASTER, r1), 'plaster');
          put('box', [0, P + 3.3, zc], [W + .12, .22, D + .12], '#e3dccb');
          hipped(W, D, zc, P + E, 3.0, r2 < .5 ? '#7c5146' : '#565c60', r2 < .5 ? 'clay' : 'slate', true);
          for (let row = 0; row < 2; row++) {
            const sill = P + .95 + row * 3.3;
            for (let i = 0; i < 5; i++) {
              if (row === 0 && i === 2) continue;
              windowOn('z', 1, front, (i - 2) * 2.7, sill, 1.3, 1.6, '#ece7da');
              windowOn('z', -1, zc - D / 2, (i - 2) * 2.7, sill, 1.3, 1.6, '#ece7da', undefined, true);
            }
            for (const s of [-1, 1]) for (const along of [zc - 2, zc + 2]) windowOn('x', s, s * W / 2, along, sill, 1.2, 1.6, '#ece7da', undefined, true);
          }
          doorOn('z', 1, front, 0, P, 1.8, 2.5, '#5f4c3b', '#ece7da');
          for (const px of [-1.8, -.6, .6, 1.8]) put('cylinder', [px, (P + 3.3) / 2, front + 1.6], [.36, P + 3.3, .36], '#e6e0d2', 'plaster');
          put('box', [0, P + 3.45, front + 1.2], [4.6, .3, 2.6], '#e3dccb');
          put('gable', [0, P + 3.6, front + 1.2], [4.6, 1.1, 2.6], '#e6e0d2', 'plaster');
          put('box', [0, P * .5, front + 1.9], [4.8, P, 2.4], STONE, 'plaster');
        } else if (kind === 'brick') {
          // Masonry house, one and a half storeys, gable to the street; some
          // post-war ones under a hipped roof.
          const { W, D, zc, P, E, pitch, hip, hipRise } = brickPlan(x, z), front = zc + D / 2;
          const plaster = r2 > .55;
          const wall = plaster ? pick(PLASTER, r1) : pick(BRICK, r1), finish: Finish = plaster ? 'plaster' : 'brick';
          plinth(W, D, zc, P, '#7f7b72');
          put('box', [0, P + E / 2, zc], [W, E, D], wall, finish);
          put('box', [0, P + E - .1, zc], [W + .14, .2, D + .14], '#e1d9c6');
          if (hip) hipped(W, D, zc, P + E, hipRise, roofColor, r2 < .5 ? 'clay' : 'slate');
          else pitched(W, D, zc, P + E, pitch, wall, finish, roofColor, r2 < .5 ? 'clay' : 'slate');
          for (const s of [-1, 1]) windowOn('z', 1, front, s * W * .24, P + .85, 1.35, 1.4, frame, plaster ? undefined : shutter);
          if (!hip) windowOn('z', 1, front, 0, P + E + .6, .9, 1.0, frame);
          windowOn('z', -1, zc - D / 2, 0, P + .85, 1.2, 1.3, frame, undefined, true);
          for (const s of [-1, 1]) for (const along of [front - 2.2, zc - D / 2 + 2.2]) {
            if (s === 1 && along < zc) continue;
            windowOn('x', s, s * W / 2, along, P + .85, 1.25, 1.35, frame);
          }
          const zd = zc - D / 2 + 2.4;
          doorOn('x', 1, W / 2, zd, P, 1.0, 2.1, '#5c4a3a', frame);
          put('box', [W / 2 + .7, P + 2.45, zd], [1.4, .14, 1.9], '#8a857b');
          const flue = chimneyOf(cell, x, z)!;
          chimney(flue.lx, flue.lz, P + E, flue.top);
        } else if (kind === 'barn') {
          // Threshing barn / cowshed behind the house: long, fieldstone below,
          // weathered boards above, a big double door and a steep roof.
          const W = 11.6 + r2 * 2, D = 7.2 + r1 * .8, zc = -1.8, E = 3.0, front = zc + D / 2;
          put('box', [0, .1, zc], [W + .2, .9, D + .2], STONE, 'plaster');
          put('box', [0, .45, zc], [W, .9, D], '#8a8476', 'plaster');
          put('box', [0, .9 + (E - .9) / 2, zc], [W, E - .9, D], pick(WOOD, r3), 'weathered');
          pitched(W, D, zc, E, .8, pick(WOOD, r3), 'weathered', roofColor, r3 < .4 ? 'slate' : 'metal', true);
          const dx = -W * .12;
          put('box', [dx, 1.4, front + .05], [3.2, 2.7, .08], '#5a4a38', 'weathered');
          put('box', [dx, 1.4, front + .1], [.08, 2.7, .03], '#2f2a24');
          for (const s of [-1, 1]) put('box', [dx + s * .8, 1.4, front + .11], [1.9, .12, .03], '#8f7a5d', 'plain', [0, 0, s * .9]);
          put('box', [W * .3, 1.0, front + .05], [.95, 1.9, .07], '#5a4a38', 'weathered');
          for (const s of [-1, 1]) put('box', [s * W / 2 + s * .03, E + .9, zc], [.06, .6, 1.2], '#2f2a24');
        } else if (kind === 'workshop') {
          // Collective-farm workshop / machine shed: tall walls, low metal roof, sectional door.
          const W = 11.6, D = 8.8, zc = -2.2, P = .35, E = 4.0 + r1 * .5, front = zc + D / 2;
          const clad = r2 > .62;
          const wall = clad ? '#7f8a80' : pick(PLASTER, r2);
          plinth(W, D, zc, P, '#77746c');
          put('box', [0, P + E / 2, zc], [W, E, D], wall, clad ? 'metal' : 'plaster');
          pitched(W, D, zc, P + E, .26, wall, clad ? 'metal' : 'plaster', '#767978', 'metal', true);
          put('box', [-W * .18, P + 1.7, front + .05], [3.6, 3.4, .1], '#62706f', 'metal');
          doorOn('z', 1, front, W * .3, P, .95, 2.1, '#4c5351', '#8c877c');
          for (const along of [W * .14, W * .36]) windowOn('z', 1, front, along, P + 2.6, 1.2, .7, '#c9c6bb', undefined, true);
          for (const along of [zc - 2.4, zc, zc + 2.4]) windowOn('x', -1, -W / 2, along, P + 2.4, 1.3, .8, '#c9c6bb', undefined, true);
          // Lean-to shelter on the side.
          put('box', [W / 2 + 1.5, 2.6, zc - .5], [3.4, .1, 5.4], '#6e706b', 'metal', [0, 0, -.18]);
          for (const pz of [zc - 2.9, zc + 1.9]) put('box', [W / 2 + 3, 1.3, pz], [.16, 2.6, .16], '#5d5a52');
        } else {
          // Traditional Dzūkija pirkia: gable end to the street, log walls on
          // a fieldstone plinth, a steep roof, shuttered windows, a side porch
          // facing the yard and a chimney through the ridge. Churches use the
          // same nave with a plastered finish and add a tower.
          const church = kind === 'church';
          const plan = church ? { W: 9.2, D: 13.6, zc: -2.6, P: .7, E: 6.2, pitch: .84 } : cottagePlan(x, z);
          const { W, D, zc, P, E } = plan, front = zc + D / 2;
          const wall = church ? '#ddd6c6' : r3 < .3 && town?.wall ? town.wall : pick(WOOD, r1);
          const wallFinish: Finish = church ? 'plaster' : r1 < .65 ? 'timber' : 'weathered';
          plinth(W, D, zc, P);
          put('box', [0, P + E / 2, zc], [W, E, D], wall, wallFinish);
          pitched(W, D, zc, P + E, plan.pitch, church ? '#d3ccbc' : wall,
            church ? 'plaster' : 'weathered', church ? '#565f64' : roofColor, church ? 'slate' : roofFinish, false, !church);
          if (church) {
            for (const s of [-1, 1]) for (let i = 0; i < 3; i++) windowOn('x', s, s * W / 2, zc - 3.6 + i * 3.4, P + 1.6, 1.1, 2.8, '#e8e2d4', undefined, true);
            // Tower over the street front, with a belfry and a spire.
            const tz = front - 2.0, TH = 16.5;
            put('box', [0, TH / 2, tz], [4.4, TH, 4.4], '#e2dccd', 'plaster');
            put('box', [0, TH + .15, tz], [4.9, .3, 4.9], '#cfc8b8');
            for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
              put('box', [nx * 2.22, TH - 2.2, tz + nz * 2.22], nx ? [.06, 2.0, 1.1] : [1.1, 2.0, .06], DARK);
            }
            put('spire', [0, TH + .3, tz], [4.6, 7.0, 4.6], '#4f5a5c', 'slate');
            put('box', [0, TH + 8.1, tz], [.12, 1.6, .12], '#3b3b36');
            put('box', [0, TH + 8.4, tz], [.8, .12, .12], '#3b3b36');
            doorOn('z', 1, tz + 2.2, 0, P, 1.8, 3.0, '#5c4632', '#cfc8b8');
            windowOn('z', 1, tz + 2.2, 0, 8.5, .9, 1.8, '#e8e2d4', undefined, true);
          } else {
            // Street gable: two shuttered windows below, a small attic window above.
            for (const s of [-1, 1]) windowOn('z', 1, front, s * W * .24, P + .8, .9, 1.15, frame, shutter);
            windowOn('z', 1, front, 0, P + E + .55, .6, .75, frame);
            for (const s of [-1, 1]) {
              windowOn('x', s, s * W / 2, front - 1.9, P + .8, .9, 1.15, frame, s < 0 ? shutter : undefined);
              windowOn('x', s, s * W / 2, front - 4.3, P + .8, .9, 1.15, frame);
            }
            if (D > 10.2) windowOn('x', -1, -W / 2, zc - D / 2 + 1.6, P + .8, .9, 1.15, frame);
            windowOn('z', -1, zc - D / 2, 0, P + .8, .9, 1.15, frame, undefined, true);
            // Side door under a small gabled porch, facing the yard.
            const zd = zc - D / 2 + 2.3;
            doorOn('x', 1, W / 2, zd, P, 1.0, 2.0, '#5b4a3a', frame);
            put('box', [W / 2 + .9, P / 2, zd], [1.8, P, 1.9], '#857963', 'weathered');
            for (const pz of [zd - .85, zd + .85]) put('box', [W / 2 + 1.65, P + 1.15, pz], [.12, 2.3, .12], '#cfc6b0');
            put('gable', [W / 2 + .9, P + 2.3, zd], [2.3, .8, 2.0], roofColor, roofFinish, [0, Math.PI / 2, 0]);
            // Painted corner boards.
            if (r1 > .3) for (const sx of [-1, 1]) for (const sz of [-1, 1])
              put('box', [sx * (W / 2 - .05), P + E / 2, zc + sz * (D / 2 - .05)], [.16, E, .16], '#ddd3bb');
            const flue = chimneyOf(cell, x, z)!;
            chimney(flue.lx, flue.lz, P + E, flue.top);
          }
        }
      } else if (cell.prop === 'boulder') {
        // Glacial field stones, half sunk into the ground.
        put('crown', [-1.4, .45, -3.6], [2.8, 1.5, 2.2], '#858c7d', 'plain', [0, r1 * 3, 0]);
        put('crown', [1.4, .3, -3.2], [1.6, 1.0, 1.4], '#9b9e8d', 'plain', [0, r2 * 3, 0]);
        put('crown', [.3, .2, -1.8], [.9, .6, .8], '#8d9182');
      } else if (cell.prop === 'scrub') {
        for (const [px, pz, sx, sy] of [[-3.2, -3.4, 3.0, 2.2], [0, -3.8, 3.6, 2.6], [3.0, -3.0, 2.6, 2.0], [-.8, -1.6, 2.0, 1.4]]) {
          put('crown', [px, sy * .42, pz], [sx, sy, sx * .9], px === 0 ? '#5f7039' : '#76874f', 'plain', [0, px, 0]);
        }
      } else if (cell.prop === 'logs') {
        // Stacked pine logs at the wood edge, about a metre high.
        const R = .44;
        for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 4 - layer; i++) {
          const pz = -4.4 + (i + layer * .5) * R, py = R / 2 + layer * R * .86;
          put('cylinder', [0, py, pz], [R, 6.2, R], '#6e573f', 'plain', ALONG_X);
          put('cylinder', [3.11, py, pz], [R * .86, .03, R * .86], '#c2a476', 'plain', ALONG_X);
        }
      } else if (cell.prop === 'hay') {
        // Round bales, three on the ground and two on top.
        for (const [px, py] of [[-1.6, .75], [0, .75], [1.6, .75], [-.8, 2.05], [.8, 2.05]]) {
          put('cylinder', [px, py, -3.8], [1.5, 1.25, 1.5], '#b3a26b', 'plain', ALONG_Z);
          put('cylinder', [px, py, -3.16], [1.3, .03, 1.3], '#c8b97f', 'plain', ALONG_Z);
        }
      } else if (cell.prop === 'stone_wall') {
        // Dry fieldstone wall about a metre high.
        for (let layer = 0; layer < 2; layer++) for (let i = 0; i < 7; i++) {
          const j = hash2(x + i * 5, z + layer * 7);
          put('box', [-5.4 + i * 1.8 + layer * .6, .3 + layer * .5, -4.2 + (j - .5) * .2], [1.6 + j * .4, .62 - layer * .1, .95 - layer * .15],
            ['#8f9586', '#a0a091', '#7d877c'][(i + layer) % 3], 'plaster', [0, (j - .5) * .25, 0]);
        }
      } else if (cell.prop === 'wreck') {
        // Burnt-out car.
        put('box', [0, .72, -3.6], [4.3, .8, 1.75], '#6f5c45', 'metal', [0, .06, .04]);
        put('box', [-.3, 1.42, -3.6], [2.2, .62, 1.55], '#7a6a52', 'metal', [0, .06, .04]);
        put('box', [-.3, 1.42, -2.82], [1.9, .45, .03], '#2b2f2e');
        for (const px of [-1.35, 1.35]) for (const pz of [-4.45, -2.75]) put('cylinder', [px, .32, pz], [.64, .22, .64], '#2f3331', 'plain', ALONG_Z);
      } else {
        // Roadblock: posts, a plank screen and a row of sandbags.
        for (const px of [-2.6, 2.6]) put('box', [px, .7, -4], [.2, 1.4, .2], '#6d5d48');
        put('box', [0, .95, -4], [6.0, .9, .1], '#8a7558', 'weathered');
        for (let i = 0; i < 8; i++) put('box', [-2.8 + i * .8, .2, -3.4], [.75, .4, .45], '#a99b78');
      }
    }
    return parts;
  }, [terrain, section]);
  return <BuildingBatches parts={parts} />;
}
