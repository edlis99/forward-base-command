import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState, InputState, Unit, TerrainCell } from '../game/types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import {
  handleLeftClickWorld, handleRightClickWorld, handleBoxSelect,
  updatePreviewSelection, updateCommandPreview, clearCommandPreview,
} from '../game/engine';
import { cellCoverScore, cellConcealmentScore, cellTacticalScore, scoreToColor } from '../game/tactical';

const S = CELL_SIZE;
const W = MAP_COLS;
const H = MAP_ROWS;
const DRAG_THRESHOLD_PX = 5;

const TERRAIN_COLORS: Record<string, string> = {
  open: '#5e7548', urban: '#8a807a', forest: '#2f4a26', road: '#3f3a32',
  water: '#264e6b', wall: '#6b665e', trench: '#2a2018', rubble: '#766f64',
  sandbag: '#a9986a', mud: '#3a2c1c', crater: '#26201a', hedgerow: '#34522a',
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
function TerrainMesh({ terrain }: { terrain: TerrainCell[][] }) {
  const groups = useMemo(() => {
    const byType: Record<string, { positions: [number, number, number][]; sizes: [number, number, number][] }> = {};
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = terrain[y][x];
      const t = c.type;
      const h = TERRAIN_HEIGHT[t] ?? 0;
      if (!byType[t]) byType[t] = { positions: [], sizes: [] };
      byType[t].positions.push([x + 0.5, h / 2, y + 0.5]);
      byType[t].sizes.push([1, Math.max(0.02, Math.abs(h)), 1]);
    }
    return byType;
  }, [terrain]);

  return (
    <group>
      <mesh position={[W / 2, -0.5, H / 2]} receiveShadow>
        <boxGeometry args={[W, 1, H]} />
        <meshStandardMaterial color="#3a4a32" />
      </mesh>
      {Object.entries(groups).map(([type, g]) => (
        <InstancedTerrainGroup key={type} type={type} positions={g.positions} sizes={g.sizes} />
      ))}
      <TreeInstances terrain={terrain} />
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
      if (c.type === 'forest' || c.type === 'hedgerow') {
        const seed = (x * 73 + y * 31) % 100;
        const variants = c.type === 'forest' ? 2 : 1;
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

// ---------- Unit models ----------
function InfantryModel({ team }: { team: 'player' | 'enemy' }) {
  const c = team === 'player' ? '#3b6db8' : '#b84a3b';
  return (
    <group scale={0.5}>
      <mesh position={[0, 0.6, 0]} castShadow><capsuleGeometry args={[0.18, 0.5, 4, 8]} /><meshStandardMaterial color={c} flatShading /></mesh>
      <mesh position={[0, 1.05, 0]} castShadow><sphereGeometry args={[0.2, 8, 6]} /><meshStandardMaterial color="#2a2a25" flatShading /></mesh>
      <mesh position={[0.25, 0.7, 0]} rotation={[0, 0, -0.2]} castShadow><boxGeometry args={[0.5, 0.08, 0.08]} /><meshStandardMaterial color="#202020" /></mesh>
    </group>
  );
}
function TankModel({ team }: { team: 'player' | 'enemy' }) {
  const c = team === 'player' ? '#345e80' : '#7a3a30';
  return (
    <group scale={0.7}>
      <mesh position={[0, 0.25, 0]} castShadow><boxGeometry args={[1.4, 0.4, 1]} /><meshStandardMaterial color={c} flatShading /></mesh>
      <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[0.8, 0.3, 0.7]} /><meshStandardMaterial color={c} flatShading /></mesh>
      <mesh position={[0.7, 0.55, 0]} castShadow><boxGeometry args={[0.9, 0.1, 0.12]} /><meshStandardMaterial color="#1a1a1a" /></mesh>
      <mesh position={[0, 0.1, 0.55]} castShadow><boxGeometry args={[1.5, 0.18, 0.18]} /><meshStandardMaterial color="#2a2a2a" /></mesh>
      <mesh position={[0, 0.1, -0.55]} castShadow><boxGeometry args={[1.5, 0.18, 0.18]} /><meshStandardMaterial color="#2a2a2a" /></mesh>
    </group>
  );
}
function ApcModel({ team }: { team: 'player' | 'enemy' }) {
  const c = team === 'player' ? '#3d7099' : '#995040';
  return (
    <group scale={0.65}>
      <mesh position={[0, 0.35, 0]} castShadow><boxGeometry args={[1.3, 0.55, 0.85]} /><meshStandardMaterial color={c} flatShading /></mesh>
      <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[0.4, 0.2, 0.4]} /><meshStandardMaterial color={c} flatShading /></mesh>
      <mesh position={[0.45, 0.1, 0.45]} castShadow><cylinderGeometry args={[0.15, 0.15, 0.1, 8]} /><meshStandardMaterial color="#1a1a1a" /></mesh>
      <mesh position={[-0.45, 0.1, 0.45]} castShadow><cylinderGeometry args={[0.15, 0.15, 0.1, 8]} /><meshStandardMaterial color="#1a1a1a" /></mesh>
      <mesh position={[0.45, 0.1, -0.45]} castShadow><cylinderGeometry args={[0.15, 0.15, 0.1, 8]} /><meshStandardMaterial color="#1a1a1a" /></mesh>
      <mesh position={[-0.45, 0.1, -0.45]} castShadow><cylinderGeometry args={[0.15, 0.15, 0.1, 8]} /><meshStandardMaterial color="#1a1a1a" /></mesh>
    </group>
  );
}
function HeliModel({ team }: { team: 'player' | 'enemy' }) {
  const c = team === 'player' ? '#3a6090' : '#993a35';
  const rotorRef = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (rotorRef.current) rotorRef.current.rotation.y += dt * 30; });
  return (
    <group scale={0.7} position={[0, 1.5, 0]}>
      <mesh castShadow><boxGeometry args={[1.4, 0.35, 0.5]} /><meshStandardMaterial color={c} flatShading /></mesh>
      <mesh ref={rotorRef} position={[0, 0.3, 0]}><boxGeometry args={[2.2, 0.04, 0.12]} /><meshStandardMaterial color="#202020" /></mesh>
      <mesh position={[-0.9, 0.15, 0]}><boxGeometry args={[0.8, 0.12, 0.12]} /><meshStandardMaterial color={c} flatShading /></mesh>
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
        ref.visible = u.team === 'player' || u.spottedByEnemy;
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

          {/* digging ring */}
          {u.order === 'entrench' && (
            <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <ringGeometry args={[0.4, 0.48, 24, 1, 0, Math.min(Math.PI * 2, (u.digTimer / 6) * Math.PI * 2)]} />
              <meshBasicMaterial color="#d4c47a" transparent opacity={0.9} side={2} />
            </mesh>
          )}

          <HealthBar u={u} />
        </group>
      ))}
    </group>
  );
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

  useFrame(() => {
    const state = gameStateRef.current;
    const positions = positionsRef.current;
    const colors = colorsRef.current;
    let count = 0;
    for (const p of state.projectiles) {
      if (count + 2 > 500) break;
      const i = count * 3;
      positions[i] = p.from.x / S; positions[i + 1] = 0.5; positions[i + 2] = p.from.y / S;
      positions[i + 3] = p.to.x / S; positions[i + 4] = 0.5; positions[i + 5] = p.to.y / S;
      const col = p.team === 'player' ? [0.45, 0.7, 1] : [1, 0.5, 0.25];
      colors[i] = col[0]; colors[i + 1] = col[1]; colors[i + 2] = col[2];
      colors[i + 3] = col[0]; colors[i + 4] = col[1]; colors[i + 5] = col[2];
      count += 2;
    }
    if (linesRef.current) {
      const geo = linesRef.current.geometry as THREE.BufferGeometry;
      geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, count * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, count * 3), 3));
      geo.setDrawRange(0, count);
      geo.attributes.position.needsUpdate = true;
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
      }
    }
  });

  return (
    <group>
      <lineSegments ref={linesRef}>
        <bufferGeometry />
        <lineBasicMaterial vertexColors linewidth={2} />
      </lineSegments>
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
  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const wx = e.point.x * S;
    const wy = e.point.z * S;
    const state = gameStateRef.current;
    const sx = e.nativeEvent.clientX, sy = e.nativeEvent.clientY;

    if (e.nativeEvent.button === 2) {
      inputRef.current.rightMouseDown = true;
      // Live formation preview begins on press; commit on release.
      updateCommandPreview(state, wx, wy);
      onChange();
    } else if (e.nativeEvent.button === 0) {
      inputRef.current.dragStart = { x: wx, y: wy };
      inputRef.current.dragStartScreen = { x: sx, y: sy };
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
    inputRef.current.mouseWorldPos = { x: wx, y: wy };
    inputRef.current.mousePos = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };

    // Live formation preview while RMB held
    if (inputRef.current.rightMouseDown) {
      updateCommandPreview(state, wx, wy);
    }

    if (inputRef.current.isDragging && inputRef.current.dragStartScreen && inputRef.current.dragStart) {
      const ds = inputRef.current.dragStartScreen;
      const dx = e.nativeEvent.clientX - ds.x;
      const dy = e.nativeEvent.clientY - ds.y;
      const screenDist = Math.hypot(dx, dy);
      if (!inputRef.current.dragPromoted && screenDist > DRAG_THRESHOLD_PX) {
        inputRef.current.dragPromoted = true;
        state.selectionBox = { start: { ...inputRef.current.dragStart }, end: { x: wx, y: wy } };
      }
      if (inputRef.current.dragPromoted && state.selectionBox) {
        state.selectionBox.end = { x: wx, y: wy };
        updatePreviewSelection(state);
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
      const { start, end } = state.selectionBox;
      handleBoxSelect(start.x, start.y, end.x, end.y, state, e.nativeEvent.shiftKey);
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
  const distRef = useRef(70);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      distRef.current = Math.max(20, Math.min(140, distRef.current + (e.deltaY > 0 ? 4 : -4)));
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
        <fog attach="fog" args={['#1a201a', 100, 220]} />
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
