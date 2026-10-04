import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualitySettings } from './quality.ts';

const SKY_ZENITH = new Color(0x3a8fdc);
/** A warm, humid haze on the horizon: the fog fades into it. */
const SKY_HORIZON = new Color(0xd8ecd8);
/** The apocalyptic sky of the meteor's last minute (BUILD_PROMPT.md §6). */
const DOOM_ZENITH = new Color(0x4a0d0b);
const DOOM_HORIZON = new Color(0xff7040);
const DOOM_SUN = new Color(0xff8a50);
const DAY_SUN = new Color(0xffe6c0);
const DAY_AMBIENT = 1.25;
const DOOM_AMBIENT = 0.8;
const WHITE = new Color(0xffffff);
const SUN_GLOW = new Color(0xfff2d0);
const DOOM_SUN_GLOW = new Color(0xff5a20);

/** Unit vector from the ground towards the sun (the sky's glow and the shadows agree). */
export const TO_SUN = new Vector3(-0.45, 0.85, 0.35).normalize();

/**
 * Gradient sky dome that follows the camera, with a soft sun and its glow. Its horizon colour
 * is also the fog colour.
 */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      zenithColor: { value: SKY_ZENITH.clone() },
      horizonColor: { value: SKY_HORIZON.clone() },
      sunColor: { value: SUN_GLOW.clone() },
      toSun: { value: TO_SUN },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenithColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 toSun;
      varying vec3 vDirection;
      void main() {
        vec3 direction = normalize(vDirection);
        float t = pow(clamp(direction.y, 0.0, 1.0), 0.55);
        vec3 color = mix(horizonColor, zenithColor, t);
        float facing = max(dot(direction, toSun), 0.0);
        color += sunColor * (pow(facing, 12.0) * 0.35 + pow(facing, 600.0) * 1.6);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new Mesh(new SphereGeometry(500, 32, 16), material);
  // Draw after the other opaque objects so it only fills pixels nothing else covered.
  sky.renderOrder = 10;
  sky.frustumCulled = false;
  return sky;
}

export function createFog(): Fog {
  return new Fog(SKY_HORIZON.clone(), 40, 140);
}

/** Soft sky/ground fill light: cool from above, warm earth bouncing from below. */
export function createAmbientLight(): HemisphereLight {
  return new HemisphereLight(0xd4ecff, 0x6b5a34, DAY_AMBIENT);
}

/** Slow drifting clouds: puffy low-poly heaps high over the island, one draw call. */
export class Clouds {
  readonly mesh: InstancedMesh;
  private readonly spots: { x: number; z: number; y: number; scale: number; turn: number }[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly size = new Vector3();

  constructor(count = 22) {
    const puff = (r: number, x: number, y: number, z: number) =>
      new IcosahedronGeometry(r, 0).scale(1, 0.6, 1).translate(x, y, z);
    const parts = [
      puff(10, 0, 0, 0),
      puff(8, 9, -1, 2),
      puff(7, -9, -1.5, -1),
      puff(6, 3, 3, -4),
      puff(5, -4, 2.5, 4),
    ];
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    this.mesh = new InstancedMesh(
      geometry,
      new MeshLambertMaterial({
        color: 0xffffff,
        emissive: 0x9aa6b0,
        flatShading: true,
        fog: false,
      }),
      count,
    );
    this.mesh.name = 'clouds';
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.sin(i * 7.3) * 0.4;
      const reach = 120 + ((i * 97) % 11) * 22;
      this.spots.push({
        x: Math.cos(angle) * reach,
        z: Math.sin(angle) * reach,
        y: 95 + ((i * 53) % 7) * 9,
        scale: 0.9 + ((i * 31) % 5) * 0.25,
        turn: i * 1.7,
      });
    }
  }

