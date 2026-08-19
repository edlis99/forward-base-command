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


const S = CELL_SIZE;
const W = MAP_COLS;
const H = MAP_ROWS;
const DRAG_THRESHOLD_PX = 5;

const TERRAIN_COLORS: Record<string, string> = {
  open: '#5e7548', urban: '#827a70', forest: '#2f4a26', road: '#464338',
  water: '#264e6b', wall: '#6b665e', trench: '#2a2018', rubble: '#766f64',
  sandbag: '#a9986a', mud: '#57442b', crater: '#55432d', hedgerow: '#34522a',
  tall_grass: '#6f834a', gravel: '#8a7e6a',
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
  'tall_grass', 'trench', 'hedgerow',
]);

function TerrainMesh({ terrain }: { terrain: TerrainCell[][] }) {
  const groups = useMemo(() => {
    const byType: Record<string, { positions: [number, number, number][]; sizes: [number, number, number][] }> = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = terrain[y][x];
      const t = c.type;
      if (FLAT_TYPES.has(t)) continue; // drawn by GroundSurface / prop layers
      const h = TERRAIN_HEIGHT[t] ?? 0;
      if (!byType[t]) byType[t] = { positions: [], sizes: [] };
      byType[t].positions.push([x + 0.5, h / 2, y + 0.5]);
      byType[t].sizes.push([1, Math.max(0.02, Math.abs(h)), 1]);
    }
    return byType;
  }, [terrain]);

  return (
    <group>
      {/* Deep sub-surface slab so the landscape silhouette has thickness. */}
      <mesh position={[W / 2, -1.6, H / 2]} receiveShadow raycast={() => null}>
        <boxGeometry args={[W, 3, H]} />
        <meshStandardMaterial color="#3a3428" />
      </mesh>
      <GroundSurface terrain={terrain} />
      <WaterSheet terrain={terrain} />
      <GrassTufts terrain={terrain} />
      <GroundDetail terrain={terrain} />
      {Object.entries(groups).map(([type, g]) => (
        <InstancedTerrainGroup key={type} type={type} positions={g.positions} sizes={g.sizes} />
      ))}
      <TrenchInstances terrain={terrain} />
      <TreeInstances terrain={terrain} />
      <HedgerowInstances terrain={terrain} />
      <BuildingDetails terrain={terrain} />
    </group>
  );
}


/**
 * Zig-zag trench system with a sunken floor, firing step, and mixed
 * sandbag / timber / earth revetments per cell (deterministic by grid pos).
 * Each cell's parapet is split into two half-length yawed segments so the
 * fortification kinks every cell instead of forming a straight box.
 */
