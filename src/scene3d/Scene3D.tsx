import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { GameState, InputState, Unit, TerrainCell } from '../game/types';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/constants';
import { handleLeftClickWorld, handleRightClickWorld, handleBoxSelect } from '../game/engine';

const S = CELL_SIZE; // game-to-world: divide by S → world units = grid cells
const W = MAP_COLS;
const H = MAP_ROWS;

const TERRAIN_COLORS: Record<string, string> = {
  open: '#6b7f5a', urban: '#8a847a', forest: '#3e5a35', road: '#56524a',
  water: '#2c5570', wall: '#5a5550', trench: '#3a3525', rubble: '#6a6560',
  sandbag: '#a59670', mud: '#4a3a25', crater: '#322d25', hedgerow: '#3e5b34',
  tall_grass: '#7a8a4e', gravel: '#857a6a',
};

const TERRAIN_HEIGHT: Record<string, number> = {
  open: 0.02, urban: 1.4, forest: 0.05, road: 0.01,
  water: -0.15, wall: 1.1, trench: -0.25, rubble: 0.25,
  sandbag: 0.45, mud: 0, crater: -0.3, hedgerow: 0.85,
  tall_grass: 0.15, gravel: 0.02,
};

interface SceneProps {
  gameStateRef: React.MutableRefObject<GameState>;
  inputRef: React.MutableRefObject<InputState>;
  onChange: () => void;
}

// ---- Terrain ----
function TerrainMesh({ terrain }: { terrain: TerrainCell[][] }) {
  // Per-cell colored box. Two big merged meshes would be ideal; for simplicity use instancedMesh per type.
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
      {/* base ground plane */}
      <mesh position={[W / 2, -0.5, H / 2]} receiveShadow>
        <boxGeometry args={[W, 1, H]} />
        <meshStandardMaterial color="#3a4a32" />
      </mesh>
      {Object.entries(groups).map(([type, g]) => (
        <InstancedTerrainGroup key={type} type={type} positions={g.positions} sizes={g.sizes} />
      ))}
      {/* trees on forest cells */}
      <TreeInstances terrain={terrain} />
    </group>
  );
}

