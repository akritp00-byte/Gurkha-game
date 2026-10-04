import {
  CAMERA,
  canSee,
  canSprint,
  clamp,
  type Dino,
  EFFECTS,
  GameWorld,
  heightAt,
  type Heightfield,
  IDLE_INPUT,
  isHiddenInFerns,
  islandHeightfield,
  keepOnIsland,
  MASS,
  type MoveInput,
  NETWORK,
  ROOM,
  speedForMass,
  TAU,
  terrainSpeedFactor,
  threatBetween,
  tierForMass,
  VOLCANO_VENTS,
  WORLD,
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
import { CrittersView } from '../render/critters.ts';
import { DinoCrowd } from '../render/dino/crowd.ts';
import { EggsView } from '../render/eggs.ts';
import { createAmbientLight, createFog, createSky, Sun } from '../render/environment.ts';
import { MeatView } from '../render/meat.ts';
import type { QualitySettings } from '../render/quality.ts';
import { animateLava, createPools, createTerrain, createWater } from '../render/terrain.ts';
import { ThreatRings } from '../render/threatRings.ts';
import { createVegetation } from '../render/vegetation.ts';
import { VentsView } from '../render/vents.ts';
import { DeathScreen } from '../ui/deathScreen.ts';
import { DebugOverlay, type ServerStatus } from '../ui/debugOverlay.ts';
import { ControlsHint } from '../ui/hint.ts';
import { Hud, type StatusChip } from '../ui/hud.ts';
import { KillFeed } from '../ui/killFeed.ts';
import { NameTags } from '../ui/nameTags.ts';
import { PoseHistory, type PoseSample } from './poseHistory.ts';

/** The simulation runs at the server's tick rate, so offline play feels like online play. */
const TICK_SECONDS = 1 / NETWORK.tickRate;
/** Longer frames (a stalled or backgrounded tab) are clamped so the simulation never spirals. */
const MAX_FRAME_SECONDS = 0.25;
/** Name tags show on dinosaurs within this distance of you, plus a little more per body scale. */
const NAME_TAG_DISTANCE = 45;
const NAME_TAG_DISTANCE_PER_SCALE = 8;
/** Name tags float this high above the ground, in body scales. */
const NAME_TAG_HEIGHT = 1.1;
const PLAYER_NAME = 'You';

export interface GameOptions {
  readonly quality: QualitySettings;
  readonly seed: number;
  readonly startMass: number;
  /** Bots sharing the island with the player. */
  readonly bots: number;
  readonly showDebug: boolean;
  readonly touchFirst: boolean;
}

/** What `window.__extinct.state()` reports about the player. */
export interface DebugState {
  x: number;
  z: number;
  heading: number;
  speed: number;
  mass: number;
  species: string;
  alive: boolean;
  protectedFor: number;
  respawnIn: number;
  sprinting: boolean;
  hidden: boolean;
  /** Name of whoever ate the player last, if anyone. */
  eatenBy: string | null;
  eggsAlive: number;
  meat: number;
  dinosAlive: number;
  controls: string;
}

export interface BotSummary {
  id: number;
  name: string;
  x: number;
  z: number;
  mass: number;
  alive: boolean;
  mode: string;
}

/** Peek at and poke the offline sandbox from tests and the browser console, as `window.__extinct`. */
export interface DebugApi {
  state(): DebugState;
  stats(): { fps: number; cpuMs: number; drawCalls: number; triangles: number };
  bots(): BotSummary[];
  /** Set the player's mass (to try out other tiers). */
  setMass(mass: number): void;
  /** Move an egg to this many units in front of the player. */
  placeEggAhead(distance: number): void;
  /**
   * Put a bot of `mass` this far in front of the player (and `side` units to its right), facing
   * `toward` the player or `away` from it, with no spawn protection. It takes the bot furthest
   * from the player, so repeated calls place different bots, and adds one if there are none.
   * Returns the bot's id.
   */
  placeDinoAhead(mass: number, distance: number, facing: 'toward' | 'away', side?: number): number;
  /** Move the player (heading 0 faces +z). */
  teleport(x: number, z: number, heading?: number): void;
  /** End the player's spawn protection now. */
  endProtection(): void;
}

/**
 * The offline sandbox: the island, the player, bots, food and every rule, all running in the
 * browser. The simulation itself (GameWorld) is shared code; this class feeds it input and draws
 * the result.
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
  private readonly crowd: DinoCrowd;
  private readonly rings: ThreatRings;
  private readonly meat: MeatView;
  private readonly critters: CrittersView;
  private readonly vents: VentsView;
  private readonly controls: Controls;
  private readonly hud: Hud;
  private readonly overlay: DebugOverlay;
  private readonly hint: ControlsHint;
  private readonly nameTags: NameTags;
  private readonly killFeed: KillFeed;
  private readonly deathScreen: DeathScreen;

  private readonly dinoHistory = new PoseHistory();
  private readonly critterHistory = new PoseHistory();
  private readonly poses = new Map<number, PoseSample>();
  private readonly inputs = new Map<number, MoveInput>();
  private input: MoveInput = IDLE_INPUT;
  private accumulator = 0;
  private lastFrameMs: number | undefined;
  /** The picture freezes until this time (ms) after you eat a dinosaur. */
  private hitstopUntil = 0;
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
    this.world = new GameWorld({ seed: options.seed, terrain: this.field });
    this.player = this.world.addPlayer(PLAYER_NAME);
    if (options.startMass !== this.player.mass) this.world.setMass(this.player, options.startMass);
    for (let i = 0; i < options.bots; i++) this.world.addBot();

    this.fog = createFog();
    this.scene.fog = this.fog;
    this.sky = createSky();
    this.sun = new Sun(this.scene, options.quality);
    this.pools = createPools();
    this.eggs = new EggsView(this.world.eggs, this.field);
    this.rings = new ThreatRings(this.field, ROOM.maxPlayers);
    this.meat = new MeatView(this.field);
    this.critters = new CrittersView(this.field, this.world.critters.length);
    this.vents = new VentsView(this.field);
    this.scene.add(
      this.sky,
      createAmbientLight(),
      createTerrain(this.field),
      createWater(),
      this.pools,
      createVegetation(this.field, options.quality),
      this.eggs.mesh,
      this.rings.mesh,
      this.meat.mesh,
      this.critters.mesh,
      this.vents.group,
    );
    this.crowd = new DinoCrowd(this.scene);
    this.cameraRig = new CameraRig(this.field);

    this.controls = new Controls(canvas, ui, options.touchFirst);
    this.nameTags = new NameTags(ui);
    this.hud = new Hud(ui);
    this.killFeed = new KillFeed(ui);
    this.deathScreen = new DeathScreen(ui);
    this.overlay = new DebugOverlay(ui, options.showDebug);
    this.hint = new ControlsHint(ui, options.touchFirst, performance.now());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.resize);
    this.resize();

    this.debugApi = this.createDebugApi();
  }

  /** Show whether the game server is reachable in the debug overlay. */
  setServerStatus(status: ServerStatus): void {
    this.overlay.setServerStatus(status);
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
    this.inputs.set(this.player.id, this.input);
    this.accumulator += dt;
    while (this.accumulator >= TICK_SECONDS) {
      this.dinoHistory.capture(this.world.dinos.values());
      this.critterHistory.capture(this.world.critters);
      this.handle(this.world.step(TICK_SECONDS, this.inputs), timeMs);
      this.accumulator -= TICK_SECONDS;
    }

    // Hitstop: the picture holds still for a moment while the game carries on underneath.
    if (timeMs >= this.hitstopUntil) this.render(dt, this.accumulator / TICK_SECONDS, timeMs);
    this.cpuMs += (performance.now() - frameStart - this.cpuMs) * 0.1;
    this.countFrame(timeMs);
    this.updateInterface(timeMs);
  };

  // --- Simulation events --------------------------------------------------------

  private handle(events: readonly WorldEvent[], timeMs: number): void {
    for (const event of events) {
      switch (event.type) {
        case 'eggEaten':
          this.eggs.eggEaten(event.slot);
          this.chomp(event.dinoId, CAMERA.bitePunch);
          break;
        case 'eggSpawned':
          this.eggs.eggSpawned(event.slot);
          break;
        case 'meatEaten':
        case 'critterEaten':
          this.chomp(event.dinoId, CAMERA.bitePunch);
          break;
        case 'dinoEaten':
          this.dinoEaten(event.eaterId, event.victimId, timeMs);
          break;
        case 'dinoSpawned':
          this.dinoHistory.forget(event.dinoId);
          this.crowd.find(event.dinoId)?.snap(MASS.start);
          if (event.dinoId === this.player.id) this.deathScreen.hide();
          break;
        case 'tierChanged':
          if (event.dinoId === this.player.id && event.tier > event.previousTier) {
            this.cameraRig.punch(CAMERA.evolvePunch);
          }
          break;
        case 'ventErupted': {
          const vent = VOLCANO_VENTS[event.vent];
          const distance = Math.hypot(vent.x - this.player.x, vent.z - this.player.z);
          if (this.player.alive && distance < CAMERA.ventPunchDistance) {
            this.cameraRig.punch(CAMERA.ventPunch * (1 - distance / CAMERA.ventPunchDistance));
          }
          break;
        }
        default:
          break; // the views read meat, critters and vents straight from the world
      }
    }
  }

  /** Someone ate something: play the bite, and punch the camera if it was us. */
  private chomp(dinoId: number, punch: number): void {
    this.crowd.find(dinoId)?.bite();
    if (dinoId === this.player.id) this.cameraRig.punch(punch);
  }

  private dinoEaten(eaterId: number, victimId: number, timeMs: number): void {
    const eater = this.world.dinos.get(eaterId);
    const victim = this.world.dinos.get(victimId);
    if (!eater || !victim) return;
    this.crowd.find(eaterId)?.bite();
    const involvesYou = eater === this.player || victim === this.player;
    this.killFeed.add(timeMs, eater.name, victim.name, involvesYou);
    if (eater === this.player) {
      this.cameraRig.punch(CAMERA.killPunch);
      this.hitstopUntil = timeMs + EFFECTS.hitstopSeconds * 1000;
    }
    if (victim === this.player) {
      this.deathScreen.show({
        eater: `${eater.name} the ${tierForMass(eater.mass).species}`,
        massReached: victim.massAtDeath,
        speciesReached: tierForMass(victim.massAtDeath).species,
      });
    }
  }

  // --- Drawing ---------------------------------------------------------------------

  private render(dt: number, alpha: number, timeMs: number): void {
    const time = timeMs / 1000;
    const player = this.player;
    this.crowd.prune((id) => this.world.dinos.has(id));

    // Draw everything between the last two simulation ticks so movement stays smooth.
    for (const dino of this.world.dinos.values()) {
      let pose = this.poses.get(dino.id);
      if (!pose) {
        pose = { x: 0, z: 0, heading: 0, speed: 0 };
        this.poses.set(dino.id, pose);
      }
      this.dinoHistory.blend(dino, alpha, pose);
    }

    // The camera follows you, or while you're dead, whoever ate you.
    const eater = player.eatenBy === null ? undefined : this.world.dinos.get(player.eatenBy);
    const subject = !player.alive && eater?.alive ? eater : player;
    const subjectPose = this.poses.get(subject.id) ?? subject;

    this.rings.begin();
    const pulse = 0.5 + 0.5 * Math.cos(time * EFFECTS.protectionBlinkHz * TAU);
    for (const dino of this.world.dinos.values()) {
      const view = this.crowd.viewOf(dino);
      const visible = dino.alive && (dino === player || canSee(player, dino));
      view.setVisible(visible);
      if (!visible) continue;
      view.setGlow(dino.protectedFor > 0 ? pulse : 0);
      const pose = this.poses.get(dino.id) ?? dino;
      view.update(dt, { ...pose, mass: dino.mass }, this.field);
      if (dino !== player) {
        this.rings.add(pose.x, pose.z, view.bodyScale, threatBetween(player.mass, dino.mass));
      }
    }
    this.rings.end();

    const subjectView = this.crowd.viewOf(subject);
    const ground = heightAt(this.field, subjectPose.x, subjectPose.z);
    this.cameraRig.update(dt, {
      x: subjectPose.x,
      z: subjectPose.z,
      heading: subjectPose.heading,
      ground,
      scale: subjectView.bodyScale,
      speedFraction: clamp(subjectPose.speed / speedForMass(subject.mass), 0, 1),
    });
    const camera = this.cameraRig.camera;
    const zoom = this.cameraRig.zoomLevel;

    // Bigger dinosaurs see further, and their shadows reach further.
    this.fog.near = 30 + 10 * zoom;
    this.fog.far = 120 + 30 * zoom;
    this.focus.set(subjectPose.x, ground, subjectPose.z);
    this.sun.follow(this.focus, 22 + 9 * zoom);
    this.sky.position.copy(camera.position);
    this.eggs.update(dt);
    this.meat.update(this.world.meat);
    this.critters.update(dt, this.world.critters, this.critterHistory, alpha);
    this.vents.update(this.world.time - (1 - alpha) * TICK_SECONDS);
    animateLava(this.pools, time);

    this.renderer.render(this.scene, camera);
    if (!this.rendered) {
      this.rendered = true;
      this.canvas.dataset.ready = 'true'; // lets smoke tests wait for the first frame
    }

    this.placeNameTags(zoom);
    // Where the dinosaur is on screen, for mouse steering.
    this.projected.set(subjectPose.x, ground + 0.5 * zoom, subjectPose.z).project(camera);
    this.dinoOnScreen.x = ((this.projected.x + 1) / 2) * this.canvas.clientWidth;
    this.dinoOnScreen.y = ((1 - this.projected.y) / 2) * this.canvas.clientHeight;
  }

  private placeNameTags(zoom: number): void {
    const camera = this.cameraRig.camera;
    const range = NAME_TAG_DISTANCE + NAME_TAG_DISTANCE_PER_SCALE * zoom;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.nameTags.begin();
    for (const dino of this.world.dinos.values()) {
      if (dino === this.player || !dino.alive || !canSee(this.player, dino)) continue;
      const pose = this.poses.get(dino.id) ?? dino;
      if (Math.hypot(pose.x - camera.position.x, pose.z - camera.position.z) > range) continue;
      const scale = this.crowd.viewOf(dino).bodyScale;
      const ground = heightAt(this.field, pose.x, pose.z);
      this.projected.set(pose.x, ground + NAME_TAG_HEIGHT * scale, pose.z).project(camera);
      if (
        this.projected.z > 1 ||
        Math.abs(this.projected.x) > 1.1 ||
        Math.abs(this.projected.y) > 1.1
      ) {
        continue; // behind the camera or off screen
      }
      this.nameTags.show(
        dino.id,
        dino.name,
        threatBetween(this.player.mass, dino.mass),
        ((this.projected.x + 1) / 2) * width,
        ((1 - this.projected.y) / 2) * height,
      );
    }
    this.nameTags.end((id) => this.world.dinos.has(id));
  }

  // --- Interface -------------------------------------------------------------------

  private updateInterface(timeMs: number): void {
    const player = this.player;
    this.hud.update(player.mass);
    this.hud.setStatus(this.statusChips());
    this.killFeed.update(timeMs);
    if (!player.alive) this.deathScreen.update(player.respawnIn);
    this.hint.update(timeMs, this.controls.used);
    this.overlay.update(timeMs, {
      fps: this.fps,
      frameMs: this.frameMs,
      cpuMs: this.cpuMs,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pingMs: null,
      entities: {
        dinos: this.dinosAlive(),
        eggs: this.eggsAlive(),
        meat: this.world.meat.size,
        critters: this.crittersAlive(),
      },
      player: {
        species: tierForMass(player.mass).species,
        mass: player.mass,
        speed: player.speed,
        x: player.x,
        z: player.z,
      },
      quality: this.quality.level,
      controls: this.controls.scheme,
    });
  }

  private statusChips(): StatusChip[] {
    const player = this.player;
    if (!player.alive) return [];
    const chips: StatusChip[] = [];
    if (player.protectedFor > 0) {
      chips.push({
        kind: 'protected',
        text: `Spawn protection ${Math.ceil(player.protectedFor)} s`,
      });
    }
    if (isHiddenInFerns(player)) chips.push({ kind: 'hidden', text: 'Hidden in the ferns' });
    if (player.sprinting) {
      chips.push({ kind: 'sprinting', text: 'Sprinting: burning mass' });
    } else if (this.input.sprint && this.input.throttle > 0 && !canSprint(player.mass)) {
      chips.push({ kind: 'tired', text: `Too small to sprint (needs more than ${MASS.minimum})` });
    }
    const terrain = terrainSpeedFactor(player.x, player.z);
    if (terrain === WORLD.tarPitSpeedMultiplier) {
      chips.push({ kind: 'slowed', text: 'Stuck in tar: half speed' });
    } else if (terrain === WORLD.riverSpeedMultiplier) {
      chips.push({ kind: 'slowed', text: 'Wading through the river' });
    }
    return chips;
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

  private crittersAlive(): number {
    let alive = 0;
    for (const critter of this.world.critters) if (critter.alive) alive++;
    return alive;
  }

  private dinosAlive(): number {
    let alive = 0;
    for (const dino of this.world.dinos.values()) if (dino.alive) alive++;
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
    const player = this.player;
    return {
      state: () => {
        const eater = player.eatenBy === null ? undefined : this.world.dinos.get(player.eatenBy);
        return {
          x: player.x,
          z: player.z,
          heading: player.heading,
          speed: player.speed,
          mass: player.mass,
          species: tierForMass(player.mass).species,
          alive: player.alive,
          protectedFor: player.protectedFor,
          respawnIn: player.respawnIn,
          sprinting: player.sprinting,
          hidden: isHiddenInFerns(player),
          eatenBy: eater?.name ?? null,
          eggsAlive: this.eggsAlive(),
          meat: this.world.meat.size,
          dinosAlive: this.dinosAlive(),
          controls: this.controls.scheme,
        };
      },
      stats: () => ({
        fps: this.fps,
        cpuMs: this.cpuMs,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }),
      bots: () =>
        [...this.world.dinos.values()]
          .filter((dino) => dino.isBot)
          .map((dino) => ({
            id: dino.id,
            name: dino.name,
            x: dino.x,
            z: dino.z,
            mass: dino.mass,
            alive: dino.alive,
            mode: this.world.brainOf(dino.id)?.mode ?? 'none',
          })),
      setMass: (mass) => {
        this.handle(this.world.setMass(player, mass), performance.now());
      },
      placeEggAhead: (distance) => {
        const slot = this.world.eggs.findIndex((egg) => egg.alive);
        if (slot < 0) return;
        const egg = this.world.eggs[slot];
        egg.x = player.x + Math.sin(player.heading) * distance;
        egg.z = player.z + Math.cos(player.heading) * distance;
        this.eggs.eggSpawned(slot);
      },
      placeDinoAhead: (mass, distance, facing, side = 0) => {
        let bot: Dino | undefined;
        let furthest = -1;
        for (const dino of this.world.dinos.values()) {
          if (!dino.isBot || !dino.alive) continue;
          const gap = Math.hypot(dino.x - player.x, dino.z - player.z);
          if (gap > furthest) {
            bot = dino;
            furthest = gap;
          }
        }
        bot ??= this.world.addBot();
        this.handle(this.world.setMass(bot, mass), performance.now());
        const forwardX = Math.sin(player.heading);
        const forwardZ = Math.cos(player.heading);
        // The player's right is (-forwardZ, forwardX) on the ground plane.
        const [x, z] = keepOnIsland(
          player.x + forwardX * distance - forwardZ * side,
          player.z + forwardZ * distance + forwardX * side,
        );
        bot.x = x;
        bot.z = z;
        bot.heading = facing === 'toward' ? player.heading + Math.PI : player.heading;
        bot.speed = 0;
        bot.pushX = 0;
        bot.pushZ = 0;
        bot.protectedFor = 0;
        this.dinoHistory.forget(bot.id);
        this.crowd.find(bot.id)?.snap(bot.mass);
        return bot.id;
      },
      teleport: (x, z, heading = player.heading) => {
        [player.x, player.z] = keepOnIsland(x, z);
        player.heading = heading;
        player.speed = 0;
        this.dinoHistory.forget(player.id);
      },
      endProtection: () => {
        player.protectedFor = 0;
      },
    };
  }
}