function TrenchInstances({ terrain }: { terrain: TerrainCell[][] }) {
  const computeCells = () => {
    const out: Array<{ x: number; y: number; horiz: boolean }> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
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
        // Keep the excavated floor just above the base terrain. The old floor
        // sat below the world slab and read as a featureless black square.
        tmp.position.set(cx, 0.018, cz);
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
        if (c.horiz) {
          tmp.position.set(cx, 0.075, cz + 0.19);
          tmp.scale.set(0.96, 0.11, 0.16);
        } else {
          tmp.position.set(cx + 0.19, 0.075, cz);
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
              tmp.position.set(xPos, 0.025 + h * 0.5, zPos);
              tmp.scale.set(halfLen, h, th);
            } else {
              const xPos = cx + side * (0.5 - th * 0.5);
              const zPos = cz + half * halfLen * 0.5;
              tmp.position.set(xPos, 0.025 + h * 0.5, zPos);
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
           const capY = 0.025 + hBase + capH * 0.5;
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
  }, [cells]);

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
        <meshStandardMaterial color="#ffffff" vertexColors flatShading roughness={1} />
      </instancedMesh>
      <instancedMesh ref={capRef} args={[undefined, undefined, capCount]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" vertexColors flatShading roughness={1} />
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

function TreeInstances({ terrain }: { terrain: TerrainCell[][] }) {
  const positions = useMemo(() => {
    const out: Array<{ x: number; z: number; s: number; rot: number; hue: number }> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = terrain[y][x];
      if (c.type === 'forest') {
        const seed = (x * 73 + y * 31) % 100;
        const variants = 2;
        for (let i = 0; i < variants + (seed > 60 ? 1 : 0); i++) {
          const sx = x + 0.2 + ((seed + i * 17) % 6) * 0.11;
          const sz = y + 0.2 + ((seed * 7 + i * 11) % 6) * 0.11;
          const s = 0.7 + ((seed + i * 5) % 7) * 0.08;
          const rot = ((seed + i * 23) % 360) * (Math.PI / 180);
          const hue = 0.85 + ((seed + i * 3) % 30) / 100;
          out.push({ x: sx, z: sz, s, rot, hue });
        }
      }
    }
    return out;
  }, [terrain]);

  const foliageRef = useRef<THREE.InstancedMesh>(null);
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!foliageRef.current || !trunkRef.current) return;
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const base = new THREE.Color('#2d4a25');
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      tmp.position.set(p.x, 1.0 * p.s + 0.4, p.z);
      tmp.scale.set(p.s, p.s * 1.3, p.s);
      tmp.rotation.y = p.rot;
      tmp.updateMatrix();
      foliageRef.current.setMatrixAt(i, tmp.matrix);
      col.copy(base).multiplyScalar(p.hue);
      foliageRef.current.setColorAt(i, col);
      // trunk
      tmp.position.set(p.x, 0.35 * p.s, p.z);
      tmp.scale.set(p.s * 0.18, p.s * 0.7, p.s * 0.18);
      tmp.rotation.y = 0;
      tmp.updateMatrix();
      trunkRef.current.setMatrixAt(i, tmp.matrix);
    }
    foliageRef.current.instanceMatrix.needsUpdate = true;
    if (foliageRef.current.instanceColor) foliageRef.current.instanceColor.needsUpdate = true;
    trunkRef.current.instanceMatrix.needsUpdate = true;
  }, [positions]);

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, positions.length]} castShadow raycast={() => null}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshStandardMaterial color="#3a2a1c" flatShading />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[undefined, undefined, positions.length]} castShadow raycast={() => null}>
        <coneGeometry args={[0.55, 1.8, 7]} />
        <meshStandardMaterial color="#ffffff" flatShading roughness={0.9} />
      </instancedMesh>
    </group>
  );
}

function HedgerowInstances({ terrain }: { terrain: TerrainCell[][] }) {
  const bushes = useMemo(() => {
    const out: Array<{ x: number; z: number; sx: number; sy: number; sz: number; rot: number; tint: number }> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
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
  }, [terrain]);

  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const base = new THREE.Color('#344f2a');
    for (let i = 0; i < bushes.length; i++) {
      const b = bushes[i];
      tmp.position.set(b.x, b.sy * 0.5, b.z);
      tmp.scale.set(b.sx, b.sy, b.sz);
      tmp.rotation.y = b.rot;
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
      col.copy(base).multiplyScalar(b.tint);
      ref.current.setColorAt(i, col);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [bushes]);

  if (bushes.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, bushes.length]} castShadow receiveShadow raycast={() => null}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#ffffff" vertexColors flatShading roughness={0.95} />
    </instancedMesh>
  );
}

