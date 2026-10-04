import { BufferAttribute, BufferGeometry, Color, Uint16BufferAttribute, Vector3 } from 'three';

/**
 * Lofting: low-poly organic shapes built from rings of vertices along a path, like a sculptor's
 * armature. Dinosaur bodies, tails, necks, legs and the big event carcasses are all lofted, so
 * they read as one smooth creature instead of a stack of boxes, while staying flat-shaded and
 * cheap.
 */

/** Skinning for a vertex: two bones and the weight of the second. */
export type Skin = readonly [boneA: number, boneB: number, weightB: number];

export interface Station {
  /** Centre of this ring. */
  readonly at: Vector3;
  /** Half-width (sideways) and half-height of the ring. */
  readonly width: number;
  readonly height: number;
  readonly skin?: Skin;
}

/** Where on the surface a face is: `along` 0 at the first ring to 1 at the last, `around` in radians (π/2 on top, −π/2 underneath, 0 and π the sides). */
export interface SurfacePoint {
  readonly along: number;
  readonly around: number;
  /** Which side of the body (+1 left, −1 right), from the face's position. */
  readonly side: number;
}

export type Paint = (point: SurfacePoint) => number;

export interface LoftOptions {
  /** Vertices per ring. */
  readonly sides: number;
  readonly paint: Paint;
  /** Close the open ends with a fan (on by default). */
  readonly capStart?: boolean;
  readonly capEnd?: boolean;
  /**
   * The ring's sideways direction (default +x). Rings are built from it and the path's
   * direction, so a path must never run parallel to it.
   */
  readonly side?: Vector3;
}

const tangent = new Vector3();
const up = new Vector3();
const sideways = new Vector3();
const color = new Color();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();