function InstancedTerrainGroup({ type, positions, sizes }: { type: string; positions: [number, number, number][]; sizes: [number, number, number][] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = positions.length;
  useEffect(() => {
    if (!ref.current) return;
    const tmp = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const [px, py, pz] = positions[i];
      const [sx, sy, sz] = sizes[i];
      tmp.position.set(px, py, pz);
      tmp.scale.set(sx, sy, sz);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [positions, sizes, count]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow receiveShadow raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={TERRAIN_COLORS[type] ?? '#666'} flatShading roughness={0.85} />
    </instancedMesh>
  );
}

function TreeInstances({ terrain }: { terrain: TerrainCell[][] }) {
  const positions = useMemo(() => {
    const out: [number, number][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = terrain[y][x];
      if (c.type === 'forest' || c.type === 'hedgerow') {
        // a couple of trees per cell deterministically
        const seed = (x * 73 + y * 31) % 100;
        out.push([x + 0.25 + (seed % 5) * 0.1, y + 0.25 + ((seed * 7) % 5) * 0.1]);
        if (seed > 50) out.push([x + 0.75 - (seed % 4) * 0.08, y + 0.7 - ((seed * 3) % 4) * 0.08]);
      }
    }
    return out;
  }, [terrain]);

  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    const tmp = new THREE.Object3D();
    for (let i = 0; i < positions.length; i++) {
      tmp.position.set(positions[i][0], 1, positions[i][1]);
      const s = 0.8 + ((i * 13) % 5) * 0.1;
      tmp.scale.set(s, s, s);
      tmp.rotation.y = ((i * 17) % 360) * (Math.PI / 180);
      tmp.updateMatrix();
      ref.current.setMatrixAt(i, tmp.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [positions]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} castShadow raycast={() => null}>
      <coneGeometry args={[0.45, 1.6, 6]} />
      <meshStandardMaterial color="#2d4a25" flatShading />
    </instancedMesh>
  );
}

// ---- Unit Models ----
function InfantryModel({ team }: { team: 'player' | 'enemy' }) {
  const c = team === 'player' ? '#3b6db8' : '#b84a3b';
  return (
    <group scale={0.5}>
      <mesh position={[0, 0.6, 0]} castShadow><capsuleGeometry args={[0.18, 0.5, 4, 8]} /><meshStandardMaterial color={c} flatShading /></mesh>
      <mesh position={[0, 1.05, 0]} castShadow><sphereGeometry args={[0.2, 8, 6]} /><meshStandardMaterial color="#2a2a25" flatShading /></mesh>
      {/* rifle */}
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

// ---- Units (live updated) ----
function UnitsLayer({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  // Track refs per unit id; rebuild list when units change
  const groupRef = useRef<THREE.Group>(null);
  const unitRefs = useRef<Map<string, THREE.Group>>(new Map());
  const [, forceRender] = React.useReducer((n) => n + 1, 0);
  const knownIdsRef = useRef<string>('');

  useFrame(() => {
    const state = gameStateRef.current;
    const ids = state.units.filter(u => u.alive).map(u => u.id).join(',');
    if (ids !== knownIdsRef.current) {
      knownIdsRef.current = ids;
      forceRender();
      return;
    }
    for (const u of state.units) {
      if (!u.alive || u.insideOf) continue;
      const ref = unitRefs.current.get(u.id);
      if (!ref) continue;
      ref.position.x = u.pos.x / S;
      ref.position.z = u.pos.y / S;
      ref.rotation.y = -u.facing; // canvas-y maps to world-z; flip
      ref.visible = u.team === 'player' || u.spottedByEnemy || u.team === 'enemy' && u.spottedByEnemy;
      // visibility for enemies: only if spotted
      if (u.team === 'enemy') ref.visible = u.spottedByEnemy;
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
          {/* selection ring */}
          {u.selected && (
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <ringGeometry args={[0.55, 0.7, 24]} />
              <meshBasicMaterial color={u.team === 'player' ? '#7ec0ff' : '#ff7e7e'} transparent opacity={0.9} />
            </mesh>
          )}
          {/* digging ring */}
          {u.order === 'entrench' && (
            <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <ringGeometry args={[0.4, 0.48, 24, 1, 0, Math.min(Math.PI * 2, (u.digTimer / 6) * Math.PI * 2)]} />
              <meshBasicMaterial color="#d4c47a" transparent opacity={0.9} side={2} />
            </mesh>
          )}
          {/* health bar */}
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

// ---- Effects: projectiles + explosions ----
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
    // explosions
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

// ---- Capture point markers ----
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

// ---- Selected-unit path lines ----
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

// ---- Ground click handler ----
function Ground({ gameStateRef, inputRef, onChange }: SceneProps) {
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const wx = e.point.x * S;
    const wy = e.point.z * S;
    const state = gameStateRef.current;
    if (e.nativeEvent.button === 2) {
      handleRightClickWorld(wx, wy, state, e.nativeEvent.shiftKey, e.nativeEvent.ctrlKey || e.nativeEvent.metaKey);
      onChange();
    } else if (e.nativeEvent.button === 0) {
      dragStartRef.current = { x: wx, y: wy };
      inputRef.current.dragStart = { x: wx, y: wy };
      inputRef.current.isDragging = true;
      const hit = handleLeftClickWorld(wx, wy, state, e.nativeEvent.shiftKey);
      if (!hit) state.selectionBox = { start: { x: wx, y: wy }, end: { x: wx, y: wy } };
      onChange();
    }
  };
  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const wx = e.point.x * S, wy = e.point.z * S;
    const state = gameStateRef.current;
    inputRef.current.mouseWorldPos = { x: wx, y: wy };
    if (inputRef.current.isDragging && state.selectionBox) {
      state.selectionBox.end = { x: wx, y: wy };
    }
  };
  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    const state = gameStateRef.current;
    if (state.selectionBox && inputRef.current.isDragging) {
      const { start, end } = state.selectionBox;
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      if (dist > 15) handleBoxSelect(start.x, start.y, end.x, end.y, state, e.nativeEvent.shiftKey);
      state.selectionBox = null;
      onChange();
    }
    inputRef.current.isDragging = false;
    dragStartRef.current = null;
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

// ---- Selection box (rendered as a low rectangle on ground) ----
function SelectionBox({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const sb = gameStateRef.current.selectionBox;
    if (!ref.current) return;
    if (!sb) { ref.current.visible = false; return; }
    ref.current.visible = true;
    const minX = Math.min(sb.start.x, sb.end.x) / S;
    const maxX = Math.max(sb.start.x, sb.end.x) / S;
    const minY = Math.min(sb.start.y, sb.end.y) / S;
    const maxY = Math.max(sb.start.y, sb.end.y) / S;
    ref.current.position.set((minX + maxX) / 2, 0.06, (minY + maxY) / 2);
    ref.current.scale.set(Math.max(0.01, maxX - minX), 1, Math.max(0.01, maxY - minY));
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color="#7ec0ff" transparent opacity={0.2} />
    </mesh>
  );
}

// ---- Camera controller: WASD pan + scroll zoom ----
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

// ---- Scene root ----
const Scene3D: React.FC<SceneProps> = ({ gameStateRef, inputRef, onChange }) => {
  const terrain = gameStateRef.current.terrain;
  return (
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
      <CapturePoints gameStateRef={gameStateRef} />
      <UnitsLayer gameStateRef={gameStateRef} />
      <PathsLayer gameStateRef={gameStateRef} />
      <EffectsLayer gameStateRef={gameStateRef} />
      <SelectionBox gameStateRef={gameStateRef} />
      <Ground gameStateRef={gameStateRef} inputRef={inputRef} onChange={onChange} />
    </Canvas>
  );
};

export default Scene3D;