  update(timeSeconds: number, doom: number): void {
    const drift = timeSeconds * 1.2;
    this.spots.forEach((spot, index) => {
      // Drift east, wrapping round the sky.
      const x = ((spot.x + drift + 450) % 900) - 450;
      this.position.set(x, spot.y, spot.z);
      this.rotation.setFromAxisAngle(UP, spot.turn);
      this.matrix.compose(this.position, this.rotation, this.size.setScalar(spot.scale));
      this.mesh.setMatrixAt(index, this.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    const material = this.mesh.material as MeshLambertMaterial;
    material.color.copy(WHITE).lerp(DOOM_CLOUD, doom);
    material.emissive.copy(CLOUD_GLOW).lerp(DOOM_GLOW, doom);
  }
}

const UP = new Vector3(0, 1, 0);
const CLOUD_GLOW = new Color(0x9aa6b0);
const DOOM_CLOUD = new Color(0x5a2a22);
const DOOM_GLOW = new Color(0x8a2a10);

/**
 * Turn the day apocalyptic as the meteor nears: `doom` 0 is a clear day, 1 a red sky. A white
 * `flash` (0 to 1) washes over it at impact.
 */
export function setDoom(
  parts: { sky: Mesh; fog: Fog; ambient: HemisphereLight; sun: Sun },
  doom: number,
  flash = 0,
): void {
  const uniforms = (parts.sky.material as ShaderMaterial).uniforms;
  const zenith = uniforms.zenithColor.value as Color;
  const horizon = uniforms.horizonColor.value as Color;
  zenith.copy(SKY_ZENITH).lerp(DOOM_ZENITH, doom);
  horizon.copy(SKY_HORIZON).lerp(DOOM_HORIZON, doom);
  if (flash > 0) {
    zenith.lerp(WHITE, flash);
    horizon.lerp(WHITE, flash);
  }
  (uniforms.sunColor.value as Color).copy(SUN_GLOW).lerp(DOOM_SUN_GLOW, doom);
  parts.fog.color.copy(horizon);
  parts.ambient.intensity = DAY_AMBIENT + (DOOM_AMBIENT - DAY_AMBIENT) * doom + 2 * flash;
  parts.sun.light.color.copy(DAY_SUN).lerp(DOOM_SUN, doom);
}

/**
 * The sun: one directional light whose shadows only cover the area around the player
 * (BUILD_PROMPT.md §6, "limited shadow distance").
 */
export class Sun {
  readonly light: DirectionalLight;
  /** Unit vector pointing from the ground towards the sun. */
  private readonly toSun = TO_SUN.clone();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly snapped = new Vector3();
  private readonly mapSize: number;

  constructor(scene: Scene, quality: QualitySettings) {
    this.mapSize = quality.shadowMapSize;
    this.light = new DirectionalLight(DAY_SUN, 2.4);
    this.light.castShadow = quality.shadows;
    const shadow = this.light.shadow;
    shadow.mapSize.set(this.mapSize, this.mapSize);
    shadow.radius = 2;
    shadow.bias = -0.0005;
    shadow.normalBias = 0.04;
    shadow.camera.near = 1;
    shadow.camera.far = 400;
    // Basis of the shadow camera's view plane, used to snap it to whole texels.
    this.right.crossVectors(new Vector3(0, 1, 0), this.toSun).normalize();
    this.up.crossVectors(this.toSun, this.right);
    scene.add(this.light, this.light.target);
  }

  /** Centre the shadowed area on `center`, reaching `extent` units in every direction. */
  follow(center: Vector3, extent: number): void {
    const camera = this.light.shadow.camera;
    if (camera.right !== extent) {
      camera.left = -extent;
      camera.right = extent;
      camera.top = extent;
      camera.bottom = -extent;
      camera.updateProjectionMatrix();
    }
    // Moving the shadow camera by whole texels stops shadow edges shimmering as the player moves.
    const texel = (2 * extent) / this.mapSize;
    const along = center.dot(this.toSun);
    const across = Math.round(center.dot(this.right) / texel) * texel;
    const upward = Math.round(center.dot(this.up) / texel) * texel;
    this.snapped
      .copy(this.toSun)
      .multiplyScalar(along)
      .addScaledVector(this.right, across)
      .addScaledVector(this.up, upward);
    this.light.target.position.copy(this.snapped);
    this.light.position.copy(this.snapped).addScaledVector(this.toSun, 150);
  }
}
