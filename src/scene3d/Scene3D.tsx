import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState, InputState, Unit, TerrainCell } from '../game/types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import {
  handleLeftClickWorld, handleRightClickWorld, handleBoxSelect,
  updatePreviewSelection, updateCommandPreview, clearCommandPreview,
} from '../game/engine';
import { cellCoverScore, cellConcealmentScore, cellTacticalScore, scoreToColor } from '../game/tactical';
import { GroundSurface, WaterSheet, GrassTufts, GroundDetail } from './GroundSurface';
import { MAP_SECTIONS, MapSection } from './mapSections';
import { CampaignMap } from '../components/CampaignMap';
import { SETTLEMENTS } from '../game/maps/settlements';
import { SettlementLabelPositions } from './SettlementLabels';
import { Woodland, RuralBuildingsAndProps } from './Environment';
import { getTerrainAt } from '../game/terrain';
import { coverLabel, isOccupyableCover } from '../game/cover';
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
function TerrainMesh({ terrain, regional }: { terrain: TerrainCell[][]; regional: boolean }) {
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
    {visible.map(section => <TerrainSection key={section.id} terrain={terrain} regional={regional} section={section} />)}
  </group>;
}

function TerrainSection({ terrain, regional, section }: { terrain: TerrainCell[][]; regional: boolean; section: MapSection }) {
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
      <Woodland terrain={terrain} section={section} />
      <HedgerowInstances terrain={terrain} section={section} />
      <RuralBuildingsAndProps terrain={terrain} section={section} />
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

function InfantryModel({ team }: { team: 'player' | 'enemy' }) {
  const uniform = team === 'player' ? '#465b43' : '#5b5438';
  const kit = team === 'player' ? '#2f3f30' : '#3f3a27';
  const accent = team === 'player' ? '#4e86b8' : '#b64c3b';
  return (
    <group scale={0.18}>
      <mesh position={[0, 0.62, 0]} castShadow><boxGeometry args={[0.32, 0.48, 0.22]} /><meshStandardMaterial color={uniform} flatShading roughness={0.95} /></mesh>
      <mesh position={[-0.02, 0.34, 0]} castShadow><boxGeometry args={[0.28, 0.18, 0.2]} /><meshStandardMaterial color={kit} flatShading roughness={0.95} /></mesh>
      <mesh position={[0, 1.0, 0]} castShadow><sphereGeometry args={[0.18, 10, 7]} /><meshStandardMaterial color="#b79a75" flatShading roughness={0.9} /></mesh>
      <mesh position={[0, 1.09, 0]} scale={[1.05, 0.55, 1.05]} castShadow><sphereGeometry args={[0.2, 10, 6]} /><meshStandardMaterial color={kit} flatShading roughness={0.95} /></mesh>
      <mesh position={[-0.03, 0.67, -0.17]} castShadow><boxGeometry args={[0.32, 0.38, 0.12]} /><meshStandardMaterial color="#2a3328" flatShading roughness={1} /></mesh>
      <mesh position={[0.18, 0.65, 0.03]} rotation={[0, 0, -0.38]} castShadow><boxGeometry args={[0.12, 0.4, 0.1]} /><meshStandardMaterial color={uniform} flatShading roughness={1} /></mesh>
      <mesh position={[0.33, 0.64, 0.02]} rotation={[0, 0.05, -0.12]} castShadow><boxGeometry args={[0.62, 0.055, 0.07]} /><meshStandardMaterial color="#2c2821" roughness={0.8} /></mesh>
      <mesh position={[-0.1, 0.18, 0.06]} rotation={[0.12, 0, 0.12]} castShadow><boxGeometry args={[0.1, 0.34, 0.09]} /><meshStandardMaterial color={uniform} flatShading roughness={1} /></mesh>
      <mesh position={[0.12, 0.18, -0.04]} rotation={[-0.12, 0, -0.1]} castShadow><boxGeometry args={[0.1, 0.34, 0.09]} /><meshStandardMaterial color={uniform} flatShading roughness={1} /></mesh>
      <mesh position={[0, 0.9, 0.125]} castShadow><boxGeometry args={[0.24, 0.045, 0.025]} /><meshStandardMaterial color={accent} /></mesh>
    </group>
  );
}
function TankModel({ team }: { team: 'player' | 'enemy' }) {
  const hull = team === 'player' ? '#4b5b45' : '#5f563a';
  const dark = '#25271f';
  const accent = team === 'player' ? '#4e86b8' : '#b64c3b';
  return (
    <group scale={0.34}>
      <mesh position={[0, 0.26, 0]} castShadow><boxGeometry args={[1.65, 0.36, 0.98]} /><meshStandardMaterial color={hull} flatShading roughness={0.9} /></mesh>
      <mesh position={[0.1, 0.48, 0]} castShadow><boxGeometry args={[1.05, 0.26, 0.78]} /><meshStandardMaterial color={hull} flatShading roughness={0.9} /></mesh>
      <mesh position={[0.04, 0.66, 0]} rotation={[0, 0, -0.04]} castShadow><boxGeometry args={[0.74, 0.28, 0.62]} /><meshStandardMaterial color="#55654c" flatShading roughness={0.9} /></mesh>
      <mesh position={[0.72, 0.66, 0]} castShadow><boxGeometry args={[1.05, 0.085, 0.11]} /><meshStandardMaterial color={dark} roughness={0.75} /></mesh>
      <mesh position={[1.28, 0.66, 0]} castShadow><cylinderGeometry args={[0.07, 0.07, 0.18, 8]} /><meshStandardMaterial color={dark} roughness={0.75} /></mesh>
      <mesh position={[0, 0.13, 0.58]} castShadow><boxGeometry args={[1.78, 0.22, 0.18]} /><meshStandardMaterial color={dark} flatShading roughness={1} /></mesh>
      <mesh position={[0, 0.13, -0.58]} castShadow><boxGeometry args={[1.78, 0.22, 0.18]} /><meshStandardMaterial color={dark} flatShading roughness={1} /></mesh>
      <mesh position={[-0.22, 0.74, 0.01]} castShadow><cylinderGeometry args={[0.12, 0.12, 0.08, 8]} /><meshStandardMaterial color="#30362c" flatShading roughness={1} /></mesh>
      <mesh position={[-0.48, 0.58, 0.42]} rotation={[0, 0.2, 0]} castShadow><boxGeometry args={[0.08, 0.32, 0.04]} /><meshStandardMaterial color="#181a15" /></mesh>
      <mesh position={[-0.15, 0.82, 0]} castShadow><boxGeometry args={[0.34, 0.035, 0.18]} /><meshStandardMaterial color={accent} /></mesh>
    </group>
  );
}
function ApcModel({ team }: { team: 'player' | 'enemy' }) {
  const hull = team === 'player' ? '#4d604d' : '#655b3d';
  const dark = '#24261f';
  const accent = team === 'player' ? '#4e86b8' : '#b64c3b';
  return (
    <group scale={0.33}>
      <mesh position={[0, 0.36, 0]} castShadow><boxGeometry args={[1.52, 0.5, 0.86]} /><meshStandardMaterial color={hull} flatShading roughness={0.92} /></mesh>
      <mesh position={[0.44, 0.56, 0]} rotation={[0, 0, -0.12]} castShadow><boxGeometry args={[0.54, 0.22, 0.78]} /><meshStandardMaterial color="#5f7158" flatShading roughness={0.92} /></mesh>
      <mesh position={[0, 0.72, 0]} castShadow><boxGeometry args={[0.42, 0.18, 0.38]} /><meshStandardMaterial color={hull} flatShading roughness={0.9} /></mesh>
      <mesh position={[0.35, 0.78, 0]} castShadow><boxGeometry args={[0.58, 0.055, 0.07]} /><meshStandardMaterial color={dark} /></mesh>
      {[-0.52, -0.16, 0.2, 0.56].map((x) => (
        <React.Fragment key={x}>
          <mesh position={[x, 0.14, 0.48]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.13, 0.13, 0.1, 10]} /><meshStandardMaterial color={dark} roughness={1} /></mesh>
          <mesh position={[x, 0.14, -0.48]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.13, 0.13, 0.1, 10]} /><meshStandardMaterial color={dark} roughness={1} /></mesh>
        </React.Fragment>
      ))}
      <mesh position={[-0.22, 0.64, 0.42]} rotation={[0, 0.22, 0]} castShadow><boxGeometry args={[0.07, 0.28, 0.04]} /><meshStandardMaterial color="#181a15" /></mesh>
      <mesh position={[-0.12, 0.84, 0]} castShadow><boxGeometry args={[0.3, 0.035, 0.16]} /><meshStandardMaterial color={accent} /></mesh>
    </group>
  );
}
function HeliModel({ team }: { team: 'player' | 'enemy' }) {
  const c = team === 'player' ? '#4d5c48' : '#625637';
  const accent = team === 'player' ? '#4e86b8' : '#b64c3b';
  const rotorRef = useRef<THREE.Mesh>(null);
  const tailRotorRef = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (rotorRef.current) rotorRef.current.rotation.y += dt * 34;
    if (tailRotorRef.current) tailRotorRef.current.rotation.x += dt * 48;
  });
  return (
    <group scale={0.4} position={[0, 1.5, 0]}>
      <mesh position={[0.15, 0, 0]} castShadow><boxGeometry args={[1.2, 0.36, 0.46]} /><meshStandardMaterial color={c} flatShading roughness={0.85} /></mesh>
      <mesh position={[0.58, 0.02, 0]} castShadow><sphereGeometry args={[0.28, 10, 7]} /><meshStandardMaterial color="#2c3430" flatShading roughness={0.75} /></mesh>
      <mesh ref={rotorRef} position={[0, 0.34, 0]}><boxGeometry args={[2.5, 0.035, 0.12]} /><meshStandardMaterial color="#1b1d18" transparent opacity={0.82} /></mesh>
      <mesh position={[-0.95, 0.05, 0]} castShadow><boxGeometry args={[1.05, 0.11, 0.11]} /><meshStandardMaterial color={c} flatShading roughness={0.9} /></mesh>
      <mesh position={[-1.5, 0.08, 0]} castShadow><boxGeometry args={[0.18, 0.34, 0.06]} /><meshStandardMaterial color={c} flatShading roughness={0.9} /></mesh>
      <mesh ref={tailRotorRef} position={[-1.6, 0.08, 0.04]}><boxGeometry args={[0.04, 0.5, 0.08]} /><meshStandardMaterial color="#1b1d18" transparent opacity={0.82} /></mesh>
      <mesh position={[0.12, -0.28, 0.34]} castShadow><boxGeometry args={[1.0, 0.05, 0.08]} /><meshStandardMaterial color="#22241e" /></mesh>
      <mesh position={[0.12, -0.28, -0.34]} castShadow><boxGeometry args={[1.0, 0.05, 0.08]} /><meshStandardMaterial color="#22241e" /></mesh>
      <mesh position={[0.24, 0.24, 0]} castShadow><boxGeometry args={[0.3, 0.035, 0.16]} /><meshStandardMaterial color={accent} /></mesh>
    </group>
  );
}

