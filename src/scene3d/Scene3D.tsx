import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState, InputState, Unit, TerrainCell } from '../game/types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import {
  handleRightClickWorld, updateCommandPreview, clearCommandPreview,
} from '../game/engine';
import { cellCoverScore, cellConcealmentScore, cellTacticalScore, scoreToColor } from '../game/tactical';
import { GroundSurface, WaterSheet, GrassTufts, GroundDetail } from './GroundSurface';
import { MAP_SECTIONS, MapSection } from './mapSections';
import { CampaignMap } from '../components/CampaignMap';
import { SETTLEMENTS } from '../game/maps/settlements';
import { PLAYABLE_CELLS } from '../game/maps/geography';
import { FOB_RULES, visibleFobs } from '../game/fob';
import { revealUniforms, MAX_REVEAL } from './canopyReveal';
import { Sky } from '@react-three/drei';
import PostEffects from './PostEffects';
import { AmbienceClock, ChimneySmoke, Birds, AmbientSound } from './Ambience';
import { SettlementLabelPositions } from './SettlementLabels';
import { RuralBuildingsAndProps } from './Environment';
import { RealisticVegetation } from './RealisticVegetation';
import { getTerrainAt } from '../game/terrain';
import { factionFor } from '../game/factions';
import { FactionUnitModel } from './FactionModels';
import { coverLabel, isOccupyableCover, coverState, unitStatus } from '../game/cover';
import { controllable, selectUnits } from '../game/selection';
import { Shield, Footprints, Truck, Crosshair } from 'lucide-react';
import { spacingRadius } from '../game/playerSquads';
import { setActiveTerrain, surfaceY, groundHeightAt } from './terrainHeight';


const S = CELL_SIZE;
const W = MAP_COLS;
const H = MAP_ROWS;
const DRAG_THRESHOLD_PX = 5;

const TERRAIN_COLORS: Record<string, string> = {
  open: '#8a9c62', urban: '#a89c8c', forest: '#5b7444', road: '#7d7568',
  water: '#3a6c8c', wall: '#9a9287', trench: '#6d5a3d', rubble: '#a49c90',
  sandbag: '#c6b487', mud: '#7a6647', crater: '#7a6546', hedgerow: '#5f7c46',
  tall_grass: '#93a566', gravel: '#b0a68e',
};


const TERRAIN_HEIGHT: Record<string, number> = {
  open: 0.02, urban: 1.6, forest: 0.05, road: 0.01,
  water: -0.18, wall: 1.3, trench: -0.35, rubble: 0.22,
  sandbag: 0.55, mud: 0, crater: -0.4, hedgerow: 1.0,
  tall_grass: 0.18, gravel: 0.02,
};

const MARKER_COLOR: Record<string, string> = {
  move: '#7ec0ff', attack: '#ff6a4a', capture: '#f0d04a',
  board: '#7adc7a', hold: '#e8e8e8', attack_move: '#ffb070',
};

interface SceneProps {
  gameStateRef: React.MutableRefObject<GameState>;
  inputRef: React.MutableRefObject<InputState>;
  onChange: () => void;
  /** Ref to the HTML overlay div used to draw the screen-space selection rectangle. */
  overlayRef: React.MutableRefObject<HTMLDivElement | null>;
}

// ---------- Terrain ----------
/**
 * Terrain types whose surface is drawn by the continuous landscape mesh.
 * Anything listed here must NOT be extruded as a per-cell box, otherwise the
 * map reads as a grid of squares.
 */
const FLAT_TYPES = new Set([
  'open', 'road', 'gravel', 'mud', 'crater', 'water', 'forest',
  'tall_grass', 'trench', 'hedgerow', 'urban',
]);

// Only nearby sections allocate geometry, vegetation and road textures. Unit
// simulation remains global: leaving the camera does not freeze a battle.
function TerrainMesh({ terrain, regional, highQuality }: { terrain: TerrainCell[][]; regional: boolean; highQuality: boolean }) {
  const { camera, gl } = useThree();
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const boxes = useMemo(() => MAP_SECTIONS.map(s => new THREE.Box3(
    new THREE.Vector3(s.x - 8, -5, s.y - 8), new THREE.Vector3(s.x + s.width + 8, 7, s.y + s.height + 8))), []);
  const [visible, setVisible] = useState<MapSection[]>([]);
  const previous = useRef('');
  useFrame(() => {
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const next = MAP_SECTIONS.filter((_, i) => frustum.intersectsBox(boxes[i]));
    const key = next.map(s => s.id).join('|');
    if (key !== previous.current) {
      previous.current = key; setVisible(next);
      gl.domElement.dataset.terrainSections = String(next.length);
    }
  }, -1);
  return <group>
    <mesh position={[W / 2, -10, H / 2]} receiveShadow raycast={() => null}>
      <boxGeometry args={[W, 14, H]} /><meshStandardMaterial color="#6f6450" />
    </mesh>
    {visible.map(section => <TerrainSection key={section.id} terrain={terrain} regional={regional} section={section} highQuality={highQuality} />)}
  </group>;
}

function TerrainSection({ terrain, regional, section, highQuality }: { terrain: TerrainCell[][]; regional: boolean; section: MapSection; highQuality: boolean }) {
  const groups = useMemo(() => {
    const byType: Record<string, { positions: [number, number, number][]; sizes: [number, number, number][] }> = {};
    for (let y = section.y; y < section.y + section.height; y++) for (let x = section.x; x < section.x + section.width; x++) {
      const c = terrain[y][x];
      const t = c.type;
      if (FLAT_TYPES.has(t) || c.prop) continue; // drawn by GroundSurface / prop layers
      const h = TERRAIN_HEIGHT[t] ?? 0;
      if (!byType[t]) byType[t] = { positions: [], sizes: [] };
      const gY = groundHeightAt(terrain, x + 0.5, y + 0.5);
      byType[t].positions.push([x + 0.5, gY + h / 2, y + 0.5]);
      byType[t].sizes.push([1, Math.max(0.02, Math.abs(h)), 1]);
    }
    return byType;
  }, [terrain, section]);

  return (
    <group>
      <GroundSurface terrain={terrain} section={section} regional={regional} />
      <WaterSheet terrain={terrain} section={section} />
      <GrassTufts terrain={terrain} section={section} />
      <GroundDetail terrain={terrain} section={section} />
      {Object.entries(groups).map(([type, g]) => (
        <InstancedTerrainGroup key={type} type={type} positions={g.positions} sizes={g.sizes} />
      ))}
      <TrenchInstances terrain={terrain} section={section} />
      {/* Full forest replacement: pack-derived trees and vegetation in every forest cell. */}
      <RealisticVegetation terrain={terrain} section={section} highQuality={highQuality} />
      <HedgerowInstances terrain={terrain} section={section} />
      <React.Suspense fallback={null}>
        <RuralBuildingsAndProps terrain={terrain} section={section} />
      </React.Suspense>
    </group>
  );
}


/**
 * Zig-zag trench system with a sunken floor, firing step, and mixed
 * sandbag / timber / earth revetments per cell (deterministic by grid pos).
 * Each cell's parapet is split into two half-length yawed segments so the
 * fortification kinks every cell instead of forming a straight box.
 */
