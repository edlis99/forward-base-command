import source from './leipalingis-osm.json';
import { MAP_COLS, MAP_ROWS } from '../constants';

// The stored OSM projection is independent of the gameplay grid. Reproject
// every feature together, retaining the same geographic bounds and provenance.
export const GEOGRAPHIC_SCALE_X = MAP_COLS / source.grid[0];
export const GEOGRAPHIC_SCALE_Y = MAP_ROWS / source.grid[1];
export const GEOGRAPHIC_SCALE = Math.min(GEOGRAPHIC_SCALE_X, GEOGRAPHIC_SCALE_Y);
export const projectSourcePoint = (p: number[]): number[] => [p[0] * GEOGRAPHIC_SCALE_X, p[1] * GEOGRAPHIC_SCALE_Y];
export const geography = {
  ...source,
  roads: source.roads.map(r => ({ ...r, points: r.points.map(projectSourcePoint) })),
  areas: source.areas.map(a => ({ ...a, points: a.points.map(projectSourcePoint),
    holes: ('holes' in a ? a.holes : []).map(r => r.map(projectSourcePoint)) })),
  buildings: source.buildings.map(([x, y, angle]) => [...projectSourcePoint([x, y]), angle]),
  places: source.places.map(p => ({ ...p, point: projectSourcePoint(p.point) })),
};