function BuildingDetails({ terrain }: { terrain: TerrainCell[][] }) {
  const cells = useMemo(() => {
    const out: Array<{ x: number; y: number; rot: number; roof: string; damaged: boolean }> = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (terrain[y][x].type !== 'urban') continue;
      const seed = (x * 113 + y * 61) % 100;
      out.push({ x, y, rot: (seed % 4) * Math.PI / 2, roof: seed % 3 === 0 ? '#5f4a38' : '#6b5945', damaged: seed > 72 });
    }
    return out;
  }, [terrain]);

  const roofRef = useRef<THREE.InstancedMesh>(null);
  const windowRef = useRef<THREE.InstancedMesh>(null);
  const debrisRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    if (roofRef.current) {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        tmp.position.set(c.x + 0.5, 1.83, c.y + 0.5);
        tmp.scale.set(c.damaged ? 0.72 : 0.82, c.damaged ? 0.28 : 0.36, c.damaged ? 0.72 : 0.82);
        tmp.rotation.y = c.rot + Math.PI / 4;
        tmp.updateMatrix();
        roofRef.current.setMatrixAt(i, tmp.matrix);
        col.setStyle(c.damaged ? '#4b4033' : c.roof);
        roofRef.current.setColorAt(i, col);
      }
      roofRef.current.instanceMatrix.needsUpdate = true;
      if (roofRef.current.instanceColor) roofRef.current.instanceColor.needsUpdate = true;
    }
    if (windowRef.current) {
      let idx = 0;
      for (const c of cells) {
        for (const side of [-1, 1] as const) {
          tmp.position.set(c.x + 0.5, 1.18, c.y + 0.5 + side * 0.505);
          tmp.scale.set(0.42, 0.16, 0.025);
          tmp.rotation.y = c.rot;
          tmp.updateMatrix();
          windowRef.current.setMatrixAt(idx, tmp.matrix);
          idx++;
        }
      }
      windowRef.current.instanceMatrix.needsUpdate = true;
    }
    if (debrisRef.current) {
      let idx = 0;
      for (const c of cells) {
        if (!c.damaged) {
          tmp.scale.set(0, 0, 0);
        } else {
          tmp.position.set(c.x + 0.22, 0.16, c.y + 0.78);
          tmp.scale.set(0.34, 0.22, 0.24);
          tmp.rotation.y = c.rot * 0.7;
        }
        tmp.updateMatrix();
        debrisRef.current.setMatrixAt(idx, tmp.matrix);
        idx++;
      }
      debrisRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [cells]);

  if (cells.length === 0) return null;
  return (
    <group>
      <instancedMesh ref={roofRef} args={[undefined, undefined, cells.length]} castShadow receiveShadow raycast={() => null}>
        <coneGeometry args={[0.75, 0.55, 4]} />
        <meshStandardMaterial color="#ffffff" vertexColors flatShading roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={windowRef} args={[undefined, undefined, cells.length * 2]} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#3a3932" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={debrisRef} args={[undefined, undefined, cells.length]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6b6358" flatShading roughness={1} />
      </instancedMesh>
    </group>
  );
}

