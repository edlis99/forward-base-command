import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const project = (name: string) => resolve(process.cwd(), name);
const modelCode = readFileSync(project('src/scene3d/FactionModels.tsx'), 'utf8');
const rigCode = readFileSync(project('src/scene3d/soldierRig.ts'), 'utf8');

describe('licensed faction graphics are connected to the runtime', () => {
  it('uses the detailed licensed BAMEN soldier for Aster', () => {
    expect(modelCode).toContain("aster: { infantry: asset('aster-rifleman-detailed')");
    expect(existsSync(project('public/assets/factions/aster-rifleman-detailed.glb'))).toBe(true);
    // Its Mixamo skeleton is driven through the shared soldier rig tables.
    expect(rigCode).toContain('mixamorig:');
    expect(modelCode).toContain('SOLDIER_RIGS');
  });

  it('renders faction-specific tank, APC, helicopter and rifle details', () => {
    expect(modelCode).toContain("from './FactionEnhancements'");
    expect(modelCode).toContain('<TankDetails faction={faction} />');
    expect(modelCode).toContain('<CarrierDetails faction={faction} />');
    expect(modelCode).toContain('<HelicopterDetails faction={faction} />');
    expect(modelCode).toContain('<FactionWeapon faction={faction} />');
    expect(existsSync(project('public/assets/factions/scarl.glb'))).toBe(true);
    expect(existsSync(project('public/assets/factions/ak74.glb'))).toBe(true);
  });
});
