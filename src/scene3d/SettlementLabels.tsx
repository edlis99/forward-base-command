import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { SETTLEMENTS } from '../game/maps/settlements';
import { surfaceY } from './terrainHeight';

export function SettlementLabelPositions({ elements }: { elements: React.MutableRefObject<Map<string, HTMLDivElement>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const town of SETTLEMENTS) {
      const el = elements.current.get(town.id); if (!el) continue;
      v.set(town.x, surfaceY(town.x, town.y - town.ry) + .5, town.y - town.ry - .5).project(camera);
      const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < .93 && Math.abs(v.y) < .8;
      el.style.display = visible ? 'block' : 'none';
      el.style.transform = `translate(${(v.x * .5 + .5) * size.width}px, ${(-v.y * .5 + .5) * size.height}px) translate(-50%, -100%)`;
    }
  });
  return null;
}
