import { describe, expect, it } from 'vitest';
import { FERNS } from './config.ts';
import { canSee, isHiddenInFerns } from './visibility.ts';
import { FERN_PATCHES } from './world/layout.ts';

const patch = FERN_PATCHES[0];

describe('fern hiding', () => {
  it('hides tier 1–2 dinosaurs standing in a fern patch', () => {
    expect(FERNS.maxHiddenTier).toBe(2);
    expect(isHiddenInFerns({ x: patch.x, z: patch.z, mass: 10 })).toBe(true);
    expect(isHiddenInFerns({ x: patch.x, z: patch.z, mass: 149 })).toBe(true);
    expect(isHiddenInFerns({ x: patch.x, z: patch.z, mass: 150 })).toBe(false); // tier 3
    expect(isHiddenInFerns({ x: patch.x + patch.radius + 1, z: patch.z, mass: 10 })).toBe(false);
  });

  it('only shows a hidden dinosaur to observers within 10 units', () => {
    expect(FERNS.revealDistance).toBe(10);
    const hidden = { x: patch.x, z: patch.z, mass: 10 };
    expect(canSee({ x: patch.x + 9.9, z: patch.z }, hidden)).toBe(true);
    expect(canSee({ x: patch.x + 10.1, z: patch.z }, hidden)).toBe(false);
  });

  it('always shows dinosaurs out in the open, and big ones everywhere', () => {
    expect(canSee({ x: 140, z: 0 }, { x: 60, z: 0, mass: 10 })).toBe(true);
    expect(canSee({ x: 140, z: 0 }, { x: patch.x, z: patch.z, mass: 500 })).toBe(true);
  });
});
