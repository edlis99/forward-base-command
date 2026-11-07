import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameState, TerrainCell } from '../game/types';
import { meshHeight } from './groundCover';
import { groundTex } from './groundTextures';
import { trafficPlan, type SignType, type SignalHead } from './roadRules';

/**
 * The road furniture of the traffic plan (roadRules.ts): sign posts, traffic
 * lights, the roundabout's island and the painted markings at junctions and
 * crossings. Everything is instanced; the lights change by game time (a
 * paused battle holds them).
 */

// Sizes in cells (one cell is about 12 m), a little over life size so they read from above.
const SIGN = .085, NAME_W = .2, NAME_H = .072, POLE_R = .005, PLATE_FROM = .19, PLATE_GAP = .012;
const LIGHT_POLE = .3, HOUSING: [number, number, number] = [.038, .104, .026], LAMP_R = .015, LAMP_STEP = .032;

// ---------- The sign atlas: Lithuanian signs drawn in their standard shapes and colours. ----------
const ATLAS_W = 2048, ATLAS_H = 1024, CELL = 128, NAME_CW = 256, NAME_CH = 94;
const STANDARD: SignType[] = ['main-road', 'give-way', 'stop', 'roundabout', 'crossing', 'warn-junction', 'warn-roundabout', 'warn-signals', 'warn-crossing', 'speed-70'];
const RED = '#c8102e', BLUE = '#0b4ea2', YELLOW = '#f6c400';

function triangle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, up: boolean) {
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = (up ? -Math.PI / 2 : Math.PI / 2) + k * Math.PI * 2 / 3;
    if (k) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}
/** A warning sign: white triangle, red border, its symbol drawn by `symbol` in black. */
function warning(ctx: CanvasRenderingContext2D, x: number, y: number, symbol: (cx: number, cy: number) => void) {
  const cx = x + CELL / 2, cy = y + CELL / 2 + 10;
  ctx.lineJoin = 'round';
  triangle(ctx, cx, cy, 62, true); ctx.fillStyle = RED; ctx.fill();
  triangle(ctx, cx, cy, 44, true); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.fillStyle = '#111111'; ctx.strokeStyle = '#111111';
  symbol(cx, cy + 4);
}
function roundArrows(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, width: number) {
  ctx.lineWidth = width; ctx.lineCap = 'butt';
  for (let k = 0; k < 3; k++) {
    const a0 = k * Math.PI * 2 / 3 + .35, a1 = a0 + 1.45;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    // Arrowheads anticlockwise (traffic goes round to the right of the island).
    const ax = cx + Math.cos(a1) * r, ay = cy + Math.sin(a1) * r, t = a1 + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(t) * width * 1.2, ay + Math.sin(t) * width * 1.2);
    ctx.lineTo(ax + Math.cos(a1) * width * 1.3, ay + Math.sin(a1) * width * 1.3);
    ctx.lineTo(ax - Math.cos(a1) * width * 1.3, ay - Math.sin(a1) * width * 1.3);
    ctx.closePath(); ctx.fill();
  }
}
function pedestrian(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.lineCap = 'round'; ctx.lineWidth = s * .16;
  ctx.beginPath(); ctx.arc(cx + s * .06, cy - s * .5, s * .12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx, cy - s * .32); ctx.lineTo(cx - s * .04, cy + s * .08); // body
  ctx.moveTo(cx - s * .04, cy + s * .08); ctx.lineTo(cx - s * .26, cy + s * .48); // leg
  ctx.moveTo(cx - s * .04, cy + s * .08); ctx.lineTo(cx + s * .2, cy + s * .46);
  ctx.moveTo(cx, cy - s * .24); ctx.lineTo(cx - s * .24, cy - s * .02); // arms
  ctx.moveTo(cx, cy - s * .24); ctx.lineTo(cx + s * .24, cy - s * .08);
  ctx.stroke();
}