function unitModel(u: Unit) {
  switch (u.type) {
    case 'infantry': return <InfantryModel team={u.team} />;
    case 'tank': return <TankModel team={u.team} />;
    case 'apc': return <ApcModel team={u.team} />;
    case 'helicopter': return <HeliModel team={u.team} />;
  }
}

// ---------- Units layer (with selection/preview/hover rings) ----------
function UnitsLayer({ gameStateRef, inputRef }: { gameStateRef: React.MutableRefObject<GameState>; inputRef: React.MutableRefObject<InputState> }) {
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
    const ids = state.units.filter(u => u.alive).map(u => u.id).join(',');
    if (ids !== knownIdsRef.current) {
      knownIdsRef.current = ids;
      forceRender();
      return;
    }
    const t = performance.now() * 0.001;
    const pulse = 1.0 + Math.sin(t * 6) * 0.08;
    const mw = inputRef.current.mouseWorldPos;

    // find best hover candidate (single closest friendly within radius)
    let hoverId: string | null = null;
    if (mw) {
      let bestD = 24 * 24;
      for (const u of state.units) {
        if (!u.alive || u.team !== 'player' || u.insideOf) continue;
        const dx = u.pos.x - mw.x, dy = u.pos.y - mw.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; hoverId = u.id; }
      }
    }

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
        const proneTarget = (u.prone || isDigging) ? 0.62 : inTrench ? 0.78 : 1;
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
          {unitModel(u)}

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
            new THREE.RingGeometry(0.28, 0.42, 20),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
          );
        } else {
          const w = slot.type === 'tank' ? 1.5 : 1.2;
          const l = slot.type === 'helicopter' ? 1.6 : w * 1.7;
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

// ---------- Ground click handler (screen-space drag threshold + preview) ----------
function Ground({ gameStateRef, inputRef, onChange }: Omit<SceneProps, 'overlayRef'>) {
  const { camera, size } = useThree();
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
    const el = e.nativeEvent.target as HTMLElement | null;
    const rect = el?.getBoundingClientRect?.();
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
      const uy = surfaceY(unit.pos.x / S, unit.pos.y / S) + (unit.type === 'helicopter' ? 1.5 : 0.5);
      projected.set(unit.pos.x / S, uy, unit.pos.y / S).project(camera);
      if (projected.z > 1) continue; // behind the camera
      const sx = (projected.x * 0.5 + 0.5) * size.width;
      const sy = (-projected.y * 0.5 + 0.5) * size.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) hits.push(unit);
    }
    return hits;
  };

  /** Press-and-drag placement: press locks the destination, drag sets arrival facing + frontage. */
  const placeRef = useRef<{ dest: { x: number; y: number }; facing?: number; width?: number } | null>(null);

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
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
    if (e.nativeEvent.button === 2) {
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
    if (e.nativeEvent.button !== 0) return;

    if (inputRef.current.dragPromoted && state.selectionBox) {
      const sp = canvasPos(e);
      const hits = unitsInScreenRect(sp.x, sp.y);
      if (!e.nativeEvent.shiftKey) state.units.forEach(u => { u.selected = false; });
      for (const u of hits) u.selected = true;
    } else {
      // tap = single-unit select
      const { x: wx, y: wy } = pickWorld(e);
      handleLeftClickWorld(wx, wy, state, e.nativeEvent.shiftKey);
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
      visible={false}
    >
      <planeGeometry args={[W * 2, H * 2]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}

// ---------- Screen-space selection rectangle (HTML overlay) ----------
function SelectionOverlayUpdater({ gameStateRef, overlayRef }: { gameStateRef: React.MutableRefObject<GameState>; overlayRef: React.MutableRefObject<HTMLDivElement | null> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const el = overlayRef.current;
    if (!el) return;
    const sb = gameStateRef.current.selectionBox;
    if (!sb) { el.style.display = 'none'; return; }
    // Project four corners to screen and take the AABB
    const xs = [sb.start.x, sb.end.x];
    const ys = [sb.start.y, sb.end.y];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const wx of xs) for (const wy of ys) {
      v.set(wx / S, surfaceY(wx / S, wy / S) + 0.4, wy / S);
      v.project(camera);
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
    }
    el.style.display = 'block';
    el.style.left = `${minX}px`;
    el.style.top = `${minY}px`;
    el.style.width = `${Math.max(1, maxX - minX)}px`;
    el.style.height = `${Math.max(1, maxY - minY)}px`;
  });
  return null;
}

