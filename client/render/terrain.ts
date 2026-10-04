import {
  dangerZoneAt,
  distanceToRiver,
  fernPatchAt,
  hash2,
  type Heightfield,
  jungleAmount,
  lavaSurfaceHeight,
  RIVER,
  shoreDistance,
  smoothstep,
  TAR,
  TAR_PITS,
  tarPitAt,
  tarSurfaceHeight,
  TERRAIN,
  VOLCANO,
} from '@extinct/shared';
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
} from 'three';

const COLORS = {
  seabed: new Color(0xc9b47e),
  deepSeabed: new Color(0x8f8a6a),
  sand: new Color(0xead69a),
  mud: new Color(0x8b7a55),
  tarEdge: new Color(0x5e4d3b),
  plains: new Color(0xa9c95b),
  jungle: new Color(0x4b973d),
  fernFloor: new Color(0x3d8535),
  rock: new Color(0x7a665c),
  scorched: new Color(0x4a3c37),
  /** The danger zones: ashen slopes, and burnt ground round the tar pits. */
  ash: new Color(0x6e4038),
  burnt: new Color(0x5a4a33),
} as const;

const scratch = new Color();

/** Ground colour for one triangle, from what's at its centre. */
function groundColor(x: number, z: number, y: number, upness: number, out: Color): Color {
  if (y < -0.05) {
    return out.copy(COLORS.seabed).lerp(COLORS.deepSeabed, smoothstep(0, -5, y));
  }
  if (tarPitAt(x, z, 0.8)) return out.copy(COLORS.tarEdge);
  if (distanceToRiver(x, z) < RIVER.width / 2 + 1.2) return out.copy(COLORS.mud);
  if (shoreDistance(x, z) > -TERRAIN.beachWidth + 2 && y < TERRAIN.beachHeight + 0.5) {
    return out.copy(COLORS.sand);
  }

  out.copy(COLORS.plains).lerp(COLORS.jungle, jungleAmount(x, z));
  if (fernPatchAt(x, z)) out.lerp(COLORS.fernFloor, 0.6);

  const r = Math.hypot(x, z);
  const rockiness = Math.max(
    smoothstep(VOLCANO.baseRadius * 0.95, VOLCANO.baseRadius * 0.55, r),
    smoothstep(0.8, 0.6, upness), // steep slopes show bare rock
  );
  out.lerp(COLORS.rock, rockiness);
  out.lerp(COLORS.scorched, smoothstep(VOLCANO.craterRadius * 2, VOLCANO.craterRadius, r));
  const zone = dangerZoneAt(x, z);
  if (zone === 'ashlands') out.lerp(COLORS.ash, 0.4);
  else if (zone === 'tarPits') out.lerp(COLORS.burnt, 0.5);
  return out;
}

/**
 * Low-poly terrain mesh: one flat-coloured triangle pair per heightfield cell, split along the
 * same diagonal that `heightAt` interpolates across.
 */
export function createTerrain(field: Heightfield): Mesh {
  const { cells, cellSize, origin, heights } = field;
  const stride = cells + 1;
  const positions = new Float32Array(cells * cells * 18);
  const colors = new Float32Array(cells * cells * 18);
  let offset = 0;

  const addTriangle = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    jitter: number,
  ): void => {
    // Upward share of the face normal: 1 on flat ground, lower on slopes.
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const upness = Math.abs(ny) / Math.hypot(nx, ny, nz);
    groundColor((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, upness, scratch);
    scratch.multiplyScalar(jitter);
    positions.set([ax, ay, az, bx, by, bz, cx, cy, cz], offset);
    for (let v = 0; v < 3; v++) colors.set([scratch.r, scratch.g, scratch.b], offset + v * 3);
    offset += 9;
  };

  for (let row = 0; row < cells; row++) {
    const z0 = origin + row * cellSize;
    const z1 = z0 + cellSize;
    for (let column = 0; column < cells; column++) {
      const x0 = origin + column * cellSize;
      const x1 = x0 + cellSize;
      const i = row * stride + column;
      const h00 = heights[i];
      const h10 = heights[i + 1];
      const h01 = heights[i + stride];
      const h11 = heights[i + stride + 1];
      // Slight per-face brightness variation gives the faceted, hand-made look.
      addTriangle(x0, h00, z0, x1, h11, z1, x1, h10, z0, 0.95 + 0.1 * hash2(column, row, 1));
      addTriangle(x0, h00, z0, x0, h01, z1, x1, h11, z1, 0.95 + 0.1 * hash2(column, row, 2));
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const terrain = new Mesh(
    geometry,
    new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  return terrain;
}

/** Sea and river surface: one big translucent plane at sea level. */
export function createWater(): Mesh {
  const geometry = new CircleGeometry(1500, 64);
  geometry.rotateX(-Math.PI / 2);
  const water = new Mesh(
    geometry,
    new MeshPhongMaterial({
      color: 0x2aa6d9,
      specular: 0xbfe9ff,
      shininess: 60,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
    }),
  );
  water.name = 'water';
  return water;
}

/** The lava pool in the crater and the tar in every pit. */
export function createPools(): Group {
  const pools = new Group();

  const lava = new Mesh(
    new CircleGeometry(VOLCANO.craterRadius * 0.7, 10),
    new MeshBasicMaterial({ color: 0xff6a24 }),
  );
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = lavaSurfaceHeight();
  lava.name = 'lava';

  const disc = new CircleGeometry(1, 18);
  disc.rotateX(-Math.PI / 2);
  const tar = new InstancedMesh(
    disc,
    new MeshPhongMaterial({ color: 0x2a211b, specular: 0x8a7f72, shininess: 120 }),
    TAR_PITS.length,
  );
  const matrix = new Matrix4();
  TAR_PITS.forEach((pit, index) => {
    const radius = pit.radius + TAR.rimWidth * 0.35;
    matrix.makeScale(radius, 1, radius).setPosition(pit.x, tarSurfaceHeight(index), pit.z);
    tar.setMatrixAt(index, matrix);
  });
  tar.receiveShadow = true;
  tar.name = 'tar';

  pools.add(lava, tar);
  return pools;
}

/** Keep the lava glowing: a slow pulse between two oranges. */
export function animateLava(pools: Group, time: number): void {
  const lava = pools.getObjectByName('lava');
  if (lava instanceof Mesh && lava.material instanceof MeshBasicMaterial) {
    lava.material.color
      .setHex(0xff6a24)
      .lerp(scratch.setHex(0xffb03a), 0.5 + 0.5 * Math.sin(time * 1.7));
  }
}
