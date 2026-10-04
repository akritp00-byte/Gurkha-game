import {
  type Camera,
  HalfFloatType,
  type Scene,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Bloom: how strong, how soft, and how bright something must be to glow. */
const BLOOM = { strength: 0.45, radius: 0.5, threshold: 0.82 };
/** Multisampling for the scene's render target (the canvas's own antialiasing is lost here). */
const SAMPLES = 4;

/**
 * Subtle bloom on the high preset (BUILD_PROMPT.md §6): lava, sparks, the sun and the meteor
 * glow. The scene renders into a multisampled target, so edges stay smooth.
 */
export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly scenePass: RenderPass;
  private readonly bloom: UnrealBloomPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: SAMPLES });
    this.composer = new EffectComposer(renderer, target);
    this.scenePass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(
      new Vector2(1, 1),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(camera: Camera): void {
    this.scenePass.camera = camera;
    this.composer.render();
  }
}
