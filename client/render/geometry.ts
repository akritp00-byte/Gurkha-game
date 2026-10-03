import { BufferAttribute, type BufferGeometry, Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const paintColor = new Color();

/**
 * Give a geometry one flat colour per triangle (the low-poly look). Converts it to
 * non-indexed so neighbouring faces don't blend, and drops UVs we never use.
 */
export function paint(geometry: BufferGeometry, color: number | Color): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute('uv');
  paintColor.set(color);
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([paintColor.r, paintColor.g, paintColor.b], i * 3);
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  return flat;
}

/** Merge painted parts into one geometry, so the whole object is a single draw call. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}
