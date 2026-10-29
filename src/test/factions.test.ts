import { describe, expect, it } from 'vitest';
import { FACTION_IDS, FACTIONS, factionFor } from '../game/factions';
import { createInitialState, createInputState, update, spawnReinforcement } from '../game/engine';
import { makeLeipalingisRaas } from '../game/maps/raasLeipalingis';
import { stateDigest } from '../game/match';

describe('fictional faction selection', () => {
  it.each(FACTION_IDS)('assigns %s to the player and the other faction to the opponent', id => {
    const state = createInitialState(makeLeipalingisRaas(7), undefined, { seed: 7, playerFaction: id });
    expect(factionFor(state, 'player').id).toBe(id);
    expect(factionFor(state, 'enemy').id).not.toBe(id);
    expect(FACTIONS[state.factions.enemy]).toBeDefined();
    expect(Object.keys(FACTIONS[id].units)).toEqual(['infantry', 'tank', 'apc', 'helicopter']);
  });

  it('keeps identical seeded combat outcomes and starting forces when factions are swapped', () => {
    const run = (playerFaction: 'aster' | 'vostran') => {
      const state = createInitialState(makeLeipalingisRaas(7), undefined, { seed: 7, playerFaction });
      const stats = state.units.map(u => [u.team, u.type, u.maxHealth, u.damage, u.armor, u.speed]);
      for (let i = 0; i < 30; i++) update(state, createInputState(), 0.05);
      return { stats, digest: stateDigest(state), tickets: state.raas!.tickets };
    };
    expect(run('aster')).toEqual(run('vostran'));
  });

  it('preserves faction identity when reinforcements are requested', () => {
    const state = createInitialState(makeLeipalingisRaas(7), undefined, { seed: 7, playerFaction: 'vostran' });
    const before = { ...state.factions };
    state.reinforcementBudget = 100;
    const count = state.units.length;
    expect(spawnReinforcement('infantry', state)).toBe(true);
    expect(state.units).toHaveLength(count + 1);
    expect(state.units[state.units.length - 1].team).toBe('player');
    expect(state.factions).toEqual(before);
    expect(factionFor(state, 'player').units.infantry).toBe('Motor Rifle');
    expect(factionFor(state, 'enemy').units.infantry).toBe('Ranger');
  });
});