function TrenchInstances({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const computeCells = () => {
    const out: Array<{ x: number; y: number; horiz: boolean }> = [];
    for (let y = section.y; y < section.y + section.height; y++) for (let x = section.x; x < section.x + section.width; x++) {
      if (terrain[y][x].type !== 'trench') continue;
      const e = x + 1 < W && terrain[y][x + 1].type === 'trench';
      const w = x - 1 >= 0 && terrain[y][x - 1].type === 'trench';
      const n = y - 1 >= 0 && terrain[y - 1][x].type === 'trench';
      const s = y + 1 < H && terrain[y + 1][x].type === 'trench';
      const horizScore = (e ? 1 : 0) + (w ? 1 : 0);
      const vertScore = (n ? 1 : 0) + (s ? 1 : 0);
      out.push({ x, y, horiz: horizScore >= vertScore });
    }
    return out;
  };
  const [cells, setCells] = useState(computeCells);
  const pollRef = useRef(0);
  useFrame((_, dt) => {
    pollRef.current += dt;
    if (pollRef.current < 0.25) return;
    pollRef.current = 0;
    const next = computeCells();
    if (next.length !== cells.length) { setCells(next); return; }
    for (let i = 0; i < next.length; i++) {
      const a = next[i], b = cells[i];
      if (a.x !== b.x || a.y !== b.y || a.horiz !== b.horiz) { setCells(next); return; }
    }
  });

  const floorRef = useRef<THREE.InstancedMesh>(null);
  const stepRef = useRef<THREE.InstancedMesh>(null);
  const parapetRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);

  const jitter = (x: number, y: number, salt: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };

  useEffect(() => {
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const EARTH = '#786044';
    const EARTH2 = '#8a7050';
    const SANDBAG = '#aaa078';
    const SANDBAG_CAP = '#c2b68b';
    const TIMBER = '#806b4e';
    const TIMBER_CAP = '#9a815d';

    const trenchCenter = (c: { x: number; y: number; horiz: boolean }) => {
      const run = c.horiz ? c.x : c.y;
      const sign = ((Math.floor(run / 2) + c.x + c.y) % 2 === 0 ? 1 : -1);
      const mag = 0.1 + jitter(c.x, c.y, 31) * 0.16;
      return {
        cx: c.x + 0.5 + (c.horiz ? 0 : sign * mag),
        cz: c.y + 0.5 + (c.horiz ? sign * mag : 0),
      };
    };

    if (floorRef.current) {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const { cx, cz } = trenchCenter(c);
        const gY = groundHeightAt(terrain, cx, cz);
        // Keep the excavated floor just above the base terrain. The old floor
        // sat below the world slab and read as a featureless black square.
        tmp.position.set(cx, gY + 0.018, cz);
        tmp.scale.set(c.horiz ? 1.02 : 0.54, 0.035, c.horiz ? 0.54 : 1.02);
        tmp.rotation.y = 0;
        tmp.updateMatrix();
        floorRef.current.setMatrixAt(i, tmp.matrix);
      }
      floorRef.current.instanceMatrix.needsUpdate = true;
    }

    // Firing step: narrow raised strip along the trench interior center
    if (stepRef.current) {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const { cx, cz } = trenchCenter(c);
        const gY = groundHeightAt(terrain, cx, cz);
        if (c.horiz) {
          tmp.position.set(cx, gY + 0.075, cz + 0.19);
          tmp.scale.set(0.96, 0.11, 0.16);
        } else {
          tmp.position.set(cx + 0.19, gY + 0.075, cz);
          tmp.scale.set(0.16, 0.11, 0.96);
        }
        tmp.rotation.y = 0;
        tmp.updateMatrix();
        stepRef.current.setMatrixAt(i, tmp.matrix);
      }
      stepRef.current.instanceMatrix.needsUpdate = true;
    }

    // Parapets: 4 zig-zag segments per cell (2 sides × 2 halves), colored
    // per cell by revetment material.
    if (parapetRef.current && capRef.current) {
      let pIdx = 0, cIdx = 0;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const { cx, cz } = trenchCenter(c);
        const gY = groundHeightAt(terrain, cx, cz);
        const kinkSign = ((c.x + c.y) % 2 === 0 ? 1 : -1);
        const kink = kinkSign * (0.1 + jitter(c.x, c.y, 7) * 0.13);
        const hBase = 0.28 + jitter(c.x, c.y, 1) * 0.09;
        const th = 0.24 + jitter(c.x, c.y, 3) * 0.07;
        const halfLen = 0.48;

        // material per cell: 0 earth, 1 sandbag, 2 timber
        const mRoll = jitter(c.x, c.y, 8);
        const mat = mRoll < 0.42 ? 0 : mRoll < 0.78 ? 1 : 2;
        const baseHex = mat === 0
          ? (jitter(c.x, c.y, 15) < 0.5 ? EARTH : EARTH2)
          : mat === 1 ? SANDBAG : TIMBER;
        col.setStyle(baseHex);

        for (const side of [-1, 1] as const) {
          for (const half of [-1, 1] as const) {
            const yaw = kink * half * side;
            const h = hBase + (jitter(c.x, c.y, 20 + side * 3 + half) - 0.5) * 0.08;
            if (c.horiz) {
              const zPos = cz + side * (0.5 - th * 0.5);
              const xPos = cx + half * halfLen * 0.5;
              tmp.position.set(xPos, gY + 0.025 + h * 0.5, zPos);
              tmp.scale.set(halfLen, h, th);
            } else {
              const xPos = cx + side * (0.5 - th * 0.5);
              const zPos = cz + half * halfLen * 0.5;
              tmp.position.set(xPos, gY + 0.025 + h * 0.5, zPos);
              tmp.scale.set(th, h, halfLen);
            }
            tmp.rotation.y = yaw;
            tmp.updateMatrix();
            parapetRef.current.setMatrixAt(pIdx, tmp.matrix);
            parapetRef.current.setColorAt(pIdx, col);
            pIdx++;
          }
        }

        // Revetment cap (top course) — sandbag row or timber ledger per side
        const capHex = mat === 1 ? SANDBAG_CAP : mat === 2 ? TIMBER_CAP : EARTH2;
        const showCap = mat !== 0 || jitter(c.x, c.y, 11) < 0.35;
        for (const side of [-1, 1] as const) {
          if (!showCap) {
            tmp.scale.set(0, 0, 0);
            tmp.updateMatrix();
            capRef.current.setMatrixAt(cIdx, tmp.matrix);
            cIdx++;
            continue;
          }
          col.setStyle(capHex);
          const capH = mat === 2 ? 0.07 : 0.14;
           const capY = gY + 0.025 + hBase + capH * 0.5;
          if (c.horiz) {
            const zPos = cz + side * (0.5 - th * 0.5);
            tmp.position.set(cx, capY, zPos);
            tmp.scale.set(0.98, capH, th * 1.08);
          } else {
            const xPos = cx + side * (0.5 - th * 0.5);
            tmp.position.set(xPos, capY, cz);
            tmp.scale.set(th * 1.08, capH, 0.98);
          }
          tmp.rotation.y = (jitter(c.x, c.y, 12 + side) - 0.5) * 0.18;
          tmp.updateMatrix();
          capRef.current.setMatrixAt(cIdx, tmp.matrix);
          capRef.current.setColorAt(cIdx, col);
          cIdx++;
        }
      }
      parapetRef.current.instanceMatrix.needsUpdate = true;
      if (parapetRef.current.instanceColor) parapetRef.current.instanceColor.needsUpdate = true;
      capRef.current.instanceMatrix.needsUpdate = true;
      if (capRef.current.instanceColor) capRef.current.instanceColor.needsUpdate = true;
    }
  }, [cells, terrain]);

  if (cells.length === 0) return null;
  const parapetCount = cells.length * 4;
  const capCount = cells.length * 2;
  return (
    <group key={cells.length}>
      <instancedMesh ref={floorRef} args={[undefined, undefined, cells.length]} receiveShadow raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#8b7355" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={stepRef} args={[undefined, undefined, cells.length]} receiveShadow raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#9b825e" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={parapetRef} args={[undefined, undefined, parapetCount]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" flatShading roughness={1} />
      </instancedMesh>
      <instancedMesh ref={capRef} args={[undefined, undefined, capCount]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" flatShading roughness={1} />
      </instancedMesh>
    </group>
  );
}


function InstancedTerrainGroup({ type, positions, sizes }: { type: string; positions: [number, number, number][]; sizes: [number, number, number][] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = positions.length;
  const baseColor = useMemo(() => new THREE.Color(TERRAIN_COLORS[type] ?? '#666'), [type]);
  useEffect(() => {
    if (!ref.current) return;
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const [px, py, pz] = positions[i];
      const [sx, sy, sz] = sizes[i];
      // pseudo-random per-cell tint variance for natural look
      const seed = Math.sin((px * 12.9898 + pz * 78.233)) * 43758.5453;
      const r = (seed - Math.floor(seed)) - 0.5; // -0.5..0.5
      const tint = 1 + r * 0.12;
      const rot = (Math.floor((seed + 1) * 17) % 4) * (Math.PI / 2);
      tmp.position.set(px, py, pz);
      tmp.scale.set(sx * (1 + r * 0.04), sy * (1 + Math.abs(r) * 0.1), sz * (1 + r * 0.04));
      tmp.rotation.y = rot;
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
      col.copy(baseColor).multiplyScalar(tint);
      ref.current.setColorAt(i, col);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [positions, sizes, count, baseColor]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow receiveShadow raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#ffffff" flatShading roughness={0.92} />
    </instancedMesh>
  );
}

function HedgerowInstances({ terrain, section }: { terrain: TerrainCell[][]; section: MapSection }) {
  const bushes = useMemo(() => {
    const out: Array<{ x: number; z: number; sx: number; sy: number; sz: number; rot: number; tint: number }> = [];
    for (let y = section.y; y < section.y + section.height; y++) for (let x = section.x; x < section.x + section.width; x++) {
      if (terrain[y][x].type !== 'hedgerow') continue;
      const seed = (x * 91 + y * 47) % 997;
      for (let i = 0; i < 7; i++) {
        const a = seed + i * 137;
        out.push({
          x: x + 0.15 + ((a * 17) % 70) / 100,
          z: y + 0.15 + ((a * 29) % 70) / 100,
          sx: 0.32 + ((a * 11) % 22) / 100,
          sy: 0.72 + ((a * 7) % 40) / 100,
          sz: 0.26 + ((a * 19) % 26) / 100,
          rot: ((a * 13) % 360) * Math.PI / 180,
          tint: 0.82 + ((a * 5) % 28) / 100,
        });
      }
    }
    return out;
  }, [terrain, section]);

  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const base = new THREE.Color('#5d7b42');
    for (let i = 0; i < bushes.length; i++) {
      const b = bushes[i];
      tmp.position.set(b.x, groundHeightAt(terrain, b.x, b.z) + b.sy * 0.5, b.z);
      tmp.scale.set(b.sx, b.sy, b.sz);
      tmp.rotation.y = b.rot;
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
      col.copy(base).multiplyScalar(b.tint);
      ref.current.setColorAt(i, col);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [bushes, terrain]);

  if (bushes.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, bushes.length]} castShadow receiveShadow raycast={() => null}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#ffffff" flatShading roughness={0.95} />
    </instancedMesh>
  );
}

