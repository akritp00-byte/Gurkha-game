export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Hermite ease between two edges. Reversed edges (edge0 > edge1) give a falling ramp. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wrap an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  const wrapped = angle - TAU * Math.floor((angle + Math.PI) / TAU);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Shortest signed rotation from one angle to another. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Interpolate between two angles along the shortest arc. */
export function lerpAngle(from: number, to: number, t: number): number {
  return wrapAngle(from + angleDelta(from, to) * t);
}

/** Frame-rate independent smoothing factor for `value += (target - value) * factor`. */
export function dampFactor(sharpness: number, dt: number): number {
  return 1 - Math.exp(-sharpness * dt);
}
