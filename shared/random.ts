/** A seeded random number generator returning floats in [0, 1). */
export type Random = () => number;

/** Fast seeded PRNG (mulberry32). The same seed gives the same sequence on every platform. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(random: Random, min: number, max: number): number {
  return min + (max - min) * random();
}