// ---------- Units layer (with selection/preview/hover rings) ----------
function UnitsLayer({ gameStateRef, inputRef }: { gameStateRef: React.MutableRefObject<GameState>; inputRef: React.MutableRefObject<InputState> }) {
  const { camera, size } = useThree();
  const hoverVector = useMemo(() => new THREE.Vector3(), []);
  const groupRef = useRef<THREE.Group>(null);
  const unitRefs = useRef<Map<string, THREE.Group>>(new Map());
  const selRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const previewRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const hoverRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const suppRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const blipRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const [, forceRender] = React.useReducer((n) => n + 1, 0);
  const knownIdsRef = useRef<string>('');

  useFrame((_, dt) => {
    const state = gameStateRef.current;
    const ids = state.units.filter(u => u.alive).map(u => `${u.id}:${u.insideOf ?? ''}`).join(',');
    if (ids !== knownIdsRef.current) {
      knownIdsRef.current = ids;
      forceRender();
      return;
    }
    const t = performance.now() * 0.001;
    const pulse = 1.0 + Math.sin(t * 6) * 0.08;
    const hoverId = pickScreenUnit(state, camera, size.width, size.height, inputRef.current.mousePos, hoverVector)?.id;

    for (const u of state.units) {
      if (!u.alive || u.insideOf) continue;
      const ref = unitRefs.current.get(u.id);
      if (ref) {
        ref.position.x = u.pos.x / S;
        ref.position.z = u.pos.y / S;
        ref.rotation.y = -u.facing;
        // Sink into trench when standing in a trench cell — smooth tween in/out (~0.4s).
        const gx = Math.floor(u.pos.x / S);
        const gy = Math.floor(u.pos.y / S);
        const cell = state.terrain[gy]?.[gx];
        const inTrench = cell?.type === 'trench' && u.type === 'infantry';
        const gY = surfaceY(u.pos.x / S, u.pos.y / S);
        const targetY = gY + (inTrench ? -0.08 : 0);
        const k = 1 - Math.exp(-dt * 8); // ~0.4s ease
        ref.position.y += (targetY - ref.position.y) * k;
        // Prone / digging crouch: squash + slight bob while digging — tweened too.
        const isDigging = u.order === 'entrench';
        const proneTarget = (u.prone || isDigging) ? 0.62 : (inTrench || (u.type === 'infantry' && u.inCover && !u.targetPos)) ? 0.7 : 1;
        const bob = isDigging ? 1 + Math.sin(t * 8) * 0.08 : 1;
        const curY = ref.scale.y;
        const newY = curY + (proneTarget * bob - curY) * k;
        ref.scale.set(1, newY, 1);
        // Fog of war: enemies only render as full models once identified (detection >= 0.7).
        const identified = u.team === 'player' || (u.spottedByEnemy && u.detectionLevel >= 0.7);
        ref.visible = identified;
      }
      // contact-only blip (detected but not identified)
      const bl = blipRefs.current.get(u.id);
      if (bl) {
        const contactOnly = u.team === 'enemy' && !(u.spottedByEnemy && u.detectionLevel >= 0.7) && u.detectionLevel > 0.3;
        bl.visible = contactOnly;
        if (contactOnly) {
          bl.position.set(u.pos.x / S, surfaceY(u.pos.x / S, u.pos.y / S) + 0.9, u.pos.y / S);
          bl.rotation.y = t * 1.2;
          const s3 = 1 + Math.sin(t * 4) * 0.1;
          bl.scale.set(s3, s3, s3);
          ((bl as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 + u.detectionLevel * 0.5;
        }
      }
      const sel = selRefs.current.get(u.id);
      if (sel) {
        sel.visible = u.selected && (u.team === 'player' || u.spottedByEnemy);
        sel.scale.set(pulse, pulse, pulse);
      }
      const pv = previewRefs.current.get(u.id);
      if (pv) pv.visible = state.previewSelected.has(u.id) && !u.selected;
      const hv = hoverRefs.current.get(u.id);
      if (hv) hv.visible = hoverId === u.id && !u.selected && !state.previewSelected.has(u.id);
      const sr = suppRefs.current.get(u.id);
      if (sr) {
        const on = u.suppression > 0.35 && (u.team === 'player' || u.spottedByEnemy);
        sr.visible = on;
        if (on) {
          const s2 = 1 + Math.sin(t * 10) * 0.12;
          sr.scale.set(s2 * 1.35, 0.2, s2 * 1.35);
          const mat = (sr as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = 0.12 + u.suppression * 0.28;
        }
      }
    }
  });

  const state = gameStateRef.current;
  const liveUnits = state.units.filter(u => u.alive && !u.insideOf);

  return (
    <group ref={groupRef}>
      {liveUnits.map(u => (
        <group
          key={u.id}
          ref={(el) => { if (el) unitRefs.current.set(u.id, el); else unitRefs.current.delete(u.id); }}
          position={[u.pos.x / S, surfaceY(u.pos.x / S, u.pos.y / S), u.pos.y / S]}
        >
          <group scale={UNIT_SCALE[u.type]}>
            <FactionUnitModel faction={factionFor(gameStateRef.current, u.team).id} type={u.type} unit={u} />
          </group>

          {/* hover ring (under selection/preview) */}
          <mesh
            ref={(el) => { if (el) hoverRefs.current.set(u.id, el); else hoverRefs.current.delete(u.id); }}
            position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} visible={false}
          >
            <ringGeometry args={[u.type === 'infantry' ? .16 : .36, u.type === 'infantry' ? .20 : .40, 32]} />
            <meshBasicMaterial color="#cfd8c4" transparent opacity={0.55} />
          </mesh>

          {/* preview ring (while dragging) */}
          <mesh
            ref={(el) => { if (el) previewRefs.current.set(u.id, el); else previewRefs.current.delete(u.id); }}
            position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} visible={false}
          >
            <ringGeometry args={[u.type === 'infantry' ? .17 : .37, u.type === 'infantry' ? .23 : .44, 32]} />
            <meshBasicMaterial color="#7ec0ff" transparent opacity={0.55} />
          </mesh>

          {/* confirmed selection ring */}
          <mesh
            ref={(el) => { if (el) selRefs.current.set(u.id, el); else selRefs.current.delete(u.id); }}
            position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} visible={false}
          >
            <ringGeometry args={[u.type === 'infantry' ? .16 : .36, u.type === 'infantry' ? .23 : .44, 36]} />
            <meshBasicMaterial color={u.team === 'player' ? '#7ec0ff' : '#ff8a6a'} transparent opacity={0.95} />
          </mesh>

          {/* suppression dust cloud (visible while suppressed) */}
          <mesh
            ref={(el) => { if (el) suppRefs.current.set(u.id, el); else suppRefs.current.delete(u.id); }}
            position={[0, 0.14, 0]} raycast={() => null} visible={false}
          >
            <sphereGeometry args={[0.75, 12, 6]} />
            <meshBasicMaterial color="#b79a72" transparent opacity={0.22} depthWrite={false} />
          </mesh>

          {/* digging visuals: progress ring + growing dirt mound parapet */}
          {u.order === 'entrench' && (
            <group>
              <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
                <ringGeometry args={[0.4, 0.48, 24, 1, 0, Math.min(Math.PI * 2, (u.digTimer / 6) * Math.PI * 2)]} />
                <meshBasicMaterial color="#d4c47a" transparent opacity={0.9} side={2} />
              </mesh>
              {/* front parapet (dirt thrown forward) */}
              <mesh position={[0.5, 0.05 + (u.digTimer / 6) * 0.12, 0]} raycast={() => null}>
                <boxGeometry args={[0.35, Math.max(0.05, (u.digTimer / 6) * 0.28), 0.7]} />
                <meshStandardMaterial color="#4a3520" flatShading roughness={1} />
              </mesh>
              {/* side spoil piles */}
              <mesh position={[-0.35, 0.05 + (u.digTimer / 6) * 0.08, 0.4]} raycast={() => null}>
                <boxGeometry args={[0.28, Math.max(0.05, (u.digTimer / 6) * 0.2), 0.28]} />
                <meshStandardMaterial color="#3d2c1a" flatShading roughness={1} />
              </mesh>
              <mesh position={[-0.35, 0.05 + (u.digTimer / 6) * 0.08, -0.4]} raycast={() => null}>
                <boxGeometry args={[0.28, Math.max(0.05, (u.digTimer / 6) * 0.2), 0.28]} />
                <meshStandardMaterial color="#3d2c1a" flatShading roughness={1} />
              </mesh>
            </group>
          )}

          <HealthBar u={u} />
        </group>
      ))}
      {/* contact-only blips (rendered outside unit groups so they show while models are hidden) */}
      {liveUnits.filter(u => u.team === 'enemy').map(u => (
        <mesh
          key={`blip-${u.id}`}
          ref={(el) => { if (el) blipRefs.current.set(u.id, el); else blipRefs.current.delete(u.id); }}
          position={[u.pos.x / S, surfaceY(u.pos.x / S, u.pos.y / S) + 0.9, u.pos.y / S]}
          rotation={[0, 0, Math.PI / 4]}
          raycast={() => null}
          visible={false}
        >
          <octahedronGeometry args={[0.34, 0]} />
          <meshBasicMaterial color="#ff5a4a" transparent opacity={0.7} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Last-known-position ghost markers for enemies that broke contact (fade over ~15s). */
function GhostContactsLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const state = gameStateRef.current;
    const ghosts = state.ghostContacts;
    // ensure pool size
    while (g.children.length < ghosts.length) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.55, 4),
        new THREE.MeshBasicMaterial({ color: '#ff9b6a', transparent: true, opacity: 0.5, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.PI / 4;
      m.raycast = () => null;
      g.add(m);
    }
    for (let i = 0; i < g.children.length; i++) {
      const m = g.children[i] as THREE.Mesh;
      const gh = ghosts[i];
      if (!gh) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(gh.pos.x / S, surfaceY(gh.pos.x / S, gh.pos.y / S) + 0.06, gh.pos.y / S);
      const age = Math.max(0, Math.min(1, (state.time - gh.time) / 15));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - age);
    }
  });
  return <group ref={groupRef} />;
}

function HealthBar({ u }: { u: Unit }) {
  const pct = Math.max(0, u.health / u.maxHealth);
  if (pct >= 1) return null;
  const h = u.type === 'helicopter' ? 2.6 : 1.4;
  return (
    <group position={[0, h, 0]}>
      <mesh><boxGeometry args={[0.8, 0.08, 0.02]} /><meshBasicMaterial color="#222" /></mesh>
      <mesh position={[-0.4 + (0.4 * pct), 0, 0.01]}>
        <boxGeometry args={[0.8 * pct, 0.07, 0.025]} />
        <meshBasicMaterial color={pct > 0.5 ? '#5cda5c' : pct > 0.25 ? '#dad05c' : '#da5c5c'} />
      </mesh>
    </group>
  );
}

// ---------- Effects ----------
function EffectsLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const linesRef = useRef<THREE.LineSegments>(null);
  const positionsRef = useRef<Float32Array>(new Float32Array(3000));
  const colorsRef = useRef<Float32Array>(new Float32Array(3000));
  const explRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const state = gameStateRef.current;
    const positions = positionsRef.current;
    const colors = colorsRef.current;
    let count = 0;
    // Tracers — taper opacity by remaining timer for a fading streak feel.
    for (const p of state.projectiles) {
      if (count + 2 > 500) break;
      const i = count * 3;
      positions[i] = p.from.x / S; positions[i + 1] = surfaceY(p.from.x / S, p.from.y / S) + 0.5; positions[i + 2] = p.from.y / S;
      positions[i + 3] = p.to.x / S; positions[i + 4] = surfaceY(p.to.x / S, p.to.y / S) + 0.5; positions[i + 5] = p.to.y / S;
      // Player: cool blue-white. Enemy: hot orange-red.
      const base = p.team === 'player' ? [0.55, 0.85, 1.2] : [1.3, 0.55, 0.25];
      // Fade linearly — timer starts ~0.2-0.4, becomes 0. Use clamp.
      const life = Math.max(0.05, Math.min(1, p.timer / 0.3));
      colors[i]     = base[0] * life; colors[i + 1] = base[1] * life; colors[i + 2] = base[2] * life;
      colors[i + 3] = base[0] * life; colors[i + 4] = base[1] * life; colors[i + 5] = base[2] * life;
      count += 2;
    }
    if (linesRef.current) {
      const geo = linesRef.current.geometry as THREE.BufferGeometry;
      geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, count * 3), 3));
      geo.setDrawRange(0, count);
      geo.attributes.position.needsUpdate = true;
    }

    // Muzzle flashes + impact sparks. Rebuild each frame from projectile freshness.
    if (flashRef.current) {
      flashRef.current.clear();
      for (const p of state.projectiles) {
        // Freshness: 1 at spawn → 0 as timer decays. Estimate initial via bucket.
        const fresh = Math.max(0, Math.min(1, p.timer / 0.28));
        if (fresh <= 0.55) continue; // only render for the first ~half of tracer life
        const flashOpacity = (fresh - 0.55) / 0.45; // 0..1 quick fade
        const flashCol = p.team === 'player' ? new THREE.Color(1.0, 0.95, 0.7) : new THREE.Color(1.0, 0.75, 0.35);
        // Muzzle flash: small billboard sphere at 'from', offset slightly toward 'to'.
        const dx = p.to.x - p.from.x, dy = p.to.y - p.from.y;
        const len = Math.hypot(dx, dy) || 1;
        const heavy = len > 135;
        const mx = (p.from.x + (dx / len) * 6) / S;
        const mz = (p.from.y + (dy / len) * 6) / S;
        const flash = new THREE.Mesh(
          new THREE.SphereGeometry((heavy ? 0.3 : 0.16) + 0.16 * flashOpacity, 10, 7),
          new THREE.MeshBasicMaterial({ color: flashCol, transparent: true, opacity: flashOpacity, depthWrite: false }),
        );
        const gFrom = surfaceY(mx, mz);
        flash.position.set(mx, gFrom + (heavy ? 0.72 : 0.55), mz);
        flashRef.current.add(flash);
        const dust = new THREE.Mesh(
          new THREE.SphereGeometry(heavy ? 0.38 : 0.2, 8, 5),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.72, 0.62, 0.46), transparent: true, opacity: flashOpacity * (heavy ? 0.42 : 0.22), depthWrite: false }),
        );
        dust.scale.set(1.4, 0.35, 1.4);
        dust.position.set(mx - (dx / len) * 0.08, gFrom + 0.22, mz - (dy / len) * 0.08);
        flashRef.current.add(dust);
        // Impact spark: only if it's a hit and near end of life (looks like arrival).
        if (p.hit && fresh > 0.7) {
          const sparkCol = p.crit ? new THREE.Color(1.0, 0.9, 0.4) : new THREE.Color(1.0, 0.7, 0.4);
          const spark = new THREE.Mesh(
            new THREE.SphereGeometry(0.14 + (p.crit ? 0.1 : 0), 6, 4),
            new THREE.MeshBasicMaterial({ color: sparkCol, transparent: true, opacity: flashOpacity * 0.8, depthWrite: false }),
          );
          spark.position.set(p.to.x / S, surfaceY(p.to.x / S, p.to.y / S) + 0.5, p.to.y / S);
          flashRef.current.add(spark);
        }
        const impactDust = new THREE.Mesh(
          new THREE.SphereGeometry(heavy ? 0.42 : 0.18, 8, 5),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.58, 0.5, 0.38), transparent: true, opacity: flashOpacity * (p.hit ? 0.28 : 0.44), depthWrite: false }),
        );
        impactDust.scale.set(1.5, 0.28, 1.5);
        impactDust.position.set(p.to.x / S, surfaceY(p.to.x / S, p.to.y / S) + 0.18, p.to.y / S);
        flashRef.current.add(impactDust);
      }
    }

    if (explRef.current) {
      explRef.current.clear();
      for (const e of state.explosions) {
        const t = e.timer / e.maxTimer;
        const r = e.radius / S * (1.5 - t);
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(r, 12, 8),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.5 + t * 0.3, 0.2), transparent: true, opacity: t })
        );
        const gE = surfaceY(e.pos.x / S, e.pos.y / S);
        mesh.position.set(e.pos.x / S, gE + 0.5, e.pos.y / S);
        explRef.current.add(mesh);
        const shock = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0.05, r * 0.75), Math.max(0.08, r * 0.92), 32),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.72, 0.48), transparent: true, opacity: t * 0.45, side: THREE.DoubleSide, depthWrite: false }),
        );
        shock.rotation.x = -Math.PI / 2;
        shock.position.set(e.pos.x / S, gE + 0.08, e.pos.y / S);
        explRef.current.add(shock);
        const smoke = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.2, r * 0.55), 10, 7),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.21, 0.18), transparent: true, opacity: Math.min(0.42, (1 - t) * 0.55), depthWrite: false }),
        );
        smoke.scale.set(1, 1.6, 1);
        smoke.position.set(e.pos.x / S, gE + 0.55 + (1 - t) * 0.9, e.pos.y / S);
        explRef.current.add(smoke);
      }
    }
  });

  return (
    <group>
      <lineSegments ref={linesRef}>
        <bufferGeometry />
        <lineBasicMaterial vertexColors linewidth={2} transparent />
      </lineSegments>
      <group ref={flashRef} />
      <group ref={explRef} />
    </group>
  );
}

