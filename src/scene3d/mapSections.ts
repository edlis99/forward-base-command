import { MAP_COLS, MAP_ROWS } from '../game/constants';

export interface MapSection { id: string; x: number; y: number; width: number; height: number; }
export const SECTION_SIZE = 32;
export function mapSections(width = MAP_COLS, height = MAP_ROWS): MapSection[] {
  const sections: MapSection[] = [];
  for (let y = 0; y < height; y += SECTION_SIZE) for (let x = 0; x < width; x += SECTION_SIZE) {
    sections.push({ id: `${x}:${y}`, x, y, width: Math.min(SECTION_SIZE, width - x), height: Math.min(SECTION_SIZE, height - y) });
  }
  return sections;
}
export const MAP_SECTIONS = mapSections();