// ---------- Camera rig ----------
function CameraRig({ inputRef, gameStateRef }: { inputRef: React.MutableRefObject<InputState>; gameStateRef: React.MutableRefObject<GameState> }) {
  const { camera } = useThree();
  const players = gameStateRef.current.units.filter(u => u.team === 'player' && u.alive);
  const targetRef = useRef({ x: players.reduce((n, u) => n + u.pos.x / S, 0) / (players.length || 1), z: players.reduce((n, u) => n + u.pos.y / S, 0) / (players.length || 1) });
  const distRef = useRef(32);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      distRef.current = Math.max(16, Math.min(400, distRef.current + (e.deltaY > 0 ? 10 : -10)));
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
    if (keys.has('w') || keys.has('arrowup')) targetRef.current.z -= sp;
    if (keys.has('s') || keys.has('arrowdown')) targetRef.current.z += sp;
    if (keys.has('a') || keys.has('arrowleft')) targetRef.current.x -= sp;
    if (keys.has('d') || keys.has('arrowright')) targetRef.current.x += sp;
    targetRef.current.x = Math.max(5, Math.min(W - 5, targetRef.current.x));
    targetRef.current.z = Math.max(5, Math.min(H - 5, targetRef.current.z));
    const d = distRef.current;
    camera.position.set(targetRef.current.x, d * 0.85, targetRef.current.z + d * 0.55);
    camera.lookAt(targetRef.current.x, surfaceY(targetRef.current.x, targetRef.current.z), targetRef.current.z);
  }, -2);
  return null;
}