// ---------- Command markers + formation preview ----------
function CommandMarkersLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const state = gameStateRef.current;
    if (!groupRef.current) return;
    // These preview meshes are temporary and owned by this layer.
    for (const child of groupRef.current.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      }
    }
    groupRef.current.clear();
    for (const m of state.commandMarkers) {
      const t = 1 - m.timer / m.max; // 0 → 1
      const r = 0.6 + t * 1.0;
      const op = (1 - t) * 0.95;
      const color = MARKER_COLOR[m.type] ?? '#ffffff';
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0.05, r - 0.12), r, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      const gM = surfaceY(m.pos.x / S, m.pos.y / S);
      ring.position.set(m.pos.x / S, gM + 0.06, m.pos.y / S);
      groupRef.current.add(ring);
      // center dot
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.12, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op * 0.8, depthWrite: false }),
      );
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(m.pos.x / S, gM + 0.07, m.pos.y / S);
      groupRef.current.add(dot);
    }
    // formation placement preview: per-squad coloured silhouettes + front arrow
    const prev = state.commandPreview;
    if (prev) {
      const SQUAD_COLORS = ['#7ec0ff', '#8ef0c0', '#ffd98e', '#e59bff', '#9fe8ff'];
      for (const slot of prev.slots) {
        const p = slot.pos;
        const col = SQUAD_COLORS[slot.squad % SQUAD_COLORS.length];
        const gY = surfaceY(p.x / S, p.y / S) + 0.06;
        // silhouette: infantry = small circle, vehicles = oriented rectangle
        let mesh: THREE.Mesh;
        if (slot.type === 'infantry') {
          mesh = new THREE.Mesh(
            new THREE.RingGeometry(0.16, 0.23, 20),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
          );
        } else {
          const w = slot.type === 'tank' ? .65 : .55;
          const l = slot.type === 'helicopter' ? 1.2 : w * 1.7;
          mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(w, l),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
          );
        }
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = -prev.facing + Math.PI / 2;
        mesh.position.set(p.x / S, gY, p.y / S);
        groupRef.current.add(mesh);
      }
      // front arrow showing arrival facing
      const dx = Math.cos(prev.facing), dz = Math.sin(prev.facing);
      const cx = prev.dest.x / S, cz = prev.dest.y / S;
      const tipX = cx + dx * 4.2, tipZ = cz + dz * 4.2;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(cx, surfaceY(cx, cz) + 0.2, cz),
          new THREE.Vector3(tipX, surfaceY(tipX, tipZ) + 0.2, tipZ),
        ]),
        new THREE.LineBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.85 }),
      );
      groupRef.current.add(line);
      const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.4, 1.0, 12),
        new THREE.MeshBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.85, depthWrite: false }),
      );
      head.position.set(tipX, surfaceY(tipX, tipZ) + 0.3, tipZ);
      head.rotation.z = -Math.PI / 2;
      head.rotation.y = -prev.facing;
      groupRef.current.add(head);
    }
  });
  return <group ref={groupRef} />;
}

