import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { GameState, TerrainCell } from '../game/types';
import { MAP_COLS, MAP_ROWS, CELL_SIZE } from '../game/constants';
import { SETTLEMENTS } from '../game/maps/settlements';
import { groundHeightAt, hash2 } from './terrainHeight';
import { ambienceUniforms } from './ambienceUniforms';

/**
 * The "living map": chimney smoke, birds over the countryside, and ambient
 * sound. Each piece is independent; remove its tag in Scene3D to switch it off.
 */

/** Advances the shared clock used by wind, clouds and smoke. */
export function AmbienceClock() {
  useFrame((_, dt) => { ambienceUniforms.uTime.value += Math.min(dt, .1); });
  return null;
}

// ---------------- chimney smoke ----------------
const PUFFS = 7;
export function ChimneySmoke({ terrain }: { terrain: TerrainCell[][] }) {
  const { size } = useThree();
  const geometry = useMemo(() => {
    const pos: number[] = [], phase: number[] = [], seed: number[] = [];
    let emitters = 0;
    for (let z = 0; z < MAP_ROWS && emitters < 420; z++) for (let x = 0; x < MAP_COLS && emitters < 420; x++) {
      const c = terrain[z][x];
      if (c.type !== 'urban' || !c.settlementId || !(c.buildingKind === 'house' || c.buildingKind === 'brick')) continue;
      if (hash2(x + 61, z + 17) > .2) continue; // one house in five has the stove lit
      const off = c.buildingOffset ?? [0, 0], a = c.propAngle ?? 0;
      // chimney sits at local (-.18, roof, -.24): rotate into the world like the house
      const cx = x + .5 + off[0] + Math.cos(a) * -.18 - Math.sin(a) * -.24;
      const cz = z + .5 + off[1] + Math.sin(a) * -.18 + Math.cos(a) * -.24;
      const y = groundHeightAt(terrain, cx, cz) + .78;
      for (let k = 0; k < PUFFS; k++) { pos.push(cx, y, cz); phase.push(k / PUFFS + hash2(x, z) * .5); seed.push(hash2(x + k, z + 3)); }
      emitters++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    return g;
  }, [terrain]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: ambienceUniforms.uTime, uScale: { value: 600 } },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute float aPhase; attribute float aSeed;
      uniform float uTime; uniform float uScale;
      varying float vAlpha;
      void main() {
        float t = fract(uTime * 0.06 + aPhase);
        vec3 p = position + vec3((t * 1.4 + sin(uTime * 0.3 + aSeed * 6.28) * 0.12), t * 2.4, t * 0.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.22 + t * 1.0) * uScale / max(1.0, -mv.z);
        vAlpha = (1.0 - t) * smoothstep(0.0, 0.1, t) * 0.3;
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c);
        if (d > 0.25) discard;
        gl_FragColor = vec4(0.8, 0.8, 0.78, vAlpha * (1.0 - d * 4.0));
      }`,
  }), []);
  useEffect(() => { material.uniforms.uScale.value = size.height * .9; }, [material, size.height]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

// ---------------- birds ----------------
interface Flock { x: number; z: number; r: number; h: number; speed: number; scare: number }
const BIRDS_PER = 9;
export function Birds({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const flocks = useMemo<Flock[]>(() => SETTLEMENTS.slice(0, 12).map((s, i) => ({
    x: s.x + (hash2(i, 3) - .5) * 40, z: s.y + (hash2(i, 7) - .5) * 30,
    r: 5 + hash2(i, 11) * 7, h: 9 + hash2(i, 13) * 5, speed: .25 + hash2(i, 17) * .2, scare: 0,
  })), []);
  const geometry = useMemo(() => {
    // a small dark "v": two wing triangles
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -.5, .12, -.1, 0, 0, -.18, 0, 0, 0, .5, .12, -.1, 0, 0, -.18], 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#262624', side: THREE.DoubleSide }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    const mesh = ref.current, state = gameStateRef.current;
    if (!mesh) return;
    const t = ambienceUniforms.uTime.value;
    flocks.forEach((f, fi) => {
      // gunfire nearby startles the flock: higher, wider, faster for a while
      for (const p of state.projectiles) if (Math.hypot(p.from.x / CELL_SIZE - f.x, p.from.y / CELL_SIZE - f.z) < 30) f.scare = 1;
      for (const e of state.explosions) if (Math.hypot(e.pos.x / CELL_SIZE - f.x, e.pos.y / CELL_SIZE - f.z) < 40) f.scare = 1;
      f.scare = Math.max(0, f.scare - dt * .08);
      for (let b = 0; b < BIRDS_PER; b++) {
        const i = fi * BIRDS_PER + b;
        const a = t * f.speed * (1 + f.scare * 1.8) + b * .5 + fi;
        const r = f.r * (1 + f.scare * .8) + Math.sin(b * 1.7) * 1.2;
        const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r;
        const y = f.h + f.scare * 6 + Math.sin(t * .7 + b) * .6;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, -a, 0);
        const flap = .55 + .45 * Math.abs(Math.sin(t * (6 + f.scare * 6) + b));
        dummy.scale.set(.9, flap, .9);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geometry, material, flocks.length * BIRDS_PER]} frustumCulled={false} raycast={() => null} />;
}

// ---------------- sound ----------------
/**
 * Wind is generated live (no files). Gunfire is synthesised from noise and
 * fades with distance from the camera. Optional recordings are used when
 * present: public/assets/sound/birds.mp3, dogs.mp3 (played now and then,
 * quietly). Starts on the first click or key press (browser rule). M mutes.
 */
export function AmbientSound({ gameStateRef }: { gameStateRef: React.MutableRefObject<GameState> }) {
  const { camera } = useThree();
  const audio = useRef<{ ctx: AudioContext; master: GainNode; wind: GainNode; noise: AudioBuffer; samples: Record<string, AudioBuffer> } | null>(null);
  const seen = useRef(new WeakSet<object>());
  const nextSample = useRef(15);
  const lastShots = useRef<number[]>([]);
  useEffect(() => {
    let muted = false;
    const start = async () => {
      if (audio.current) { await audio.current.ctx.resume(); return; }
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const master = ctx.createGain(); master.gain.value = muted ? 0 : .8; master.connect(ctx.destination);
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // wind: looping noise through a low band-pass, with slow gusts
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 420; band.Q.value = .6;
      const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 900;
      const wind = ctx.createGain(); wind.gain.value = .05;
      src.connect(band); band.connect(low); low.connect(wind); wind.connect(master); src.start();
      const samples: Record<string, AudioBuffer> = {};
      for (const name of ['birds', 'dogs']) {
        fetch(`${import.meta.env.BASE_URL}assets/sound/${name}.mp3`).then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
          .then(b => ctx.decodeAudioData(b)).then(buf => { samples[name] = buf; }).catch(() => { /* optional file */ });
      }
      audio.current = { ctx, master, wind, noise, samples };
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'm' && audio.current) { muted = !muted; audio.current.master.gain.value = muted ? 0 : .8; }
      start();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', onKey); audio.current?.ctx.close(); audio.current = null; };
  }, []);
  useFrame(() => {
    const a = audio.current;
    if (!a || a.ctx.state !== 'running') return;
    const now = a.ctx.currentTime, state = gameStateRef.current;
    // gusts: wander the wind level, louder when the camera is high
    const height = Math.min(1, camera.position.y / 200);
    a.wind.gain.setTargetAtTime(.03 + .05 * height + .03 * (Math.sin(now * .23) * .5 + .5) * (Math.sin(now * .07) * .5 + .5), now, .8);
    // gunfire
    const camX = camera.position.x, camZ = camera.position.z - camera.position.y * .55 / .85;
    lastShots.current = lastShots.current.filter(t => now - t < 1);
    for (const p of state.projectiles) {
      if (seen.current.has(p)) continue;
      seen.current.add(p);
      if (lastShots.current.length > 14) continue;
      const d = Math.hypot(p.from.x / CELL_SIZE - camX, p.from.y / CELL_SIZE - camZ);
      const vol = .5 / (1 + d * d / 900);
      if (vol < .01) continue;
      lastShots.current.push(now);
      const s = a.ctx.createBufferSource(); s.buffer = a.noise; s.playbackRate.value = .8 + Math.random() * .4;
      const f = a.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = d > 40 ? 500 : 1400; f.Q.value = .9;
      const g = a.ctx.createGain();
      const when = now + Math.min(.4, d / 340); // sound arrives a little after the flash
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + .004); g.gain.exponentialRampToValueAtTime(.0005, when + .22 + d / 300);
      s.connect(f); f.connect(g); g.connect(a.master); s.start(when, Math.random()); s.stop(when + .6);
    }
    // occasional birdsong or dogs, if those files exist
    if (now > nextSample.current) {
      nextSample.current = now + 20 + Math.random() * 40;
      const names = Object.keys(a.samples);
      if (names.length) {
        const s = a.ctx.createBufferSource(); s.buffer = a.samples[names[Math.floor(Math.random() * names.length)]];
        const g = a.ctx.createGain(); g.gain.value = .18; s.connect(g); g.connect(a.master); s.start();
      }
    }
  });
  return null;
}
