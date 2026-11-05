/**
 * The ground the camera shows, in map cells: the four corners of the visible
 * view (between the top bar and the bottom panel), clockwise from the top
 * left. Written by the camera rig every frame, drawn by the minimap.
 */
export const cameraView: { corners: { x: number; z: number }[] } = { corners: [] };