// ---------- Terrain debug overlay (cover / concealment / tactical) ----------
function TerrainDebugLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const lastLayerRef = useRef<string>('');
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const total = MAP_COLS * MAP_ROWS;

  useFrame(() => {
    const state = gameStateRef.current;
    const d = state.debug;
    const layer = d.showCover ? 'cover' : d.showConcealment ? 'concealment' : d.showTactical ? 'tactical' : '';
    const mesh = ref.current;
    if (!mesh) return;
    if (!layer) {
      mesh.visible = false;
      lastLayerRef.current = '';
      return;
    }
    mesh.visible = true;
    if (layer === lastLayerRef.current) return; // static field, only rebuild on change
    lastLayerRef.current = layer;
    let i = 0;
    for (let y = 0; y < MAP_ROWS; y++) {
      for (let x = 0; x < MAP_COLS; x++) {
        const c = state.terrain[y][x];
        const v = layer === 'cover' ? cellCoverScore(c)
          : layer === 'concealment' ? cellConcealmentScore(c)
          : cellTacticalScore(c);
        dummy.position.set(x + 0.5, surfaceY(x + 0.5, y + 0.5) + 1.6, y + 0.5);
        dummy.scale.set(0.94, 0.02, 0.94);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const [r, g, b] = scoreToColor(v);
        color.setRGB(r, g, b);
        mesh.setColorAt(i, color);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, total]} raycast={() => null} visible={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent opacity={0.55} />
    </instancedMesh>
  );
}

// ---------- Capture points ----------
function CapturePoints({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const state = gameStateRef.current;
    if (!groupRef.current) return;
    groupRef.current.clear();
    for (const cp of state.capturePoints) {
      const ringColor = cp.owner === 'player' ? 0x4a90d9 : cp.owner === 'enemy' ? 0xd94a4a : 0xcccccc;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(cp.radius / S - 0.1, cp.radius / S, 32),
        new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cp.pos.x / S, surfaceY(cp.pos.x / S, cp.pos.y / S) + 0.12, cp.pos.y / S);
      groupRef.current.add(ring);
    }
  });
  return <group ref={groupRef} />;
}

// ---------- RAAS radios and spawn points ----------
/** Own radios always; enemy ones only while your troops can see them. Rebuilt only when something changes. */
function FobLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const groupRef = useRef<THREE.Group>(null);
  const lastKey = useRef('');
  const mats = useMemo(() => ({
    player: new THREE.MeshStandardMaterial({ color: 0x4a90d9, roughness: .7 }),
    enemy: new THREE.MeshStandardMaterial({ color: 0xd94a4a, roughness: .7 }),
    building: new THREE.MeshStandardMaterial({ color: 0xd9c07a, roughness: .8, transparent: true, opacity: .75 }),
    overrun: new THREE.MeshStandardMaterial({ color: 0xff6a3a, roughness: .8 }),
    ringPlayer: new THREE.MeshBasicMaterial({ color: 0x4a90d9, transparent: true, opacity: .35, side: THREE.DoubleSide }),
    ringEnemy: new THREE.MeshBasicMaterial({ color: 0xd94a4a, transparent: true, opacity: .35, side: THREE.DoubleSide }),
  }), []);
  const geos = useMemo(() => ({
    mast: new THREE.CylinderGeometry(.06, .08, 2.4, 6),
    base: new THREE.BoxGeometry(.7, .35, .5),
    hab: new THREE.BoxGeometry(1.4, .8, 1.1),
    ring: new THREE.RingGeometry(FOB_RULES.radioRadius / S - .12, FOB_RULES.radioRadius / S, 48),
  }), []);
  useEffect(() => () => { Object.values(mats).forEach(m => m.dispose()); Object.values(geos).forEach(g => g.dispose()); }, [mats, geos]);
  useFrame(() => {
    const state = gameStateRef.current, group = groupRef.current;
    if (!group || !state.raas) return;
    const fobs = visibleFobs(state, state.raas, 'player');
    const key = fobs.map(f => `${f.id}:${f.hab ? `${Math.round(f.hab.progress * 20)}${f.hab.built ? 'b' : ''}${f.overrun ? 'o' : ''}` : '-'}`).join('|');
    if (key === lastKey.current) return;
    lastKey.current = key;
    group.clear();
    for (const f of fobs) {
      const x = f.radio.x / S, z = f.radio.y / S, y = surfaceY(x, z);
      const team = f.team === 'player' ? mats.player : mats.enemy;
      const base = new THREE.Mesh(geos.base, team); base.position.set(x, y + .18, z); group.add(base);
      const mast = new THREE.Mesh(geos.mast, team); mast.position.set(x + .2, y + 1.4, z); group.add(mast);
      if (f.team === 'player') {
        const ring = new THREE.Mesh(geos.ring, f.team === 'player' ? mats.ringPlayer : mats.ringEnemy);
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + .1, z); group.add(ring);
      }
      if (f.hab) {
        const hx = f.hab.pos.x / S, hz = f.hab.pos.y / S, hy = surfaceY(hx, hz);
        const hab = new THREE.Mesh(geos.hab, !f.hab.built ? mats.building : f.overrun ? mats.overrun : team);
        const h = f.hab.built ? 1 : Math.max(.15, f.hab.progress);
        hab.scale.set(1, h, 1); hab.position.set(hx, hy + .4 * h, hz); group.add(hab);
      }
    }
  });
  return <group ref={groupRef} />;
}

// ---------- See-through canopy above your troops ----------
/** Feeds the canopy shader with your soldiers that stand in or at the edge of a wood. */
function CanopyReveal({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  useFrame(() => {
    const state = gameStateRef.current, pts = revealUniforms.revealPts.value;
    let n = 0;
    for (const u of state.units) {
      if (n >= MAX_REVEAL) break;
      if (!u.alive || u.insideOf || u.team !== 'player') continue;
      const gx = u.pos.x / S, gz = u.pos.y / S, cx = Math.floor(gx), cz = Math.floor(gz);
      const woods = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => state.terrain[cz + dz]?.[cx + dx]?.type === 'forest');
      if (!woods) continue;
      pts[n++].set(gx, surfaceY(gx, gz), gz);
    }
    revealUniforms.revealCount.value = n;
  });
  return null;
}

// ---------- Selected-unit path lines ----------
function PathsLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const ref = useRef<THREE.LineSegments>(null);
  const posBuf = useRef<Float32Array>(new Float32Array(3000));
  useFrame(() => {
    const state = gameStateRef.current;
    const positions = posBuf.current;
    let count = 0;
    const push = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      if (count + 2 > 500) return;
      const i = count * 3;
      positions[i] = a.x / S; positions[i + 1] = surfaceY(a.x / S, a.y / S) + 0.25; positions[i + 2] = a.y / S;
      positions[i + 3] = b.x / S; positions[i + 4] = surfaceY(b.x / S, b.y / S) + 0.25; positions[i + 5] = b.y / S;
      count += 2;
    };
    for (const u of state.units) {
      if (!u.alive || !u.selected || u.team !== 'player') continue;
      let prev = u.pos;
      if (u.targetPos) { push(prev, u.targetPos); prev = u.targetPos; }
      for (const wp of u.path) { push(prev, wp); prev = wp; }
      for (const wp of u.waypoints) { push(prev, wp); prev = wp; }
    }
    if (ref.current) {
      const geo = ref.current.geometry as THREE.BufferGeometry;
      geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 3), 3));
      geo.setDrawRange(0, count);
      geo.attributes.position.needsUpdate = true;
    }
  });
  return (
    <lineSegments ref={ref}>
      <bufferGeometry />
      <lineBasicMaterial color="#7ec0ff" transparent opacity={0.55} />
    </lineSegments>
  );
}

/** Squad movement debug: squad centre, destination, slots, unit->slot links,
 *  cohesion + avoidance radii. Fully hidden unless debug.showMovement. */
function MovementDebugLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const ref = useRef<THREE.LineSegments>(null);
  const posBuf = useRef<Float32Array>(new Float32Array(30000));
  useFrame(() => {
    const state = gameStateRef.current;
    const positions = posBuf.current;
    let count = 0;
    const MAX = 4800;
    const push = (ax: number, ay: number, bx: number, by: number) => {
      if (count + 2 > MAX) return;
      const i = count * 3;
      positions[i] = ax / S; positions[i + 1] = surfaceY(ax / S, ay / S) + 0.3; positions[i + 2] = ay / S;
      positions[i + 3] = bx / S; positions[i + 4] = surfaceY(bx / S, by / S) + 0.3; positions[i + 5] = by / S;
      count += 2;
    };
    const ring = (cx: number, cy: number, r: number, seg = 24) => {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      }
    };
    if (state.debug.showMovement) {
      const byId = new Map(state.units.map(u => [u.id, u]));
      for (const sq of state.playerSquads) {
        ring(sq.anchor.x, sq.anchor.y, 10, 12);
        ring(sq.anchor.x, sq.anchor.y, sq.cohesionRadius, 32);
        push(sq.anchor.x, sq.anchor.y, sq.dest.x, sq.dest.y);
        ring(sq.dest.x, sq.dest.y, 14, 12);
        for (const id of sq.memberIds) {
          const u = byId.get(id);
          const slot = sq.slots[id];
          if (!u || !slot) continue;
          ring(slot.x, slot.y, 6, 10);
          push(u.pos.x, u.pos.y, slot.x, slot.y);
          ring(u.pos.x, u.pos.y, spacingRadius(u), 12);
        }
      }
    }
    const mesh = ref.current;
    if (mesh) {
      mesh.visible = count > 0;
      const geo = mesh.geometry as THREE.BufferGeometry;
      geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 3), 3));
      geo.setDrawRange(0, count);
      geo.attributes.position.needsUpdate = true;
    }
  });
  return (
    <lineSegments ref={ref}>
      <bufferGeometry />
      <lineBasicMaterial color="#ffd166" transparent opacity={0.7} />
    </lineSegments>
  );
}

/** Same projected anchor for clicking, hover, box selection and the readable unit badge. */
function screenUnit(unit: Unit, camera: THREE.Camera, width: number, height: number, v: THREE.Vector3) {
  v.set(unit.pos.x / S, surfaceY(unit.pos.x / S, unit.pos.y / S) + (unit.type === 'helicopter' ? 1.5 : .2), unit.pos.y / S).project(camera);
  return { x: (v.x * .5 + .5) * width, y: (-v.y * .5 + .5) * height - 12,
    visible: v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
}
function pickScreenUnit(state: GameState, camera: THREE.Camera, width: number, height: number, at: { x: number; y: number }, v: THREE.Vector3) {
  let best: Unit | null = null, distance = 19;
  for (const unit of state.units.filter(controllable)) {
    const p = screenUnit(unit, camera, width, height, v);
    if (!p.visible) continue;
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    if (d < distance) { distance = d; best = unit; }
  }
  return best;
}
function UnitBadgePositions({ gameStateRef, elements }: { gameStateRef: React.MutableRefObject<GameState>; elements: React.MutableRefObject<Map<string, HTMLButtonElement>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const state = gameStateRef.current;
    for (const unit of state.units) {
      const el = elements.current.get(unit.id);
      if (!el) continue;
      const p = screenUnit(unit, camera, size.width, size.height, v);
      const show = controllable(unit) && p.visible && p.y > 38 && p.y < size.height - 212;
      el.style.display = show ? 'flex' : 'none';
      if (!show) continue;
      el.style.transform = `translate(${p.x - 12}px, ${p.y - 8}px)`;
      const preview = state.previewSelected.has(unit.id), covered = coverState(unit);
      el.style.background = unit.selected ? '#7ec0ff' : preview ? '#466d88' : '#142b22e8';
      el.style.color = unit.selected ? '#10272a' : covered === 'covered' ? '#b7e8a2' : '#cee1ce';
      el.style.borderColor = unit.selected || preview ? '#bbecff' : covered === 'moving' ? '#edce8c' : covered === 'covered' ? '#8acb78' : '#71887a';
      el.setAttribute('aria-pressed', String(unit.selected));
      el.title = `${unit.type} · ${unitStatus(unit, state)} · Click: select · Shift: toggle`;
    }
  });
  return null;
}

