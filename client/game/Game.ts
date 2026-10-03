import {
  CAMERA,
  clamp,
  type Dino,
  GameWorld,
  heightAt,
  type Heightfield,
  IDLE_INPUT,
  islandHeightfield,
  lerp,
  lerpAngle,
  type Motion,
  type MoveInput,
  NETWORK,
  speedForMass,
  tierForMass,
  type WorldEvent,
} from '@extinct/shared';
import {
  type Fog,
  type Group,
  type Mesh,
  PCFShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Controls } from '../input/controls.ts';
import { CameraRig } from '../render/cameraRig.ts';
import { DinoView } from '../render/dino/DinoView.ts';
import { EggsView } from '../render/eggs.ts';
import { createAmbientLight, createFog, createSky, Sun } from '../render/environment.ts';
import type { QualitySettings } from '../render/quality.ts';
import { animateLava, createPools, createTerrain, createWater } from '../render/terrain.ts';
import { createVegetation } from '../render/vegetation.ts';
import { DebugOverlay } from '../ui/debugOverlay.ts';
import { ControlsHint } from '../ui/hint.ts';
import { Hud } from '../ui/hud.ts';

/** The simulation runs at the server's tick rate, so offline play feels like online play. */
const TICK_SECONDS = 1 / NETWORK.tickRate;
/** Longer frames (a stalled or backgrounded tab) are clamped so the simulation never spirals. */
const MAX_FRAME_SECONDS = 0.25;

export interface GameOptions {
  readonly quality: QualitySettings;
  readonly seed: number;
  readonly startMass: number;
  readonly showDebug: boolean;
  readonly touchFirst: boolean;
}

/** Read-only peek at the game for tests and the browser console, as `window.__extinct`. */
export interface DebugApi {
  state(): {
    x: number;
    z: number;
    heading: number;
    speed: number;
    mass: number;
    species: string;
    eggsAlive: number;
    controls: string;
  };
  stats(): { fps: number; cpuMs: number; drawCalls: number; triangles: number };
  /** Set the player's mass (to try out other tiers). */
  setMass(mass: number): void;
  /** Move an egg to this many units in front of the player. */
  placeEggAhead(distance: number): void;
}

/**
 * The single-player sandbox: the island, the player's dinosaur and the eggs. The simulation
 * itself (GameWorld) is shared code; this class feeds it input and draws the result.
 */
export class Game {
  readonly debugApi: DebugApi;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly field: Heightfield;
  private readonly world: GameWorld;
  private readonly player: Dino;
  private readonly quality: QualitySettings;
  private readonly cameraRig: CameraRig;
  private readonly sun: Sun;
  private readonly sky: Mesh;
  private readonly fog: Fog;
  private readonly pools: Group;
  private readonly eggs: EggsView;
  private readonly playerView: DinoView;
  private readonly controls: Controls;
  private readonly hud: Hud;
  private readonly overlay: DebugOverlay;
  private readonly hint: ControlsHint;

