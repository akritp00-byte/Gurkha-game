import {
  CAMERA,
  canSee,
  canSprint,
  clamp,
  CRITTERS,
  EFFECTS,
  heightAt,
  type Heightfield,
  IDLE_INPUT,
  isHiddenInFerns,
  MASS,
  type MoveInput,
  ROOM,
  speedForMass,
  TAU,
  terrainSpeedFactor,
  threatBetween,
  tierForMass,
  VOLCANO_VENTS,
  WORLD,
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
import type { PoseSample } from './poseHistory.ts';
import type { BotSummary, Session, SessionDino, SessionEvent } from './session.ts';

/** Longer frames (a stalled or backgrounded tab) are clamped so the simulation never spirals. */
const MAX_FRAME_SECONDS = 0.25;
/** Name tags show on dinosaurs within this distance of you, plus a little more per body scale. */
const NAME_TAG_DISTANCE = 45;
const NAME_TAG_DISTANCE_PER_SCALE = 8;
/** Name tags float this high above the ground, in body scales. */
const NAME_TAG_HEIGHT = 1.1;

export interface GameOptions {
  readonly quality: QualitySettings;
  readonly field: Heightfield;
  readonly showDebug: boolean;
  readonly touchFirst: boolean;
}

/** What `window.__extinct.state()` reports about the player. */
export interface DebugState {
  mode: 'offline' | 'online';
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

/** Another dinosaur this client can see, as `window.__extinct.others()` reports it. */
export interface OtherDino {
  id: number;
  name: string;
  x: number;
  z: number;
  mass: number;
  alive: boolean;
}

/**
 * Peek at and poke the game from tests and the browser console, as `window.__extinct`. The
 * pokes (setMass and friends) act on the offline sandbox, or online on a test server only.
 */
export interface DebugApi {
  state(): DebugState;
  stats(): { fps: number; cpuMs: number; drawCalls: number; triangles: number };
  /** Every other dinosaur this client can see. */
  others(): OtherDino[];
  bots(): BotSummary[];
  /** Set the player's mass (to try out other tiers). */
  setMass(mass: number): void;
  /** Move the player (heading 0 faces +z). */
  teleport(x: number, z: number, heading?: number): void;
  /** End the player's spawn protection now. */
  endProtection(): void;
  /** Offline only: move an egg to this many units in front of the player. */
  placeEggAhead(distance: number): void;
  /**
   * Offline only: put a bot of `mass` this far in front of the player (and `side` units to its
   * right), facing `toward` the player or `away` from it, with no spawn protection. It takes the
   * bot furthest from the player, so repeated calls place different bots. Returns its id.
   */
  placeDinoAhead(mass: number, distance: number, facing: 'toward' | 'away', side?: number): number;
}

/**
 * The game on screen: island, dinosaurs, food, camera, controls and interface. The world comes
 * from a Session, either the shared simulation running in the browser or a game server; this
 * class feeds it input, draws what it holds and turns its events into effects.
 */
export class Game {
  readonly debugApi: DebugApi;
  private readonly session: Session;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly field: Heightfield;
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

  private readonly poses = new Map<number, PoseSample>();
  private input: MoveInput = IDLE_INPUT;
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

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement, session: Session, options: GameOptions) {
    this.session = session;
    this.canvas = canvas;
    this.quality = options.quality;
    this.field = options.field;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: options.quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = options.quality.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.fog = createFog();
    this.scene.fog = this.fog;
    this.sky = createSky();
    this.sun = new Sun(this.scene, options.quality);
    this.pools = createPools();
    this.eggs = new EggsView(session.eggs, this.field);
    this.rings = new ThreatRings(this.field, ROOM.maxPlayers);
    this.meat = new MeatView(this.field);
    this.critters = new CrittersView(this.field, CRITTERS.count);
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
    this.handle(this.session.advance(timeMs, dt, this.input), timeMs);

    // Hitstop: the picture holds still for a moment while the game carries on underneath.
    const player = this.session.player;
    if (player && timeMs >= this.hitstopUntil) this.render(dt, timeMs, player);
    this.cpuMs += (performance.now() - frameStart - this.cpuMs) * 0.1;
    this.countFrame(timeMs);
    if (player) this.updateInterface(timeMs, player);
  };

  // --- Events -----------------------------------------------------------------------

  private handle(events: readonly SessionEvent[], timeMs: number): void {
    const player = this.session.player;
    for (const event of events) {
      switch (event.type) {
        case 'eggEaten':
          this.eggs.eggEaten(event.slot);
          break;
        case 'eggSpawned':
          this.eggs.eggSpawned(event.slot);
          break;
        case 'bite':
          this.crowd.find(event.dinoId)?.bite();
          if (event.dinoId === player?.id) this.cameraRig.punch(CAMERA.bitePunch);
          break;
        case 'dinoEaten':
          this.dinoEaten(event, timeMs);
          break;
        case 'dinoSpawned': {
          const dino = this.session.dinos.get(event.dinoId);
          this.crowd.find(event.dinoId)?.snap(dino?.mass ?? MASS.start);
          if (event.dinoId === player?.id) this.deathScreen.hide();
          break;
        }
        case 'tierChanged':
          if (event.dinoId === player?.id && event.tier > event.previousTier) {
            this.cameraRig.punch(CAMERA.evolvePunch);
          }
          break;
        case 'ventErupted': {
          if (!player?.alive) break;
          const vent = VOLCANO_VENTS[event.vent];
          const distance = Math.hypot(vent.x - player.x, vent.z - player.z);
          if (distance < CAMERA.ventPunchDistance) {
            this.cameraRig.punch(CAMERA.ventPunch * (1 - distance / CAMERA.ventPunchDistance));
          }
          break;
        }
      }
    }
  }

  private dinoEaten(event: Extract<SessionEvent, { type: 'dinoEaten' }>, timeMs: number): void {
    const playerId = this.session.player?.id;
    this.crowd.find(event.eaterId)?.bite();
    const involvesYou = event.eaterId === playerId || event.victimId === playerId;
    const eaterName = event.eaterId === playerId ? 'You' : event.eaterName;
    const victimName = event.victimId === playerId ? 'You' : event.victimName;
    this.killFeed.add(timeMs, eaterName, victimName, involvesYou);
    if (event.eaterId === playerId) {
      this.cameraRig.punch(CAMERA.killPunch);
      this.hitstopUntil = timeMs + EFFECTS.hitstopSeconds * 1000;
    }
    if (event.victimId === playerId) {
      this.deathScreen.show({
        eater: `${event.eaterName} the ${tierForMass(event.eaterMass).species}`,
        massReached: event.victimMass,
        speciesReached: tierForMass(event.victimMass).species,
      });
    }
  }

  // --- Drawing ---------------------------------------------------------------------

  private render(dt: number, timeMs: number, player: SessionDino): void {
    const time = timeMs / 1000;
    const session = this.session;
    this.crowd.prune((id) => session.dinos.has(id));
    for (const id of this.poses.keys()) if (!session.dinos.has(id)) this.poses.delete(id);

    // Where to draw everyone this frame: between ticks, or predicted for your own dinosaur.
    for (const dino of session.dinos.values()) {
      let pose = this.poses.get(dino.id);
      if (!pose) {
        pose = { x: 0, z: 0, heading: 0, speed: 0 };
        this.poses.set(dino.id, pose);
      }
      session.dinoPose(dino, pose);
    }

    // The camera follows you, or while you're dead, whoever ate you.
    const eater = player.eatenBy === null ? undefined : session.dinos.get(player.eatenBy);
    const subject = !player.alive && eater?.alive ? eater : player;
    const subjectPose = this.poses.get(subject.id) ?? subject;

    this.rings.begin();
    const pulse = 0.5 + 0.5 * Math.cos(time * EFFECTS.protectionBlinkHz * TAU);
    for (const dino of session.dinos.values()) {
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
    this.meat.update(session.meat);
    this.critters.update(dt, session.critters, (critter, out) => session.critterPose(critter, out));
    this.vents.update(session.time);
    animateLava(this.pools, time);

    this.renderer.render(this.scene, camera);
    if (!this.rendered) {
      this.rendered = true;
      this.canvas.dataset.ready = 'true'; // lets smoke tests wait for the first frame
    }

    this.placeNameTags(zoom, player);
    // Where the dinosaur is on screen, for mouse steering.
    this.projected.set(subjectPose.x, ground + 0.5 * zoom, subjectPose.z).project(camera);
    this.dinoOnScreen.x = ((this.projected.x + 1) / 2) * this.canvas.clientWidth;
    this.dinoOnScreen.y = ((1 - this.projected.y) / 2) * this.canvas.clientHeight;
  }

  private placeNameTags(zoom: number, player: SessionDino): void {
    const camera = this.cameraRig.camera;
    const range = NAME_TAG_DISTANCE + NAME_TAG_DISTANCE_PER_SCALE * zoom;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.nameTags.begin();
    for (const dino of this.session.dinos.values()) {
      if (dino === player || !dino.alive || !canSee(player, dino)) continue;
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
        threatBetween(player.mass, dino.mass),
        ((this.projected.x + 1) / 2) * width,
        ((1 - this.projected.y) / 2) * height,
      );
    }
    this.nameTags.end((id) => this.session.dinos.has(id));
  }

  // --- Interface -------------------------------------------------------------------

  private updateInterface(timeMs: number, player: SessionDino): void {
    this.hud.update(player.mass);
    this.hud.setStatus(this.statusChips(player));
    this.killFeed.update(timeMs);
    if (!player.alive) this.deathScreen.update(player.respawnIn);
    this.hint.update(timeMs, this.controls.used);
    this.overlay.update(timeMs, {
      fps: this.fps,
      frameMs: this.frameMs,
      cpuMs: this.cpuMs,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      pingMs: this.session.pingMs,
      entities: {
        dinos: this.dinosAlive(),
        eggs: this.eggsAlive(),
        meat: this.session.meat.size,
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

  private statusChips(player: SessionDino): StatusChip[] {
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
    for (const egg of this.session.eggs) if (egg.alive) alive++;
    return alive;
  }

  private crittersAlive(): number {
    let alive = 0;
    for (const critter of this.session.critters) if (critter.alive) alive++;
    return alive;
  }

  private dinosAlive(): number {
    let alive = 0;
    for (const dino of this.session.dinos.values()) if (dino.alive) alive++;
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
    const session = this.session;
    const offlineOnly = (name: string) =>
      new Error(`window.__extinct.${name}() only works in the offline sandbox (?offline)`);
    return {
      state: () => {
        const player = session.player;
        const eater =
          player?.eatenBy === null || player?.eatenBy === undefined
            ? undefined
            : session.dinos.get(player.eatenBy);
        return {
          mode: session.mode,
          x: player?.x ?? 0,
          z: player?.z ?? 0,
          heading: player?.heading ?? 0,
          speed: player?.speed ?? 0,
          mass: player?.mass ?? 0,
          species: tierForMass(player?.mass ?? MASS.start).species,
          alive: player?.alive ?? false,
          protectedFor: player?.protectedFor ?? 0,
          respawnIn: player?.respawnIn ?? 0,
          sprinting: player?.sprinting ?? false,
          hidden: player ? isHiddenInFerns(player) : false,
          eatenBy: eater?.name ?? null,
          eggsAlive: this.eggsAlive(),
          meat: session.meat.size,
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
      others: () =>
        [...session.dinos.values()]
          .filter((dino) => dino !== session.player)
          .map((dino) => ({
            id: dino.id,
            name: dino.name,
            x: dino.x,
            z: dino.z,
            mass: dino.mass,
            alive: dino.alive,
          })),
      bots: () => session.test.bots?.() ?? [],
      setMass: (mass) => {
        session.test.setMass(mass);
      },
      teleport: (x, z, heading) => {
        session.test.teleport(x, z, heading);
      },
      endProtection: () => {
        session.test.endProtection();
      },
      placeEggAhead: (distance) => {
        if (!session.test.placeEggAhead) throw offlineOnly('placeEggAhead');
        session.test.placeEggAhead(distance);
      },
      placeDinoAhead: (mass, distance, facing, side) => {
        if (!session.test.placeDinoAhead) throw offlineOnly('placeDinoAhead');
        return session.test.placeDinoAhead(mass, distance, facing, side);
      },
    };
  }
}