// ---------- Ground click handler (screen-space drag threshold + preview) ----------
function Ground({ gameStateRef, inputRef, onChange }: Omit<SceneProps, 'overlayRef'>) {
  const { camera, size, gl } = useThree();
  const lastTap = useRef<{ id: string; time: number } | null>(null);
  const projected = useMemo(() => new THREE.Vector3(), []);

  /**
   * Convert a pointer event to engine world coords on the *displaced* ground.
   * The pick plane is flat at y=0, so on a hill the naive hit point lands
   * behind the real surface. Iteratively re-intersect the ray with the plane
   * at the sampled surface height until it converges (3-4 steps is plenty).
   */
  const pickWorld = (e: ThreeEvent<PointerEvent>) => {
    let px = e.point.x, pz = e.point.z;
    const ray = e.ray;
    if (ray && Math.abs(ray.direction.y) > 1e-4) {
      for (let i = 0; i < 4; i++) {
        const h = surfaceY(px, pz);
        const t = (h - ray.origin.y) / ray.direction.y;
        if (!isFinite(t) || t <= 0) break;
        px = ray.origin.x + ray.direction.x * t;
        pz = ray.origin.z + ray.direction.z * t;
      }
    }
    return { x: px * S, y: pz * S };
  };

  /** Pointer position relative to the canvas (matches r3f `size`). */
  const canvasPos = (e: ThreeEvent<PointerEvent>) => {
    const rect = gl.domElement.getBoundingClientRect();
    return {
      x: e.nativeEvent.clientX - (rect?.left ?? 0),
      y: e.nativeEvent.clientY - (rect?.top ?? 0),
    };
  };

  /** Units whose on-screen position falls inside the drag rectangle. */
  const unitsInScreenRect = (endX: number, endY: number): Unit[] => {
    const state = gameStateRef.current;
    const start = inputRef.current.dragStartScreen;
    if (!start) return [];
    const minX = Math.min(start.x, endX), maxX = Math.max(start.x, endX);
    const minY = Math.min(start.y, endY), maxY = Math.max(start.y, endY);
    const hits: Unit[] = [];
    for (const unit of state.units) {
      if (!unit.alive || unit.team !== 'player' || unit.insideOf) continue;
      const p = screenUnit(unit, camera, size.width, size.height, projected);
      if (p.visible && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) hits.push(unit);
    }
    return hits;
  };

  /** Press-and-drag placement: press locks the destination, drag sets arrival facing + frontage. */
  const placeRef = useRef<{ dest: { x: number; y: number }; facing?: number; width?: number } | null>(null);

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const pw = pickWorld(e);
    const wx = pw.x;
    const wy = pw.y;
    const state = gameStateRef.current;
    const sp = canvasPos(e);

    if (e.nativeEvent.button === 2) {
      inputRef.current.rightMouseDown = true;
      // Destination locks on press; dragging only steers facing/width.
      placeRef.current = { dest: { x: wx, y: wy } };
      updateCommandPreview(state, wx, wy);
      onChange();
    } else if (e.nativeEvent.button === 0) {
      inputRef.current.dragStart = { x: wx, y: wy };
      inputRef.current.dragStartScreen = { x: sp.x, y: sp.y };
      inputRef.current.mousePos = { x: sp.x, y: sp.y };
      inputRef.current.dragPromoted = false;
      inputRef.current.isDragging = true;
      // selection box waits until threshold is crossed; no flicker on tap.
      state.selectionBox = null;
      state.previewSelected.clear();
      onChange();
    }
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const { x: wx, y: wy } = pickWorld(e);
    const state = gameStateRef.current;
    const sp = canvasPos(e);
    inputRef.current.mouseWorldPos = { x: wx, y: wy };
    inputRef.current.mousePos = { x: sp.x, y: sp.y };

    // Live placement preview while RMB held: destination stays where pressed,
    // the drag vector sets arrival facing and how wide the formation spreads.
    if (inputRef.current.rightMouseDown && placeRef.current) {
      const d = placeRef.current.dest;
      const dist = Math.hypot(wx - d.x, wy - d.y);
      if (dist > 22) {
        placeRef.current.facing = Math.atan2(wy - d.y, wx - d.x);
        placeRef.current.width = Math.max(0.6, Math.min(2.2, dist / 150));
      } else {
        placeRef.current.facing = undefined;
        placeRef.current.width = undefined;
      }
      updateCommandPreview(state, d.x, d.y, placeRef.current.facing, placeRef.current.width);
    }

    if (inputRef.current.isDragging && inputRef.current.dragStartScreen && inputRef.current.dragStart) {
      const ds = inputRef.current.dragStartScreen;
      const screenDist = Math.hypot(sp.x - ds.x, sp.y - ds.y);
      if (!inputRef.current.dragPromoted && screenDist > DRAG_THRESHOLD_PX) {
        inputRef.current.dragPromoted = true;
        state.selectionBox = { start: { ...inputRef.current.dragStart }, end: { x: wx, y: wy } };
      }
      if (inputRef.current.dragPromoted && state.selectionBox) {
        state.selectionBox.end = { x: wx, y: wy };
        // Preview uses the SAME screen-space test as the commit below, so the
        // highlighted units always match what release actually selects.
        state.previewSelected.clear();
        for (const u of unitsInScreenRect(sp.x, sp.y)) state.previewSelected.add(u.id);
      }
    }
  };

  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    const state = gameStateRef.current;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (e.nativeEvent.button === 2 && inputRef.current.rightMouseDown) {
      // Commit the previewed plan: locked destination + dragged facing/frontage.
      const pw = pickWorld(e);
      const plc = placeRef.current;
      const dx = plc ? plc.dest.x : pw.x;
      const dy = plc ? plc.dest.y : pw.y;
      handleRightClickWorld(
        dx, dy, state, e.nativeEvent.shiftKey, e.nativeEvent.ctrlKey || e.nativeEvent.metaKey,
        plc?.facing, plc?.width,
      );
      placeRef.current = null;
      inputRef.current.rightMouseDown = false;
      clearCommandPreview(state);
      onChange();
      return;
    }
    if (e.nativeEvent.button !== 0 || !inputRef.current.isDragging) return;

    if (inputRef.current.dragPromoted && state.selectionBox) {
      const sp = canvasPos(e);
      const hits = unitsInScreenRect(sp.x, sp.y);
      selectUnits(state, hits.map(u => u.id), e.nativeEvent.ctrlKey ? 'remove' : e.nativeEvent.shiftKey ? 'add' : 'replace');
    } else {
      const sp = canvasPos(e);
      const hit = pickScreenUnit(state, camera, size.width, size.height, sp, projected);
      const now = performance.now();
      const double = hit && lastTap.current?.id === hit.id && now - lastTap.current.time < 320;
      const hits = double ? state.units.filter(u => controllable(u) && u.type === hit.type && screenUnit(u, camera, size.width, size.height, projected).visible) : hit ? [hit] : [];
      selectUnits(state, hits.map(u => u.id), e.nativeEvent.shiftKey ? (double ? 'add' : 'toggle') : 'replace');
      lastTap.current = hit ? { id: hit.id, time: now } : null;
    }
    state.selectionBox = null;
    state.previewSelected.clear();
    inputRef.current.isDragging = false;
    inputRef.current.dragPromoted = false;
    inputRef.current.dragStart = null;
    inputRef.current.dragStartScreen = null;
    onChange();
  };


  return (
    <mesh
      position={[W / 2, 0, H / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={() => {
        inputRef.current.isDragging = false; inputRef.current.rightMouseDown = false;
        inputRef.current.dragStartScreen = null; inputRef.current.dragStart = null;
        inputRef.current.dragPromoted = false; placeRef.current = null;
        gameStateRef.current.selectionBox = null; gameStateRef.current.previewSelected.clear();
        clearCommandPreview(gameStateRef.current); onChange();
      }}
      visible={false}
    >
      <planeGeometry args={[W * 2, H * 2]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}

// ---------- Screen-space selection rectangle (HTML overlay) ----------
function SelectionOverlayUpdater({ inputRef, overlayRef }: { inputRef: React.MutableRefObject<InputState>; overlayRef: React.MutableRefObject<HTMLDivElement | null> }) {
  useFrame(() => {
    const el = overlayRef.current, input = inputRef.current;
    if (!el) return;
    const start = input.dragStartScreen, end = input.mousePos;
    if (!input.isDragging || !input.dragPromoted || !start) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = `${Math.min(start.x, end.x)}px`;
    el.style.top = `${Math.min(start.y, end.y)}px`;
    el.style.width = `${Math.max(1, Math.abs(start.x - end.x))}px`;
    el.style.height = `${Math.max(1, Math.abs(start.y - end.y))}px`;
  });
  return null;
}

// ---------- Countryside beyond the board ----------
/** Four flat strips framing the map, so the board edge meets ground, not a void. */
function OuterGround() {
  const M = Math.max(W, H) * 2, e = 0.5;
  const strips: [number, number, number, number][] = [
    [-M / 2 + e, H / 2, M, H + 2 * M], [W + M / 2 - e, H / 2, M, H + 2 * M],
    [W / 2, -M / 2 + e, W, M], [W / 2, H + M / 2 - e, W, M],
  ];
  return <group>{strips.map(([x, z, w, h], i) => (
    <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, -0.15, z]} receiveShadow raycast={() => null}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color="#77894f" roughness={1} />
    </mesh>
  ))}</group>;
}

// ---------- Camera rig ----------
// ---------- World scale ----------
/**
 * Units, houses and trees are scaled together so proportions are real: a tank
 * is about the size of a village house, a soldier about a quarter of its
 * height, a pine about three times it (BUILDING_SCALE in Environment.tsx,
 * TREE_SCALE in RealisticVegetation.tsx). Gameplay distances are unchanged.
 */
const UNIT_SCALE: Record<string, number> = { infantry: 0.55, tank: 0.6, apc: 0.6, helicopter: 0.7 };

// ---------- Horizon ----------
/** A ring of hazy hills far beyond the board, so the horizon reads as distant countryside. */
function DistantHills() {
  const geometry = useMemo(() => {
    const N = 192, radii = [620, 720, 860, 1050, 1300], pos: number[] = [], col: number[] = [], idx: number[] = [];
    const base = new THREE.Color('#71848c'), top = new THREE.Color('#9eb1bb'), far = new THREE.Color('#b9c7cf');
    for (let r = 0; r < radii.length; r++) for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const ridge = Math.sin(a * 3 + r) * .5 + Math.sin(a * 7.3 + r * 2.1) * .3 + Math.sin(a * 17.1 + r) * .2;
      const h = r === 0 ? 0 : (14 + 30 * (ridge * .5 + .5)) * (r === radii.length - 1 ? .6 : 1) * (1 + r * .25);
      pos.push(W / 2 + Math.cos(a) * radii[r], h, H / 2 + Math.sin(a) * radii[r]);
      const c = (r >= 3 ? far : base).clone().lerp(top, Math.min(1, h / 50));
      col.push(c.r, c.g, c.b);
    }
    for (let r = 0; r < radii.length - 1; r++) for (let i = 0; i < N; i++) {
      const a = r * N + i, b = r * N + (i + 1) % N, c = (r + 1) * N + i, d = (r + 1) * N + (i + 1) % N;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} raycast={() => null}>
    <meshBasicMaterial vertexColors fog={false} side={THREE.DoubleSide} />
  </mesh>;
}

/** The original fixed camera angle (about 57° down), kept at the player's request. */
const CAMERA_HEIGHT = 0.85, CAMERA_BACK = 0.55;

function CameraRig({ inputRef, gameStateRef }: { inputRef: React.MutableRefObject<InputState>; gameStateRef: React.MutableRefObject<GameState> }) {
  const { camera, scene } = useThree();
  const players = gameStateRef.current.units.filter(u => u.team === 'player' && u.alive);
  const targetRef = useRef({ x: players.reduce((n, u) => n + u.pos.x / S, 0) / (players.length || 1), z: players.reduce((n, u) => n + u.pos.y / S, 0) / (players.length || 1) });
  const distRef = useRef(32);
  const yawRef = useRef(0);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      // Proportional zoom: fine steps close up, big steps far out.
      const step = Math.max(2, distRef.current * .14);
      distRef.current = Math.max(8, Math.min(400, distRef.current + (e.deltaY > 0 ? step : -step)));
    };
    window.addEventListener('wheel', onWheel);
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  useFrame((_, dt) => {
    const keys = inputRef.current.keys;
    const focus = inputRef.current.cameraFocus;
    if (focus) { targetRef.current = { x: focus.x / S, z: focus.y / S }; delete inputRef.current.cameraFocus; }
    const sp = (20 + distRef.current * 0.45) * Math.min(dt, .1);
    if (keys.has('home')) {
      const selected = gameStateRef.current.units.filter(u => u.alive && u.team === 'player' && u.selected && !u.insideOf);
      const focus = selected.length ? selected : gameStateRef.current.units.filter(u => u.alive && u.team === 'player' && !u.insideOf);
      if (focus.length) {
        targetRef.current.x = focus.reduce((n, u) => n + u.pos.x / S, 0) / focus.length;
        targetRef.current.z = focus.reduce((n, u) => n + u.pos.y / S, 0) / focus.length;
      }
    }
    // Q / E rotate the view; WASD pans relative to where the camera looks.
    if (keys.has('q')) yawRef.current += 1.4 * Math.min(dt, .1);
    if (keys.has('e')) yawRef.current -= 1.4 * Math.min(dt, .1);
    const yaw = yawRef.current, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    if (keys.has('w') || keys.has('arrowup')) { targetRef.current.x += fx * sp; targetRef.current.z += fz * sp; }
    if (keys.has('s') || keys.has('arrowdown')) { targetRef.current.x -= fx * sp; targetRef.current.z -= fz * sp; }
    if (keys.has('a') || keys.has('arrowleft')) { targetRef.current.x -= rx * sp; targetRef.current.z -= rz * sp; }
    if (keys.has('d') || keys.has('arrowright')) { targetRef.current.x += rx * sp; targetRef.current.z += rz * sp; }
    // Keep the view over the playable area; the scenery border fills the rest.
    targetRef.current.x = Math.max(PLAYABLE_CELLS[0], Math.min(PLAYABLE_CELLS[2], targetRef.current.x));
    targetRef.current.z = Math.max(PLAYABLE_CELLS[1], Math.min(PLAYABLE_CELLS[3], targetRef.current.z));
    const d = distRef.current;
    // Distance haze scales with zoom: close up the far countryside fades out,
    // zoomed out the whole board stays clear.
    // Distance haze scales with zoom (original distances, for the original camera angle).
    if (scene.fog instanceof THREE.Fog) { scene.fog.near = d * 2.2 + 30; scene.fog.far = d * 5 + 140; }
    const back = d * CAMERA_BACK;
    const ty = surfaceY(targetRef.current.x, targetRef.current.z);
    const camX = targetRef.current.x + Math.sin(yawRef.current) * back, camZ = targetRef.current.z + Math.cos(yawRef.current) * back;
    // Never inside a hill: stay above the ground under the camera.
    camera.position.set(camX, Math.max(ty + d * CAMERA_HEIGHT, surfaceY(camX, camZ) + 1.5), camZ);
    camera.lookAt(targetRef.current.x, ty, targetRef.current.z);
  }, -2);
  return null;
}

/**
 * Sun light whose shadow camera is aimed at the centre of the map and sized to
 * enclose it, so no region falls outside the shadow frustum (which would render
 * as a large permanently dark patch).
 */
/** Direction towards the sun (normalised), shared by the light and the sky. */
const SUN_DIR = (() => { const v = new THREE.Vector3(95, 75, 60).normalize(); return [v.x, v.y, v.z] as const; })();

function SunLight({ high }: { high: boolean }) {
  const { camera } = useThree();
  const ref = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const light = ref.current;
    if (!light) return;
    // Concentrate the shadow map on the view: sharper near shadows without
    // allocating a 4096 texture across the entire campaign region.
    const x = camera.position.x, z = camera.position.z - camera.position.y * .55 / .85;
    // Low afternoon sun (about 34° up): long shadows give hills, woods and houses their shape.
    light.position.set(x + SUN_DIR[0] * 120, SUN_DIR[1] * 120, z + SUN_DIR[2] * 120);
    light.target.position.set(x, 0, z); light.target.updateMatrixWorld();
    const extent = Math.max(32, Math.min(190, camera.position.y * .9));
    const shadow = light.shadow.camera;
    shadow.left = shadow.bottom = -extent; shadow.right = shadow.top = extent;
    shadow.updateProjectionMatrix();
  });
  return (
    <>
      <directionalLight
        ref={ref}
        position={[W / 2 + 120, 190, H / 2 + 90]}
        intensity={2.5} color="#ffe8c6"
        castShadow
        shadow-mapSize-width={high ? 2048 : 1024} shadow-mapSize-height={high ? 2048 : 1024}
        shadow-bias={-0.0006} shadow-normalBias={0.05}
        shadow-camera-near={1} shadow-camera-far={520}
        shadow-camera-left={-190} shadow-camera-right={190}
        shadow-camera-top={190} shadow-camera-bottom={-190}
      />
    </>
  );
}

