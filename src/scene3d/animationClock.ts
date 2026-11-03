/**
 * Battlefield animation speed, set each frame by the scene from the game's
 * pause state and time scale: 0 while paused, so soldiers, turrets, rotors
 * and smoke freeze with the simulation instead of walking on the spot.
 */
const animationClock = { scale: 1 };
export function setAnimationTimeScale(scale: number) { animationClock.scale = Math.max(0, scale); }
/** A frame's animation step: capped, and scaled by the game clock. */
export const animStep = (dt: number) => Math.min(dt, .05) * animationClock.scale;
