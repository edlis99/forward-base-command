import { GameState } from './types';

/**
 * Deterministic game randomness (mulberry32). All gameplay rolls go through
 * `random(state)` so a match is a pure function of its seed and its command
 * log: the basis for replays, server authority and reproducible balance tests.
 * `state.random` is an optional override hook for tests.
 */
export function random(state: Pick<GameState, 'rngState' | 'random'>): number {
  if (state.random) return state.random();
  let t = ((state.rngState ?? 1) + 0x6D2B79F5) | 0;
  state.rngState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Fisher-Yates shuffle driven by the game RNG. */
export function shuffled<T>(items: readonly T[], state: Pick<GameState, 'rngState' | 'random'>): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