function TerrainReadout({ gameStateRef, inputRef }: Pick<SceneProps, 'gameStateRef' | 'inputRef'>) {
  const [info, setInfo] = useState('');
  useEffect(() => {
    const timer = window.setInterval(() => {
      const p = inputRef.current.mouseWorldPos;
      const c = getTerrainAt(gameStateRef.current.terrain, p.x, p.y);
      if (!c) { setInfo(''); return; }
      if (c.type === 'road') setInfo(`${c.roadName || 'Asphalt'} · move ×1.46 · detection ×1.50 · exposed`);
      else if (isOccupyableCover(c)) setInfo(`${coverLabel(c)} · cover ${Math.round(c.coverBonus * 100)}% · right-click: occupy & hold`);
      else if (c.type === 'forest') setInfo('Mixed woodland · slower movement · concealment · infantry only');
      else if (c.roadName) setInfo(`${c.roadName} · gravel / shoulder · slower than asphalt`);
      else setInfo('');
    }, 150);
    return () => window.clearInterval(timer);
  }, [gameStateRef, inputRef]);
  return info ? <div className="absolute bottom-[216px] left-1/2 -translate-x-1/2 pointer-events-none font-mono text-[11px] px-3 py-2 rounded border border-[#82936b] bg-[#132019ed] text-[#deebc8]">{info}</div> : null;
}

// ---------- Scene root ----------
const Scene3D: React.FC<Omit<SceneProps, 'overlayRef'>> = ({ gameStateRef, inputRef, onChange }) => {
  const terrain = gameStateRef.current.terrain;
  // Shared height sampler used by every layer that only holds a gameStateRef.
  setActiveTerrain(terrain);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [highQuality, setHighQuality] = useState(true);
  const unitBadges = useRef(new Map<string, HTMLButtonElement>());
  const settlementLabels = useRef(new Map<string, HTMLDivElement>());

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows="soft"
        dpr={highQuality ? [1, 2] : [1, 1]}
        camera={{ position: [W / 2, 35, H / 2 + 20], fov: 50, far: 4500 }}
        onContextMenu={(e) => e.preventDefault()}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        style={{ background: '#b6c5cf' }}
      >
        <fog attach="fog" args={['#b6c5cf', 320, 760]} />
        {/* Atmospheric sky; the haze colour above matches its horizon. */}
        <group position={[W / 2, 0, H / 2]}>
          <Sky distance={3600} sunPosition={[SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]]} turbidity={7} rayleigh={1.1} mieCoefficient={0.006} mieDirectionalG={0.86} />
        </group>
        {/* Sky/bounce fill: enough to keep shade readable, low enough that shapes have form */}
        <hemisphereLight args={['#d4e2ea', '#4f5a3b', 0.55]} />
        <ambientLight intensity={0.12} />
        {/* Shadows follow the camera across the expanded region. */}
        <SunLight key={String(highQuality)} high={highQuality} />

        {/* Cool counter-light from the opposite side to lift shadow interiors */}
        <directionalLight position={[-50, 40, -35]} intensity={0.25} color="#9fb6c8" />

        <UnitBadgePositions gameStateRef={gameStateRef} elements={unitBadges} />
        <SettlementLabelPositions elements={settlementLabels} />
        <CameraRig inputRef={inputRef} gameStateRef={gameStateRef} />
        <OuterGround />
        <DistantHills />
        <TerrainMesh terrain={terrain} regional={gameStateRef.current.mission.mapLayout === 'leipalingis_region'} highQuality={highQuality} />
        <TerrainDebugLayer gameStateRef={gameStateRef} />
        <CapturePoints gameStateRef={gameStateRef} />
        <FobLayer gameStateRef={gameStateRef} />
        <CanopyReveal gameStateRef={gameStateRef} />
        {/* The living map: each line can be removed on its own */}
        <AmbienceClock />
        <ChimneySmoke terrain={terrain} />
        <Birds gameStateRef={gameStateRef} />
        <AmbientSound gameStateRef={gameStateRef} />
        <UnitsLayer gameStateRef={gameStateRef} inputRef={inputRef} />
        <GhostContactsLayer gameStateRef={gameStateRef} />
        <PathsLayer gameStateRef={gameStateRef} />
        <MovementDebugLayer gameStateRef={gameStateRef} />
        {highQuality && <PostEffects />}
        <CommandMarkersLayer gameStateRef={gameStateRef} />
        <EffectsLayer gameStateRef={gameStateRef} />
        <Ground gameStateRef={gameStateRef} inputRef={inputRef} onChange={onChange} />
        <SelectionOverlayUpdater inputRef={inputRef} overlayRef={overlayRef} />
      </Canvas>
      {SETTLEMENTS.map(town => <div key={town.id} ref={el => { if (el) settlementLabels.current.set(town.id, el); else settlementLabels.current.delete(town.id); }}
        className="absolute top-0 left-0 pointer-events-none text-center font-mono text-[11px] text-[#f1e6bf] px-2 py-1 border-b border-[#c8ba87] bg-[#1b2c25c9]"
        style={{ display: 'none' }}>{town.name.toUpperCase()}</div>)}
      {gameStateRef.current.units.filter(controllable).map(unit => {
        const Icon = unit.type === 'infantry' ? Footprints : unit.type === 'tank' ? Shield : unit.type === 'apc' ? Truck : Crosshair;
        const covered = coverState(unit);
        return <button key={unit.id} ref={el => { if (el) unitBadges.current.set(unit.id, el); else unitBadges.current.delete(unit.id); }}
          aria-label={`Map ${unit.type} ${unit.id}`} aria-pressed={unit.selected}
          className="absolute top-0 left-0 w-6 h-4 items-center justify-center rounded-sm border shadow-sm"
          style={{ display: 'none' }}
          onPointerDown={e => e.stopPropagation()}
          onContextMenu={e => { e.preventDefault(); handleRightClickWorld(unit.pos.x, unit.pos.y, gameStateRef.current, e.shiftKey, e.ctrlKey || e.metaKey); onChange(); }}
          onClick={e => { selectUnits(gameStateRef.current, [unit.id], e.shiftKey ? 'toggle' : 'replace'); onChange(); }}
          onDoubleClick={e => {
            selectUnits(gameStateRef.current, gameStateRef.current.units.filter(u => controllable(u) && u.type === unit.type && unitBadges.current.get(u.id)?.style.display === 'flex').map(u => u.id), e.shiftKey ? 'add' : 'replace'); onChange();
          }}>
          <Icon size={12} />
          {covered !== 'none' && <Shield size={10} fill={covered === 'covered' ? '#9ecb85' : '#293526'} className={`absolute -right-2 -top-2 ${covered === 'covered' ? 'text-[#d7ffbd]' : 'text-[#edce8c]'}`} />}
        </button>;
      })}
      <CampaignMap gameStateRef={gameStateRef} inputRef={inputRef} />
      <TerrainReadout gameStateRef={gameStateRef} inputRef={inputRef} />
      <button onClick={() => setHighQuality(q => !q)} className="absolute left-3 bottom-[216px] text-[10px] font-mono px-2 py-1 border border-[#576954] bg-[#142018e6] text-[#cfddbc]">
        Graphics: {highQuality ? 'High' : 'Standard'} · Home: focus troops
      </button>
      {/* Screen-space selection rectangle */}
      <div
        ref={overlayRef}
        className="absolute pointer-events-none"
        style={{
          display: 'none',
          border: '1.5px solid #7ec0ff',
          background: 'rgba(126,192,255,0.12)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 0 14px rgba(126,192,255,0.35)',
          mixBlendMode: 'screen',
        }}
      />
    </div>
  );
};

export default Scene3D;