function drawStandard(ctx: CanvasRenderingContext2D, type: SignType, x: number, y: number) {
  const cx = x + CELL / 2, cy = y + CELL / 2;
  ctx.save();
  switch (type) {
    case 'main-road': // 201: a yellow diamond in a white one, thin dark rim
      ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-44, -44, 88, 88);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-42, -42, 84, 84);
      ctx.fillStyle = YELLOW; ctx.fillRect(-27, -27, 54, 54);
      break;
    case 'give-way': // 203: inverted triangle, red border, white inside
      triangle(ctx, cx, cy - 12, 62, false); ctx.fillStyle = RED; ctx.fill();
      triangle(ctx, cx, cy - 12, 40, false); ctx.fillStyle = '#ffffff'; ctx.fill();
      break;
    case 'stop': { // 204: red octagon, white rim, STOP
      const oct = (r: number) => { ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; if (k) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); };
      oct(62); ctx.fillStyle = '#ffffff'; ctx.fill(); oct(57); ctx.fillStyle = RED; ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px Arial, Helvetica, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('STOP', cx, cy + 2);
      break;
    }
    case 'roundabout': // the round blue roundabout sign: three white arrows going round
      ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI * 2); ctx.fillStyle = BLUE; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff';
      roundArrows(ctx, cx, cy, 30, 11);
      break;
    case 'crossing': // 533 "Pėsčiųjų perėja": blue square, white triangle, black pedestrian on the zebra
      ctx.fillStyle = BLUE; ctx.fillRect(x + 6, y + 6, CELL - 12, CELL - 12);
      triangle(ctx, cx, cy + 6, 50, true); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#111111'; ctx.strokeStyle = '#111111';
      for (let k = 0; k < 4; k++) ctx.fillRect(cx - 26 + k * 14, cy + 22, 8, 6);
      pedestrian(ctx, cx, cy + 4, 34);
      break;
    case 'warn-junction': // a side road joining the main road (the main road drawn thicker)
      warning(ctx, x, y, (wx, wy) => { ctx.fillRect(wx - 6, wy - 22, 12, 40); ctx.fillRect(wx, wy - 4, 20, 7); });
      break;
    case 'warn-roundabout':
      warning(ctx, x, y, (wx, wy) => roundArrows(ctx, wx, wy - 2, 15, 5));
      break;
    case 'warn-signals': // traffic lights ahead: the three lamps
      warning(ctx, x, y, (wx, wy) => {
        ctx.fillRect(wx - 9, wy - 24, 18, 42);
        [['#e2231a', -15], ['#f6b400', -3], ['#1fa34a', 9]].forEach(([c, dy]) => { ctx.fillStyle = c as string; ctx.beginPath(); ctx.arc(wx, wy + (dy as number), 5, 0, Math.PI * 2); ctx.fill(); });
      });
      break;
    case 'warn-crossing':
      warning(ctx, x, y, (wx, wy) => { for (let k = 0; k < 4; k++) ctx.fillRect(wx - 18 + k * 10, wy + 14, 6, 4); pedestrian(ctx, wx, wy - 4, 26); });
      break;
    case 'speed-70': // the speed limit: white disc, red ring, black figures
      ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI * 2); ctx.fillStyle = RED; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.fillStyle = '#111111'; ctx.font = 'bold 50px Arial, Helvetica, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('70', cx, cy + 3);
      break;
    default: break;
  }
  ctx.restore();
}
/** A place-name plate: 550 white with a black rim (its end sign struck through in red), 612 blue. */
function drawName(ctx: CanvasRenderingContext2D, type: SignType, name: string, x: number, y: number) {
  const w = NAME_CW - 8, h = NAME_CH - 8, x0 = x + 4, y0 = y + 4, blue = type === 'place-name';
  ctx.save();
  ctx.fillStyle = blue ? BLUE : '#111111'; ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = blue ? '#ffffff' : '#ffffff'; ctx.fillRect(x0 + 5, y0 + 5, w - 10, h - 10);
  if (blue) { ctx.fillStyle = BLUE; ctx.fillRect(x0 + 9, y0 + 9, w - 18, h - 18); }
  let size = 44;
  ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
  while (ctx.measureText(name.toUpperCase()).width > w - 34 && size > 18) { size -= 2; ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`; }
  ctx.fillStyle = blue ? '#ffffff' : '#111111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name.toUpperCase(), x0 + w / 2, y0 + h / 2 + 2);
  if (type === 'town-end') {
    ctx.strokeStyle = RED; ctx.lineWidth = 9; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0 + 14, y0 + h - 12); ctx.lineTo(x0 + w - 14, y0 + 12); ctx.stroke();
  }
  ctx.restore();
}

interface AtlasEntry { rect: [number, number, number, number]; w: number; h: number }
/** The atlas, and where each sign (or name plate) lies in it, as UV rectangles [u, v, du, dv]. */
function buildAtlas(names: { type: SignType; text: string }[]) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W; canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d')!;
  const entries = new Map<string, AtlasEntry>();
  const uv = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x / ATLAS_W, 1 - (y + h) / ATLAS_H, w / ATLAS_W, h / ATLAS_H];
  STANDARD.forEach((type, k) => {
    const x = k * CELL;
    drawStandard(ctx, type, x, 0);
    entries.set(type, { rect: uv(x, 0, CELL, CELL), w: SIGN, h: SIGN });
  });
  names.forEach((n, k) => {
    const x = (k % 8) * NAME_CW, y = CELL + Math.floor(k / 8) * NAME_CH;
    if (y + NAME_CH > ATLAS_H) return;
    drawName(ctx, n.type, n.text, x, y);
    entries.set(`${n.type}:${n.text}`, { rect: uv(x, y, NAME_CW, NAME_CH), w: NAME_W, h: NAME_H });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return { texture, entries };
}

/** Traffic light colours by game time, Lithuanian sequence: green, amber, red, red and amber, green. */
function lightState(group: 0 | 1, t: number): [boolean, boolean, boolean] {
  const c = ((t % 26) + 26) % 26;
  if (group === 0) return c < 10 ? [false, false, true] : c < 13 ? [false, true, false] : c < 24 ? [true, false, false] : [true, true, false];
  return c < 11 ? [true, false, false] : c < 13 ? [true, true, false] : c < 23 ? [false, false, true] : [false, true, false];
}
const LAMP_ON = [new THREE.Color('#ff2a1a'), new THREE.Color('#ffb000'), new THREE.Color('#2bff6a')];
const LAMP_OFF = [new THREE.Color('#2a0806'), new THREE.Color('#2a1e04'), new THREE.Color('#07220f')];

export function RoadFurniture({ gameStateRef, terrain }: { gameStateRef: React.MutableRefObject<GameState>; terrain: TerrainCell[][] }) {
  const plan = useMemo(() => trafficPlan(), []);
  const ground = (x: number, z: number) => meshHeight(terrain, x, z);
  // Posts standing in water (a verge that is a river bank) are left out.
  const posts = useMemo(() => plan.posts.filter(p => terrain[Math.floor(p.y)]?.[Math.floor(p.x)]?.type !== 'water'), [plan, terrain]);

  // ---- Sign plates and their poles ----
  const signs = useMemo(() => {
    const names = [...new Map(posts.flatMap(p => p.plates).filter(pl => pl.text).map(pl => [`${pl.type}:${pl.text}`, { type: pl.type, text: pl.text! }])).values()];
    const atlas = buildAtlas(names);
    const plates: { m: THREE.Matrix4; rect: [number, number, number, number] }[] = [];
    const poles: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (const post of posts) {
      const y0 = ground(post.x, post.y);
      // A plate's face looks along `facing`: turn the plane (facing +z) about the vertical.
      q.setFromAxisAngle(up, Math.PI / 2 - post.facing);
      let top = y0 + PLATE_FROM;
      const sizes = post.plates.map(pl => atlas.entries.get(pl.text ? `${pl.type}:${pl.text}` : pl.type)).filter((e): e is AtlasEntry => !!e);
      const height = sizes.reduce((n, e) => n + e.h + PLATE_GAP, 0);
      top += height;
      let y = top;
      for (const e of sizes) {
        y -= e.h / 2;
        plates.push({ m: new THREE.Matrix4().compose(pos.set(post.x, y, post.y), q, scl.set(e.w, e.h, 1)), rect: e.rect });
        y -= e.h / 2 + PLATE_GAP;
      }
      // The pole stands just behind the plates.
      const bx = -Math.cos(post.facing) * .006, bz = -Math.sin(post.facing) * .006;
      poles.push(new THREE.Matrix4().compose(pos.set(post.x + bx, y0 - .01, post.y + bz), new THREE.Quaternion(), scl.set(POLE_R, top - y0 - .005, POLE_R)));
    }
    return { atlas, plates, poles };
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  const plateMesh = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const rects = new Float32Array(signs.plates.length * 4);
    signs.plates.forEach((p, i) => rects.set(p.rect, i * 4));
    geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rects, 4));
    const material = new THREE.MeshLambertMaterial({ map: signs.atlas.texture, alphaTest: .5, side: THREE.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute vec4 aRect;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = aRect.xy + uv * aRect.zw;');
      // The back of a sign is bare grey metal; the face is retroreflective, a touch brighter than the ground's light.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.36, 0.37, 0.38);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (gl_FrontFacing) totalEmissiveRadiance += diffuseColor.rgb * 0.18;');
    };
    material.customProgramCacheKey = () => 'road-sign-plates-v1';
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, signs.plates.length));
    signs.plates.forEach((p, i) => mesh.setMatrixAt(i, p.m));
    mesh.count = signs.plates.length;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.raycast = () => null;
    return mesh;
  }, [signs]);

  const poleMesh = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, .5, 0);
    const material = new THREE.MeshStandardMaterial({ color: '#8d9296', roughness: .45, metalness: .6 });
    const all = [...signs.poles];
    // Traffic light poles.
    for (const s of plan.signals) all.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, ground(s.x, s.y) - .01, s.y), new THREE.Quaternion(), new THREE.Vector3(POLE_R * 1.5, LIGHT_POLE, POLE_R * 1.5)));
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, all.length));
    all.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = all.length;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.raycast = () => null;
    return mesh;
  }, [signs, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Traffic lights: a housing per approach, three lamps lit by the cycle ----
  const lights = useMemo(() => {
    const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(...HOUSING), new THREE.MeshStandardMaterial({ color: '#1b1d1f', roughness: .6 }), Math.max(1, plan.signals.length));
    const lamps = new THREE.InstancedMesh(new THREE.CircleGeometry(LAMP_R, 16), new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, plan.signals.length * 3));
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4();
    plan.signals.forEach((s: SignalHead, i) => {
      const y = ground(s.x, s.y) + LIGHT_POLE - HOUSING[1] / 2;
      q.setFromAxisAngle(up, Math.PI / 2 - s.facing);
      housing.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, y, s.y), q, new THREE.Vector3(1, 1, 1)));
      const fx = Math.cos(s.facing) * (HOUSING[2] / 2 + .001), fz = Math.sin(s.facing) * (HOUSING[2] / 2 + .001);
      for (let k = 0; k < 3; k++) lamps.setMatrixAt(i * 3 + k, m.compose(new THREE.Vector3(s.x + fx, y + (1 - k) * LAMP_STEP, s.y + fz), q, new THREE.Vector3(1, 1, 1)));
    });
    housing.count = plan.signals.length; lamps.count = plan.signals.length * 3;
    for (let k = 0; k < lamps.count; k++) lamps.setColorAt(k, LAMP_OFF[k % 3]);
    // A soft glow round each lit lamp, turned to the camera: from above the lamps
    // themselves are seen edge-on, the glow shows what the light says.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const g = glowCanvas.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(.25, 'rgba(255,255,255,.75)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), Math.max(1, plan.signals.length * 2));
    glows.count = plan.signals.length * 2;
    for (let k = 0; k < glows.count; k++) glows.setColorAt(k, new THREE.Color(0, 0, 0));
    for (const mesh of [housing, lamps, glows]) { mesh.frustumCulled = false; mesh.raycast = () => null; }
    housing.castShadow = true;
    return { housing, lamps, glows, glowTex };
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- The roundabout's island: a kerb, grass, a flower bed and a stone ----
  const islands = useMemo(() => {
    const group = new THREE.Group();
    const grassTex = groundTex('grass', 'diffuse');
    const kerb = new THREE.MeshStandardMaterial({ color: '#b9b7ae', roughness: .9 });
    const lawn = new THREE.MeshStandardMaterial({ map: grassTex, color: '#9dbb6a', roughness: 1 });
    const bed = new THREE.MeshStandardMaterial({ color: '#5b3f2c', roughness: 1 });
    const shrub = new THREE.MeshStandardMaterial({ color: '#3f5a2c', roughness: 1, flatShading: true });
    const stone = new THREE.MeshStandardMaterial({ color: '#8b8a86', roughness: .8, flatShading: true });
    for (const r of plan.roundabouts) {
      const y = ground(r.x, r.y);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r.island, r.island, .016, 48), [kerb, lawn, kerb]);
      disc.position.set(r.x, y + .008, r.y);
      const bedMesh = new THREE.Mesh(new THREE.CylinderGeometry(r.island * .42, r.island * .42, .022, 32), [bed, bed, bed]);
      bedMesh.position.set(r.x, y + .011, r.y);
      // Low clipped shrubs round the bed, a field stone in the middle.
      const shrubs = Array.from({ length: 11 }, (_, k) => {
        const a = k / 11 * Math.PI * 2, m = new THREE.Mesh(new THREE.DodecahedronGeometry(.03, 0), shrub);
        m.scale.set(1.3, .8, 1.3); m.position.set(r.x + Math.cos(a) * r.island * .36, y + .035, r.y + Math.sin(a) * r.island * .36);
        return m;
      });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.07, 0), stone);
      rock.scale.set(1, 1.3, .9); rock.position.set(r.x, y + .07, r.y);
      for (const o of [disc, bedMesh, ...shrubs, rock]) { o.castShadow = true; o.receiveShadow = true; o.raycast = () => null; group.add(o); }
    }
    return group;
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Painted markings: decals laid on the ground as drawn ----
  const markings = useMemo(() => {
    const pos: number[] = [], uv: number[] = [], type: number[] = [], size: number[] = [], index: number[] = [];
    const kinds = { zebra: 0, 'signal-crossing': 1, 'stop-line': 2, 'give-way': 3 } as const;
    for (const mk of plan.markings) {
      const ax = Math.cos(mk.angle), az = Math.sin(mk.angle), rx = -az, rz = ax;
      const na = Math.max(1, Math.ceil(mk.along / .08)), nc = Math.max(2, Math.ceil(mk.across / .08)), base = pos.length / 3;
      for (let j = 0; j <= na; j++) for (let i = 0; i <= nc; i++) {
        const u = i / nc, v = j / na, oc = (u - .5) * mk.across, oa = (v - .5) * mk.along;
        const x = mk.x + rx * oc + ax * oa, z = mk.y + rz * oc + az * oa;
        pos.push(x, ground(x, z) + .004, z); uv.push(u, v); type.push(kinds[mk.type]); size.push(mk.across * 12, mk.along * 12);
      }
      for (let j = 0; j < na; j++) for (let i = 0; i < nc; i++) {
        const a = base + j * (nc + 1) + i, b = a + 1, c = a + nc + 1, d = c + 1;
        index.push(a, b, c, b, d, c); // facing up
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('aType', new THREE.Float32BufferAttribute(type, 1));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    geometry.setIndex(index);
    const material = new THREE.MeshLambertMaterial({ color: '#dcdcd4', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute vec2 aUv; attribute float aType; attribute vec2 aSize;\nvarying vec2 vMk; varying float vType; varying vec2 vSize; varying vec2 vWorld;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vMk = aUv; vType = aType; vSize = aSize; vWorld = position.xz;');
      shader.fragmentShader = 'varying vec2 vMk; varying float vType; varying vec2 vSize; varying vec2 vWorld;\n'
        + 'float mkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n'
        + 'float mkNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);\n'
        + '  return mix(mix(mkHash(i), mkHash(i + vec2(1.0, 0.0)), u.x), mix(mkHash(i + vec2(0.0, 1.0)), mkHash(i + vec2(1.0, 1.0)), u.x), u.y); }\n'
        + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  // Metres across and along the marking, and how much a pixel covers.
  vec2 m = vMk * vSize, aa = fwidth(m) * 0.75 + 0.01;
  float paint = 0.0;
  if (vType < 0.5) {
    // 1.13 zebra: 0.5 m bars along the road, 0.5 m apart, the width of the carriageway.
    float k = fract(m.x - 0.25);
    paint = smoothstep(-aa.x, aa.x, k - 0.0) * (1.0 - smoothstep(0.5 - aa.x, 0.5 + aa.x, k));
    paint *= smoothstep(0.08, 0.08 + aa.x, m.x) * (1.0 - smoothstep(vSize.x - 0.08 - aa.x, vSize.x - 0.08, m.x));
  } else if (vType < 1.5) {
    // 1.13.3 crossing with traffic lights: two rows of 0.5 m squares along its edges.
    float k = fract(m.x);
    float squares = 1.0 - smoothstep(0.5 - aa.x, 0.5 + aa.x, k);
    float rows = (1.0 - smoothstep(0.5 - aa.y, 0.5 + aa.y, m.y)) + smoothstep(vSize.y - 0.5 - aa.y, vSize.y - 0.5 + aa.y, m.y);
    paint = squares * rows;
  } else if (vType < 2.5) {
    // 1.11 stop line: solid.
    paint = 1.0;
  } else {
    // 1.12 give-way: a row of triangles, their points towards the oncoming driver.
    float p = 0.75, k = abs(fract(m.x / p) * p - p * 0.5);
    float halfW = 0.24 * (1.0 - vMk.y);
    paint = 1.0 - smoothstep(halfW - aa.x, halfW + aa.x, k);
  }
  // Worn paint, scuffed where the wheels run.
  paint *= 0.78 + 0.22 * mkNoise(vWorld * 9.0);
  diffuseColor.a *= paint * 0.94;
  if (diffuseColor.a < 0.02) discard;`);
    };
    material.customProgramCacheKey = () => 'road-markings-v1';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1; mesh.receiveShadow = true; mesh.raycast = () => null; mesh.frustumCulled = false;
    return mesh;
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    for (const mesh of [plateMesh, poleMesh, lights.housing, lights.lamps, lights.glows, markings]) {
      mesh.geometry.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose());
    }
    signs.atlas.texture.dispose(); lights.glowTex.dispose();
  }, [plateMesh, poleMesh, lights, markings, signs]);

  const glowTmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3(), off: new THREE.Color(0, 0, 0) }), []);
  useFrame(({ camera }) => {
    if (!plan.signals.length) return;
    const t = gameStateRef.current.time;
    plan.signals.forEach((s, i) => {
      const on = lightState(s.group, t), y = ground(s.x, s.y) + LIGHT_POLE - HOUSING[1] / 2;
      const fx = Math.cos(s.facing) * (HOUSING[2] / 2 + .012), fz = Math.sin(s.facing) * (HOUSING[2] / 2 + .012);
      let glow = 0;
      for (let k = 0; k < 3; k++) {
        lights.lamps.setColorAt(i * 3 + k, on[k] ? LAMP_ON[k] : LAMP_OFF[k]);
        if (on[k] && glow < 2) {
          glowTmp.p.set(s.x + fx, y + (1 - k) * LAMP_STEP, s.y + fz);
          lights.glows.setMatrixAt(i * 2 + glow, glowTmp.m.compose(glowTmp.p, camera.quaternion, glowTmp.s.set(.055, .055, 1)));
          lights.glows.setColorAt(i * 2 + glow, LAMP_ON[k]);
          glow++;
        }
      }
      for (; glow < 2; glow++) lights.glows.setColorAt(i * 2 + glow, glowTmp.off);
    });
    if (lights.lamps.instanceColor) lights.lamps.instanceColor.needsUpdate = true;
    lights.glows.instanceMatrix.needsUpdate = true;
    if (lights.glows.instanceColor) lights.glows.instanceColor.needsUpdate = true;
  });

  return <group name="road-furniture">
    <primitive object={markings} />
    <primitive object={plateMesh} />
    <primitive object={poleMesh} />
    <primitive object={lights.housing} />
    <primitive object={lights.lamps} />
    <primitive object={lights.glows} />
    <primitive object={islands} />
  </group>;
}
