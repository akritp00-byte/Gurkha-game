import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { QualitySettings } from './quality.ts';

const SKY_ZENITH = new Color(0x3d9be9);
const SKY_HORIZON = new Color(0xcdeeff);

/** Gradient sky dome that follows the camera. Its horizon colour is also the fog colour. */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      zenithColor: { value: SKY_ZENITH },
      horizonColor: { value: SKY_HORIZON },
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
      varying vec3 vDirection;
      void main() {
        float t = pow(clamp(vDirection.y, 0.0, 1.0), 0.6);
        gl_FragColor = vec4(mix(horizonColor, zenithColor, t), 1.0);
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
  return new Fog(SKY_HORIZON, 40, 140);
}

/** Soft sky/ground fill light. */
export function createAmbientLight(): HemisphereLight {
  return new HemisphereLight(0xd7f0ff, 0x5b7a3a, 1.35);
}

/**
 * The sun: one directional light whose shadows only cover the area around the player
 * (BUILD_PROMPT.md §6, "limited shadow distance").
 */
export class Sun {
  readonly light: DirectionalLight;
  /** Unit vector pointing from the ground towards the sun. */
  private readonly toSun = new Vector3(-0.45, 0.85, 0.35).normalize();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly snapped = new Vector3();
  private readonly mapSize: number;

  constructor(scene: Scene, quality: QualitySettings) {
    this.mapSize = quality.shadowMapSize;
    this.light = new DirectionalLight(0xfff1dc, 2.3);
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