// ---------- Unit models ----------
function InfantryModel({ team }: { team: 'player' | 'enemy' }) {
  const uniform = team === 'player' ? '#465b43' : '#5b5438';
  const kit = team === 'player' ? '#2f3f30' : '#3f3a27';
  const accent = team === 'player' ? '#4e86b8' : '#b64c3b';
  return (
    <group scale={0.55}>
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
    <group scale={0.76}>
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
    <group scale={0.68}>
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
    <group scale={0.7} position={[0, 1.5, 0]}>
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
        const targetY = inTrench ? -0.08 : 0;
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
          bl.position.set(u.pos.x / S, 0.9, u.pos.y / S);
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
          position={[u.pos.x / S, 0, u.pos.y / S]}
        >
          {unitModel(u)}

          {/* hover ring (under selection/preview) */}
          <mesh
            ref={(el) => { if (el) hoverRefs.current.set(u.id, el); else hoverRefs.current.delete(u.id); }}
            position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} visible={false}
          >
            <ringGeometry args={[0.6, 0.7, 32]} />
            <meshBasicMaterial color="#cfd8c4" transparent opacity={0.55} />
          </mesh>

          {/* preview ring (while dragging) */}
          <mesh
            ref={(el) => { if (el) previewRefs.current.set(u.id, el); else previewRefs.current.delete(u.id); }}
            position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} visible={false}
          >
            <ringGeometry args={[0.62, 0.78, 32]} />
            <meshBasicMaterial color="#7ec0ff" transparent opacity={0.55} />
          </mesh>

          {/* confirmed selection ring */}
          <mesh
            ref={(el) => { if (el) selRefs.current.set(u.id, el); else selRefs.current.delete(u.id); }}
            position={[0, 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} visible={false}
          >
            <ringGeometry args={[0.55, 0.82, 36]} />
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
          position={[u.pos.x / S, 0.9, u.pos.y / S]}
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
      m.position.set(gh.pos.x / S, 0.04, gh.pos.y / S);
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
      positions[i] = p.from.x / S; positions[i + 1] = 0.5; positions[i + 2] = p.from.y / S;
      positions[i + 3] = p.to.x / S; positions[i + 4] = 0.5; positions[i + 5] = p.to.y / S;
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
        flash.position.set(mx, heavy ? 0.72 : 0.55, mz);
        flashRef.current.add(flash);
        const dust = new THREE.Mesh(
          new THREE.SphereGeometry(heavy ? 0.38 : 0.2, 8, 5),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.72, 0.62, 0.46), transparent: true, opacity: flashOpacity * (heavy ? 0.42 : 0.22), depthWrite: false }),
        );
        dust.scale.set(1.4, 0.35, 1.4);
        dust.position.set(mx - (dx / len) * 0.08, 0.22, mz - (dy / len) * 0.08);
        flashRef.current.add(dust);
        // Impact spark: only if it's a hit and near end of life (looks like arrival).
        if (p.hit && fresh > 0.7) {
          const sparkCol = p.crit ? new THREE.Color(1.0, 0.9, 0.4) : new THREE.Color(1.0, 0.7, 0.4);
          const spark = new THREE.Mesh(
            new THREE.SphereGeometry(0.14 + (p.crit ? 0.1 : 0), 6, 4),
            new THREE.MeshBasicMaterial({ color: sparkCol, transparent: true, opacity: flashOpacity * 0.8, depthWrite: false }),
          );
          spark.position.set(p.to.x / S, 0.5, p.to.y / S);
          flashRef.current.add(spark);
        }
        const impactDust = new THREE.Mesh(
          new THREE.SphereGeometry(heavy ? 0.42 : 0.18, 8, 5),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.58, 0.5, 0.38), transparent: true, opacity: flashOpacity * (p.hit ? 0.28 : 0.44), depthWrite: false }),
        );
        impactDust.scale.set(1.5, 0.28, 1.5);
        impactDust.position.set(p.to.x / S, 0.18, p.to.y / S);
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
        mesh.position.set(e.pos.x / S, 0.5, e.pos.y / S);
        explRef.current.add(mesh);
        const shock = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(0.05, r * 0.75), Math.max(0.08, r * 0.92), 32),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.72, 0.48), transparent: true, opacity: t * 0.45, side: THREE.DoubleSide, depthWrite: false }),
        );
        shock.rotation.x = -Math.PI / 2;
        shock.position.set(e.pos.x / S, 0.08, e.pos.y / S);
        explRef.current.add(shock);
        const smoke = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.2, r * 0.55), 10, 7),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.21, 0.18), transparent: true, opacity: Math.min(0.42, (1 - t) * 0.55), depthWrite: false }),
        );
        smoke.scale.set(1, 1.6, 1);
        smoke.position.set(e.pos.x / S, 0.55 + (1 - t) * 0.9, e.pos.y / S);
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
      ring.position.set(m.pos.x / S, 0.06, m.pos.y / S);
      groupRef.current.add(ring);
      // center dot
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.12, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op * 0.8, depthWrite: false }),
      );
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(m.pos.x / S, 0.07, m.pos.y / S);
      groupRef.current.add(dot);
    }
    // formation preview ghosts
    if (state.commandPreview) {
      for (const slot of state.commandPreview.slots) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.5, 0.62, 24),
          new THREE.MeshBasicMaterial({ color: '#7ec0ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(slot.x / S, 0.05, slot.y / S);
        groupRef.current.add(ring);
      }
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
        dummy.position.set(x + 0.5, 1.6, y + 0.5);
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
      ring.position.set(cp.pos.x / S, 0.05, cp.pos.y / S);
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
      positions[i] = a.x / S; positions[i + 1] = 0.2; positions[i + 2] = a.y / S;
      positions[i + 3] = b.x / S; positions[i + 4] = 0.2; positions[i + 5] = b.y / S;
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

// ---------- Ground click handler (screen-space drag threshold + preview) ----------
function Ground({ gameStateRef, inputRef, onChange }: Omit<SceneProps, 'overlayRef'>) {
  const { camera, size } = useThree();
  const projected = useMemo(() => new THREE.Vector3(), []);

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
      projected.set(unit.pos.x / S, 0.5, unit.pos.y / S).project(camera);
      if (projected.z > 1) continue; // behind the camera
      const sx = (projected.x * 0.5 + 0.5) * size.width;
      const sy = (-projected.y * 0.5 + 0.5) * size.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) hits.push(unit);
    }
    return hits;
  };

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const wx = e.point.x * S;
    const wy = e.point.z * S;
    const state = gameStateRef.current;
    const sp = canvasPos(e);

    if (e.nativeEvent.button === 2) {
      inputRef.current.rightMouseDown = true;
      // Live formation preview begins on press; commit on release.
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
    const wx = e.point.x * S, wy = e.point.z * S;
    const state = gameStateRef.current;
    const sp = canvasPos(e);
    inputRef.current.mouseWorldPos = { x: wx, y: wy };
    inputRef.current.mousePos = { x: sp.x, y: sp.y };

    // Live formation preview while RMB held
    if (inputRef.current.rightMouseDown) {
      updateCommandPreview(state, wx, wy);
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
      // commit right-click on release using cursor world pos
      const wx = e.point.x * S, wy = e.point.z * S;
      handleRightClickWorld(wx, wy, state, e.nativeEvent.shiftKey, e.nativeEvent.ctrlKey || e.nativeEvent.metaKey);
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
      const wx = e.point.x * S, wy = e.point.z * S;
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
      v.set(wx / S, 0, wy / S);
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
function CameraRig({ inputRef }: { inputRef: React.MutableRefObject<InputState> }) {
  const { camera } = useThree();
  const targetRef = useRef({ x: W / 2, z: H / 2 });
  const distRef = useRef(120);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      distRef.current = Math.max(24, Math.min(360, distRef.current + (e.deltaY > 0 ? 10 : -10)));
    };
    window.addEventListener('wheel', onWheel);
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  useFrame((_, dt) => {
    const keys = inputRef.current.keys;
    const sp = (40 + distRef.current * 0.6) * dt;
    if (keys.has('w') || keys.has('arrowup')) targetRef.current.z -= sp;
    if (keys.has('s') || keys.has('arrowdown')) targetRef.current.z += sp;
    if (keys.has('a') || keys.has('arrowleft')) targetRef.current.x -= sp;
    if (keys.has('d') || keys.has('arrowright')) targetRef.current.x += sp;
    targetRef.current.x = Math.max(5, Math.min(W - 5, targetRef.current.x));
    targetRef.current.z = Math.max(5, Math.min(H - 5, targetRef.current.z));
    const d = distRef.current;
    camera.position.set(targetRef.current.x, d * 0.85, targetRef.current.z + d * 0.55);
    camera.lookAt(targetRef.current.x, 0, targetRef.current.z);
  });
  return null;
}

// ---------- Scene root ----------
const Scene3D: React.FC<Omit<SceneProps, 'overlayRef'>> = ({ gameStateRef, inputRef, onChange }) => {
  const terrain = gameStateRef.current.terrain;
  const overlayRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        camera={{ position: [W / 2, 35, H / 2 + 20], fov: 50 }}
        onContextMenu={(e) => e.preventDefault()}
        gl={{ antialias: true }}
        style={{ background: '#1a201a' }}
      >
        <fog attach="fog" args={['#1a201a', 240, 560]} />
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[40, 60, 20]} intensity={1.1}
          castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024}
          shadow-camera-left={-50} shadow-camera-right={50} shadow-camera-top={50} shadow-camera-bottom={-50}
        />
        <CameraRig inputRef={inputRef} />
        <TerrainMesh terrain={terrain} />
        <TerrainDebugLayer gameStateRef={gameStateRef} />
        <CapturePoints gameStateRef={gameStateRef} />
        <UnitsLayer gameStateRef={gameStateRef} inputRef={inputRef} />
        <GhostContactsLayer gameStateRef={gameStateRef} />
        <PathsLayer gameStateRef={gameStateRef} />
        <CommandMarkersLayer gameStateRef={gameStateRef} />
        <EffectsLayer gameStateRef={gameStateRef} />
        <Ground gameStateRef={gameStateRef} inputRef={inputRef} onChange={onChange} />
        <SelectionOverlayUpdater gameStateRef={gameStateRef} overlayRef={overlayRef} />
      </Canvas>
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