/**
 * Sun light whose shadow camera is aimed at the centre of the map and sized to
 * enclose it, so no region falls outside the shadow frustum (which would render
 * as a large permanently dark patch).
 */
function SunLight({ high }: { high: boolean }) {
  const { camera } = useThree();
  const ref = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const light = ref.current;
    if (!light) return;
    // Concentrate the shadow map on the view: sharper near shadows without
    // allocating a 4096 texture across the entire campaign region.
    const x = camera.position.x, z = camera.position.z - camera.position.y * .55 / .85;
    light.position.set(x + 55, 90, z + 38);
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
        intensity={1.3} color="#fff3da"
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
  return info ? <div className="absolute bottom-28 left-1/2 -translate-x-1/2 pointer-events-none font-mono text-[11px] px-3 py-2 rounded border border-[#82936b] bg-[#132019ed] text-[#deebc8]">{info}</div> : null;
}

// ---------- Scene root ----------
const Scene3D: React.FC<Omit<SceneProps, 'overlayRef'>> = ({ gameStateRef, inputRef, onChange }) => {
  const terrain = gameStateRef.current.terrain;
  // Shared height sampler used by every layer that only holds a gameStateRef.
  setActiveTerrain(terrain);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [highQuality, setHighQuality] = useState(true);
  const settlementLabels = useRef(new Map<string, HTMLDivElement>());

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        dpr={highQuality ? [1, 2] : [1, 1]}
        camera={{ position: [W / 2, 35, H / 2 + 20], fov: 50 }}
        onContextMenu={(e) => e.preventDefault()}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
        style={{ background: '#b9c6bd' }}
      >
        <fog attach="fog" args={['#b3c1b6', 320, 760]} />
        {/* Sky/bounce fill so shaded slopes never read as black patches */}
        <hemisphereLight args={['#cfe0e8', '#5f6b48', 0.95]} />
        <ambientLight intensity={0.45} />
        {/* Shadows follow the camera across the expanded region. */}
        <SunLight key={String(highQuality)} high={highQuality} />

        {/* Cool counter-light from the opposite side to lift shadow interiors */}
        <directionalLight position={[-50, 40, -35]} intensity={0.35} color="#9fb6c8" />

        <SettlementLabelPositions elements={settlementLabels} />
        <CameraRig inputRef={inputRef} gameStateRef={gameStateRef} />
        <TerrainMesh terrain={terrain} regional={gameStateRef.current.mission.mapLayout === 'leipalingis_region'} />
        <TerrainDebugLayer gameStateRef={gameStateRef} />
        <CapturePoints gameStateRef={gameStateRef} />
        <UnitsLayer gameStateRef={gameStateRef} inputRef={inputRef} />
        <GhostContactsLayer gameStateRef={gameStateRef} />
        <PathsLayer gameStateRef={gameStateRef} />
        <MovementDebugLayer gameStateRef={gameStateRef} />
        <CommandMarkersLayer gameStateRef={gameStateRef} />
        <EffectsLayer gameStateRef={gameStateRef} />
        <Ground gameStateRef={gameStateRef} inputRef={inputRef} onChange={onChange} />
        <SelectionOverlayUpdater gameStateRef={gameStateRef} overlayRef={overlayRef} />
      </Canvas>
      {SETTLEMENTS.map(town => <div key={town.id} ref={el => { if (el) settlementLabels.current.set(town.id, el); else settlementLabels.current.delete(town.id); }}
        className="absolute top-0 left-0 pointer-events-none text-center font-mono text-[11px] text-[#f1e6bf] px-2 py-1 border-b border-[#c8ba87] bg-[#1b2c25c9]"
        style={{ display: 'none' }}>{town.name.toUpperCase()}</div>)}
      <CampaignMap gameStateRef={gameStateRef} inputRef={inputRef} />
      <TerrainReadout gameStateRef={gameStateRef} inputRef={inputRef} />
      <button onClick={() => setHighQuality(q => !q)} className="absolute left-3 bottom-40 text-[10px] font-mono px-2 py-1 border border-[#576954] bg-[#142018e6] text-[#cfddbc]">
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

