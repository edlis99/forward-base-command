import { Unit, Position, FormationType } from './types';

export function pickFormation(units: Unit[]): FormationType {
  const hasArmor = units.some(u => u.type === 'tank' || u.type === 'apc');
  if (hasArmor) return 'wedge';
  return 'line';
}

/**
 * Compute formation slot positions for the given units, anchored at `anchor`,
 * oriented along `facing` (radians, world-space angle).
 * Returns an array of {unitId, pos} aligned to input order.
 */
export function computeFormation(
  units: Unit[],
  anchor: Position,
  facing: number,
  type: FormationType,
  spacing = 36,
): { id: string; pos: Position }[] {
  const fwd = { x: Math.cos(facing), y: Math.sin(facing) };
  const right = { x: -fwd.y, y: fwd.x };
  const ground = units.filter(u => u.type !== 'helicopter');
  const heli = units.filter(u => u.type === 'helicopter');

  // Sort vehicles to anchor positions
  const sorted = [...ground].sort((a, b) => {
    const score = (u: Unit) => (u.type === 'tank' ? 0 : u.type === 'apc' ? 1 : 2);
    return score(a) - score(b);
  });

  const slotPositions: Position[] = [];
  const out: { id: string; pos: Position }[] = [];
  const N = sorted.length;

  if (type === 'line') {
    for (let i = 0; i < N; i++) {
      const lateral = (i - (N - 1) / 2) * spacing;
      out.push({
        id: sorted[i].id,
        pos: { x: anchor.x + right.x * lateral, y: anchor.y + right.y * lateral },
      });
    }
  } else if (type === 'column') {
    for (let i = 0; i < N; i++) {
      const back = -i * spacing * 1.4;
      out.push({
        id: sorted[i].id,
        pos: { x: anchor.x + fwd.x * back, y: anchor.y + fwd.y * back },
      });
    }
  } else { // wedge
    for (let i = 0; i < N; i++) {
      const row = Math.floor((i + 1) / 2);
      const side = i % 2 === 0 ? -1 : 1;
      const lateral = row * spacing * side;
      const back = -row * spacing * 0.8;
      out.push({
        id: sorted[i].id,
        pos: {
          x: anchor.x + fwd.x * back + right.x * lateral,
          y: anchor.y + fwd.y * back + right.y * lateral,
        },
      });
    }
  }

  // Helicopters: stagger above anchor
  heli.forEach((u, i) => {
    const lateral = (i + 1) * spacing * 0.7 * (i % 2 === 0 ? 1 : -1);
    out.push({ id: u.id, pos: { x: anchor.x + right.x * lateral, y: anchor.y + right.y * lateral } });
  });

  return out;
}