/** Builder for one flat-shaded, vertex-coloured, optionally skinned geometry. */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly skinIndex: number[] = [];
  private readonly skinWeight: number[] = [];

  /** Add one triangle in one colour, each corner with its own skin. */
  triangle(p: Vector3, q: Vector3, r: Vector3, hex: number, skins?: readonly Skin[]): void {
    color.set(hex);
    for (const [index, corner] of [p, q, r].entries()) {
      this.positions.push(corner.x, corner.y, corner.z);
      this.colors.push(color.r, color.g, color.b);
      const skin = skins?.[index] ?? [0, 0, 0];
      this.skinIndex.push(skin[0], skin[1], 0, 0);
      this.skinWeight.push(1 - skin[2], skin[2], 0, 0);
    }
  }

  /** A loft through the stations: rings joined into a tube, capped at the ends. */
  loft(stations: readonly Station[], options: LoftOptions): void {
    const { sides, paint } = options;
    const rings: Vector3[][] = [];
    stations.forEach((station, index) => {
      const previous = stations[Math.max(index - 1, 0)].at;
      const next = stations[Math.min(index + 1, stations.length - 1)].at;
      tangent.subVectors(next, previous).normalize();
      sideways.copy(options.side ?? X_AXIS);
      up.crossVectors(tangent, sideways).normalize();
      sideways.crossVectors(up, tangent).normalize();
      const ring: Vector3[] = [];
      for (let k = 0; k < sides; k++) {
        const angle = (k / sides) * Math.PI * 2;
        ring.push(
          station.at
            .clone()
            .addScaledVector(sideways, Math.cos(angle) * station.width)
            .addScaledVector(up, Math.sin(angle) * station.height),
        );
      }
      rings.push(ring);
    });

    const skinOf = (index: number): Skin => stations[index].skin ?? [0, 0, 0];
    const last = stations.length - 1;
    for (let i = 0; i < last; i++) {
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        const around = ((k + 0.5) / sides) * Math.PI * 2;
        const hex = paint({
          along: (i + 0.5) / last,
          around: around > Math.PI ? around - Math.PI * 2 : around,
          side: Math.cos(around) >= 0 ? 1 : -1,
        });
        const s0 = skinOf(i);
        const s1 = skinOf(i + 1);
        this.triangle(rings[i][k], rings[i + 1][k2], rings[i + 1][k], hex, [s0, s1, s1]);
        this.triangle(rings[i][k], rings[i][k2], rings[i + 1][k2], hex, [s0, s0, s1]);
      }
    }
    if (options.capStart ?? true) this.cap(rings[0], stations[0], skinOf(0), paint, 0, true);
    if (options.capEnd ?? true)
      this.cap(rings[last], stations[last], skinOf(last), paint, 1, false);
  }

  private cap(
    ring: readonly Vector3[],
    station: Station,
    skin: Skin,
    paint: Paint,
    along: number,
    flip: boolean,
  ): void {
    const centre = station.at;
    const sides = ring.length;
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      const around = ((k + 0.5) / sides) * Math.PI * 2;
      const hex = paint({
        along,
        around: around > Math.PI ? around - Math.PI * 2 : around,
        side: Math.cos(around) >= 0 ? 1 : -1,
      });
      if (flip) this.triangle(centre, ring[k2], ring[k], hex, [skin, skin, skin]);
      else this.triangle(centre, ring[k], ring[k2], hex, [skin, skin, skin]);
    }
  }

  /** A pointed cone (horn, tooth, claw, spike) from `base` to `tip`, as one fan of faces. */
  spike(
    base: Vector3,
    tip: Vector3,
    radius: number,
    hex: number,
    skin: Skin = [0, 0, 0],
    sides = 4,
  ): void {
    tangent.subVectors(tip, base).normalize();
    sideways.set(1, 0, 0);
    if (Math.abs(tangent.dot(sideways)) > 0.9) sideways.set(0, 0, 1);
    up.crossVectors(tangent, sideways).normalize();
    sideways.crossVectors(up, tangent).normalize();
    const ring: Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const angle = (k / sides) * Math.PI * 2;
      ring.push(
        base
          .clone()
          .addScaledVector(sideways, Math.cos(angle) * radius)
          .addScaledVector(up, Math.sin(angle) * radius),
      );
    }
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      this.triangle(ring[k], ring[k2], tip, hex, [skin, skin, skin]);
      this.triangle(ring[k], base, ring[k2], hex, [skin, skin, skin]);
    }
  }

  /** A flat, two-sided plate (crest, feather, fin) through the given outline points. */
  plate(outline: readonly Vector3[], hex: number, skin: Skin = [0, 0, 0]): void {
    const centre = outline
      .reduce((sum, p) => sum.add(p), new Vector3())
      .divideScalar(outline.length);
    for (let k = 0; k < outline.length; k++) {
      const p = outline[k];
      const q = outline[(k + 1) % outline.length];
      this.triangle(centre, p, q, hex, [skin, skin, skin]);
      this.triangle(centre, q, p, hex, [skin, skin, skin]);
    }
  }

  /** A flat, two-sided four-cornered panel: two triangles a side. */
  quad(p: Vector3, q: Vector3, r: Vector3, s: Vector3, hex: number, skin: Skin = [0, 0, 0]): void {
    const skins = [skin, skin, skin] as const;
    this.triangle(p, q, r, hex, skins);
    this.triangle(p, r, s, hex, skins);
    this.triangle(p, r, q, hex, skins);
    this.triangle(p, s, r, hex, skins);
  }

  /** A small faceted ball (eye, knuckle, bone end). */
  ball(centre: Vector3, radius: number, hex: number, skin: Skin = [0, 0, 0]): void {
    // An octahedron: six points, eight faces.
    const points = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].map(([x, y, z]) => new Vector3(x, y, z).multiplyScalar(radius).add(centre));
    const faces = [
      [0, 2, 4],
      [2, 1, 4],
      [1, 3, 4],
      [3, 0, 4],
      [2, 0, 5],
      [1, 2, 5],
      [3, 1, 5],
      [0, 3, 5],
    ];
    for (const [i, j, k] of faces) {
      this.triangle(points[i], points[j], points[k], hex, [skin, skin, skin]);
    }
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** The finished geometry. Skinning attributes are only added if asked for. */
  build(skinned: boolean): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    if (skinned) {
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinIndex, 4));
      geometry.setAttribute(
        'skinWeight',
        new BufferAttribute(new Float32Array(this.skinWeight), 4),
      );
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const X_AXIS = new Vector3(1, 0, 0);

/** Points on a straight line from `from` to `to`, at fractions `t`. */
export function along(from: Vector3, to: Vector3, t: number): Vector3 {
  return a.copy(from).lerp(to, t).clone();
}

/** A point on a quadratic curve through `from`, bending towards `control`, ending at `to`. */
export function curve(from: Vector3, control: Vector3, to: Vector3, t: number): Vector3 {
  b.copy(from).lerp(control, t);
  c.copy(control).lerp(to, t);
  return b.lerp(c, t).clone();
}