  private previous: Motion;
  private input: MoveInput = IDLE_INPUT;
  private accumulator = 0;
  private lastFrameMs: number | undefined;
  private readonly dinoOnScreen = { x: 0, y: 0 };
  private readonly focus = new Vector3();
  private readonly projected = new Vector3();
  private fps = 0;
  private frameMs = 0;
  private framesCounted = 0;
  private countStartMs: number | undefined;
  /** Smoothed time our own code spends per frame, excluding the GPU. */
  private cpuMs = 0;
  private rendered = false;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, options: GameOptions) {
    this.canvas = canvas;
    this.quality = options.quality;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: options.quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = options.quality.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.field = islandHeightfield();
    this.world = new GameWorld(options.seed, this.field);
    this.player = this.world.spawnDino();
    if (options.startMass !== this.player.mass) this.world.setMass(this.player, options.startMass);
    this.previous = { ...this.player };

    this.fog = createFog();
    this.scene.fog = this.fog;
    this.sky = createSky();
    this.sun = new Sun(this.scene, options.quality);
    this.pools = createPools();
    this.eggs = new EggsView(this.world.eggs, this.field);
    this.playerView = new DinoView(this.player.mass);
    this.scene.add(
      this.sky,
      createAmbientLight(),
      createTerrain(this.field),
      createWater(),
      this.pools,
      createVegetation(this.field, options.quality),
      this.eggs.mesh,
      this.playerView.root,
    );
    this.cameraRig = new CameraRig(this.field);

    this.controls = new Controls(canvas, ui, options.touchFirst);
    this.hud = new Hud(ui);
    this.overlay = new DebugOverlay(ui, options.showDebug);
    this.hint = new ControlsHint(ui, options.touchFirst, performance.now());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.resize);
    this.resize();

    this.debugApi = this.createDebugApi();
  }

  /** Mark the game server reachable or not in the debug overlay. */
  setServerOnline(online: boolean): void {
    this.overlay.setServerOnline(online);
  }

  start(): void {
    this.renderer.setAnimationLoop(this.frame);
  }

  private readonly frame = (timeMs: number): void => {
    const frameStart = performance.now();
    const dt =
      this.lastFrameMs === undefined
        ? 0
        : Math.min((timeMs - this.lastFrameMs) / 1000, MAX_FRAME_SECONDS);
    this.lastFrameMs = timeMs;

    this.input = this.controls.sample(this.dinoOnScreen);
    this.accumulator += dt;
    while (this.accumulator >= TICK_SECONDS) {
      this.previous = { ...this.player };
      this.handle(this.world.step(TICK_SECONDS, new Map([[this.player.id, this.input]])));
      this.accumulator -= TICK_SECONDS;
    }

    this.render(dt, this.accumulator / TICK_SECONDS, timeMs / 1000);
    this.cpuMs += (performance.now() - frameStart - this.cpuMs) * 0.1;
    this.countFrame(timeMs);
    this.hud.update(this.player.mass);
    this.hint.update(timeMs, this.controls.used);
    this.overlay.update(timeMs, {
      fps: this.fps,
      frameMs: this.frameMs,
      cpuMs: this.cpuMs,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pingMs: null,
      entities: { dinos: this.world.dinos.size, eggs: this.eggsAlive() },
      player: {
        species: tierForMass(this.player.mass).species,
        mass: this.player.mass,
        speed: this.player.speed,
        x: this.player.x,
        z: this.player.z,
      },
      quality: this.quality.level,
      controls: this.controls.scheme,
    });
  };

  private handle(events: readonly WorldEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'eggEaten':
          this.eggs.eggEaten(event.slot);
          if (event.dinoId === this.player.id) {
            this.playerView.bite();
            this.cameraRig.punch(CAMERA.bitePunch);
          }
          break;
        case 'eggSpawned':
          this.eggs.eggSpawned(event.slot);
          break;
        case 'evolved':
          if (event.dinoId === this.player.id) this.cameraRig.punch(CAMERA.evolvePunch);
          break;
      }
    }
  }

  private render(dt: number, alpha: number, time: number): void {
    // Draw the player between the last two simulation ticks so movement stays smooth at any frame rate.
    const pose = {
      x: lerp(this.previous.x, this.player.x, alpha),
      z: lerp(this.previous.z, this.player.z, alpha),
      heading: lerpAngle(this.previous.heading, this.player.heading, alpha),
      speed: lerp(this.previous.speed, this.player.speed, alpha),
      mass: this.player.mass,
    };
    this.playerView.update(dt, pose, this.field);

    const ground = heightAt(this.field, pose.x, pose.z);
    this.cameraRig.update(dt, {
      x: pose.x,
      z: pose.z,
      heading: pose.heading,
      ground,
      scale: this.playerView.bodyScale,
      speedFraction: clamp(pose.speed / speedForMass(pose.mass), 0, 1),
    });
    const camera = this.cameraRig.camera;
    const zoom = this.cameraRig.zoomLevel;

    // Bigger dinosaurs see further, and their shadows reach further.
    this.fog.near = 30 + 10 * zoom;
    this.fog.far = 120 + 30 * zoom;
    this.focus.set(pose.x, ground, pose.z);
    this.sun.follow(this.focus, 22 + 9 * zoom);
    this.sky.position.copy(camera.position);
    this.eggs.update(dt);
    animateLava(this.pools, time);

    this.renderer.render(this.scene, camera);
    if (!this.rendered) {
      this.rendered = true;
      this.canvas.dataset.ready = 'true'; // lets smoke tests wait for the first frame
    }

    // Where the dinosaur is on screen, for mouse steering.
    this.projected.set(pose.x, ground + 0.5 * zoom, pose.z).project(camera);
    this.dinoOnScreen.x = ((this.projected.x + 1) / 2) * this.canvas.clientWidth;
    this.dinoOnScreen.y = ((1 - this.projected.y) / 2) * this.canvas.clientHeight;
  }

  /** Frame rate from real timestamps (the simulation clamps long frames; this must not). */
  private countFrame(timeMs: number): void {
    this.countStartMs ??= timeMs;
    this.framesCounted++;
    const elapsedMs = timeMs - this.countStartMs;
    if (elapsedMs >= 500) {
      this.fps = (this.framesCounted * 1000) / elapsedMs;
      this.frameMs = elapsedMs / this.framesCounted;
      this.framesCounted = 0;
      this.countStartMs = timeMs;
    }
  }

  private eggsAlive(): number {
    let alive = 0;
    for (const egg of this.world.eggs) if (egg.alive) alive++;
    return alive;
  }

  private readonly resize = (): void => {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.cameraRig.setAspect(width / height);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'F3') return;
    event.preventDefault(); // F3 is "find next" in some browsers
    this.overlay.toggle();
  };

  private createDebugApi(): DebugApi {
    return {
      state: () => ({
        x: this.player.x,
        z: this.player.z,
        heading: this.player.heading,
        speed: this.player.speed,
        mass: this.player.mass,
        species: tierForMass(this.player.mass).species,
        eggsAlive: this.eggsAlive(),
        controls: this.controls.scheme,
      }),
      stats: () => ({
        fps: this.fps,
        cpuMs: this.cpuMs,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }),
      setMass: (mass) => {
        this.handle(this.world.setMass(this.player, mass));
      },
      placeEggAhead: (distance) => {
        const slot = this.world.eggs.findIndex((egg) => egg.alive);
        if (slot < 0) return;
        const egg = this.world.eggs[slot];
        egg.x = this.player.x + Math.sin(this.player.heading) * distance;
        egg.z = this.player.z + Math.cos(this.player.heading) * distance;
        this.eggs.eggSpawned(slot);
      },
    };
  }
}
