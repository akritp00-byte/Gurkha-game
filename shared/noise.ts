import { lerp } from './math.ts';

/** Deterministic hash of an integer grid point to [0, 1). */
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
export function valueNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const top = lerp(hash2(ix, iz, seed), hash2(ix + 1, iz, seed), sx);
  const bottom = lerp(hash2(ix, iz + 1, seed), hash2(ix + 1, iz + 1, seed), sx);
  return lerp(top, bottom, sz) * 2 - 1;
}

/** Fractal (layered) value noise in [-1, 1]. Each octave doubles the frequency and halves the amplitude. */
export function fbm(x: number, z: number, octaves = 3, seed = 0): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * valueNoise(x * frequency, z * frequency, seed + octave * 101);
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}
