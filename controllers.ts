import { Controller, GameState, Team } from './types';

/** Default seating: the local player is human, the enemy side is the built-in AI. */
const DEFAULT_CONTROLLERS: Record<Team, Controller> = { player: 'human', enemy: 'ai' };

export function controllerOf(state: Pick<GameState, 'controllers'>, team: Team): Controller {
  return state.controllers?.[team] ?? DEFAULT_CONTROLLERS[team];
}
export const isHumanTeam = (state: Pick<GameState, 'controllers'>, team: Team) => controllerOf(state, team) === 'human';
export const defaultControllers = (): Record<Team, Controller> => ({ ...DEFAULT_CONTROLLERS });
