import {
  CAMERA,
  CARCASS_SPECIES,
  canSee,
  clamp,
  CRITTERS,
  DANGER_ZONE_NAMES,
  dangerZoneAt,
  EFFECTS,
  foodMultiplierAt,
  type HappeningKind,
  heightAt,
  type Heightfield,
  IDLE_INPUT,
  isHiddenInFerns,
  MASS,
  type PlayerInput,
  ROOM,
  speedForMass,
  TAU,
  terrainSpeedFactor,
  threatBetween,
  tierForMass,
  timeToNextRound,
  VOLCANO_VENTS,
  warningProgress,
  WORLD,
} from '@extinct/shared';
import {
  type Fog,
  type Group,
  type HemisphereLight,
  type Mesh,
  PCFShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Controls } from '../input/controls.ts';
import { BeaconsView } from '../render/beacons.ts';
import { CameraRig } from '../render/cameraRig.ts';
import { CarcassesView, type CarrierPose } from '../render/carcasses.ts';
import { CrittersView } from '../render/critters.ts';
import { DinoCrowd } from '../render/dino/crowd.ts';
import { EggsView } from '../render/eggs.ts';
import { createAmbientLight, createFog, createSky, setDoom, Sun } from '../render/environment.ts';
import { MeatView } from '../render/meat.ts';
import { MeteorView } from '../render/meteor.ts';
import type { QualitySettings } from '../render/quality.ts';
import { animateLava, createPools, createTerrain, createWater } from '../render/terrain.ts';
import { ThreatRings } from '../render/threatRings.ts';
import { createVegetation } from '../render/vegetation.ts';
import { VentsView } from '../render/vents.ts';
import { Banner } from '../ui/banner.ts';
import { DeathScreen } from '../ui/deathScreen.ts';
import { DebugOverlay, type ServerStatus } from '../ui/debugOverlay.ts';
import { ControlsHint } from '../ui/hint.ts';
import { Hud, type StatusChip } from '../ui/hud.ts';
import { KillFeed } from '../ui/killFeed.ts';
import { Leaderboard } from '../ui/leaderboard.ts';
import { Minimap } from '../ui/minimap.ts';
import { NameTags } from '../ui/nameTags.ts';
import { Podium } from '../ui/podium.ts';
import { RoundTimer } from '../ui/roundTimer.ts';
import type { PoseSample } from './poseHistory.ts';
import type {
  BotSummary,
  Session,
  SessionCarcass,
  SessionDino,
  SessionEvent,
  SessionStanding,
} from './session.ts';

/** Longer frames (a stalled or backgrounded tab) are clamped so the simulation never spirals. */
const MAX_FRAME_SECONDS = 0.25;
/** Name tags show on dinosaurs within this distance of you, plus a little more per body scale. */
const NAME_TAG_DISTANCE = 45;
const NAME_TAG_DISTANCE_PER_SCALE = 8;
/** Name tags float this high above the ground, in body scales. */
const NAME_TAG_HEIGHT = 1.1;
/** Eating dinosaurs chew this often. */
const CHEW_SECONDS = 0.35;

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
  stamina: number;
  winded: boolean;
  /** Has a carcass in its mouth, and how much food is left in it. */
  carrying: boolean;
  carriedFood: number;
  eating: boolean;
  /** Place on the leaderboard, 0 while dead. */
  rank: number;
  hidden: boolean;
  /** Name of whoever caught the player last, if anyone. */
  eatenBy: string | null;
  eggsAlive: number;
  meat: number;
  carcasses: number;
  dinosAlive: number;
  controls: string;
  round: { number: number; phase: string; clock: number };
}

/** A carcass this client can see, as `window.__extinct.carcasses()` reports it. */
export interface CarcassInfo {
  id: number;
  x: number;
  z: number;
  food: number;
  kind: string;
  carrierId: number | null;
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
  /** Start a world event `ahead` units in front of the player (or somewhere random). */
  startEvent(kind: HappeningKind, ahead?: number): void;
  /** The top ten, and once the meteor has hit, the podium. */
  leaderboard(): SessionStanding[];
  podium(): SessionStanding[];
  /** Every carcass this client can see. */
  carcasses(): CarcassInfo[];
  /** Offline only: move an egg to this many units in front of the player. */
  placeEggAhead(distance: number): void;
  /**
   * Offline only: put a bot of `mass` this far in front of the player (and `side` units to its
   * right), facing `toward` the player or `away` from it, with no spawn protection. With
   * `still`, it stands there doing nothing for a minute. It takes the bot furthest from the
   * player, so repeated calls place different bots. Returns its id.
   */
  placeDinoAhead(
    mass: number,
    distance: number,
    facing: 'toward' | 'away',
    side?: number,
    still?: boolean,
  ): number;
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
  private readonly ambient: HemisphereLight;
  private readonly pools: Group;
  private readonly eggs: EggsView;
  private readonly crowd: DinoCrowd;
  private readonly rings: ThreatRings;
  private readonly meat: MeatView;
  private readonly critters: CrittersView;
  private readonly vents: VentsView;
  private readonly carcasses: CarcassesView;
  private readonly beacons: BeaconsView;
  private readonly meteor: MeteorView;
  private readonly controls: Controls;
  private readonly hud: Hud;
  private readonly overlay: DebugOverlay;
  private readonly hint: ControlsHint;
  private readonly nameTags: NameTags;
  private readonly killFeed: KillFeed;
  private readonly deathScreen: DeathScreen;
  private readonly roundTimer: RoundTimer;
  private readonly leaderboard: Leaderboard;
  private readonly minimap: Minimap;
  private readonly podium: Podium;
  private readonly banner: Banner;
  private readonly impactFlash: HTMLElement;

  private readonly poses = new Map<number, PoseSample>();
  private input: PlayerInput = IDLE_INPUT;
  /** When each eating dinosaur last chewed, for the chewing animation. */
  private readonly chewedAt = new Map<number, number>();
  /** The player's place when the meteor hit (0 if it was dead by then), for the podium. */
  private placeAtImpact = 0;
  private impactAt = Number.NEGATIVE_INFINITY;
  private readonly carrier: { x: number; z: number; heading: number; scale: number } = {
    x: 0,
    z: 0,
    heading: 0,
    scale: 1,
  };
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
    this.ambient = createAmbientLight();
    this.pools = createPools();
    this.eggs = new EggsView(session.eggs, this.field);
    this.rings = new ThreatRings(this.field, ROOM.maxPlayers);
    this.meat = new MeatView(this.field);
    this.critters = new CrittersView(this.field, CRITTERS.count);
    this.vents = new VentsView(this.field);
    this.carcasses = new CarcassesView(this.field);
    this.beacons = new BeaconsView(this.field);
    this.meteor = new MeteorView(this.field);
    this.scene.add(
      this.sky,
      this.ambient,
      createTerrain(this.field),
      createWater(),
      this.pools,
      createVegetation(this.field, options.quality),
      this.eggs.mesh,
      this.rings.mesh,
      this.meat.mesh,
      this.critters.mesh,
      this.vents.group,
      this.carcasses.mesh,
      this.beacons.mesh,
      this.meteor.group,
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
    this.minimap = new Minimap(ui);
    this.roundTimer = new RoundTimer(ui);
    this.banner = new Banner(ui);
    this.leaderboard = new Leaderboard(ui);
    this.podium = new Podium(ui);
    this.impactFlash = document.createElement('div');
    this.impactFlash.className = 'impact-flash';
    ui.append(this.impactFlash);
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
    // Bite at once on screen, rather than a round trip later.
    const self = this.session.player;
    if (this.input.bite && self?.alive) this.crowd.find(self.id)?.bite();
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
          // Your own bite already played when you clicked.
          if (event.dinoId !== player?.id) this.crowd.find(event.dinoId)?.bite();
          break;
        case 'dinoKilled':
          this.dinoKilled(event, timeMs);
          break;
        case 'shoved':
          if (event.dinoId === player?.id) this.cameraRig.punch(CAMERA.shovePunch);
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
        case 'happening':
          this.announce(event, timeMs);
          break;
        case 'meteorWarning':
          this.banner.show(timeMs, 'The meteor is coming! Be the biggest when it hits.', 'meteor');
          break;
        case 'meteorImpact':
          this.placeAtImpact = player?.alive ? player.rank : 0;
          this.impactAt = timeMs;
          this.cameraRig.shake(EFFECTS.impactShake);
          this.deathScreen.hide();
          break;
        case 'roundStarted':
          this.podium.hide();
          this.deathScreen.hide();
          this.killFeed.clear();
          this.banner.show(timeMs, `Round ${event.round}: eat, grow, survive the meteor`, 'round');
          break;
      }
    }
  }

  /** Tell everyone about a world event, and where to find it. */
  private announce(event: Extract<SessionEvent, { type: 'happening' }>, timeMs: number): void {
    const where = event.zone === null ? 'on the island' : `in ${DANGER_ZONE_NAMES[event.zone]}`;
    const bonus = event.zone === null ? '' : ` Food ×${foodMultiplierAt(event.x, event.z)} there!`;
    const species = CARCASS_SPECIES[event.variant % CARCASS_SPECIES.length];
    const message =
      event.kind === 'carcass'
        ? `A huge ${species} carcass (${Math.round(event.food)} food) lies ${where}!${bonus}`
        : `A pterosaur dropped its catch ${where}: fresh meat!${bonus}`;
    this.banner.show(timeMs, message, event.zone === null ? 'event' : 'danger');
  }

  private dinoKilled(event: Extract<SessionEvent, { type: 'dinoKilled' }>, timeMs: number): void {
    const playerId = this.session.player?.id;
    this.crowd.find(event.killerId)?.bite();
    const involvesYou = event.killerId === playerId || event.victimId === playerId;
    const killerName = event.killerId === playerId ? 'You' : event.killerName;
    const victimName = event.victimId === playerId ? 'You' : event.victimName;
    this.killFeed.add(timeMs, killerName, victimName, involvesYou);
    if (event.killerId === playerId) {
      this.cameraRig.punch(CAMERA.killPunch);
      this.hitstopUntil = timeMs + EFFECTS.hitstopSeconds * 1000;
    }
    if (event.victimId === playerId) {
      this.deathScreen.show({
        eater: `${event.killerName} the ${tierForMass(event.killerMass).species}`,
        massReached: event.victimMass,
        speciesReached: tierForMass(event.victimMass).species,
        rank: event.victimRank,
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
      if (dino.eating) this.chew(dino.id, timeMs);
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
    this.updateDoom(timeMs);
    this.sky.position.copy(camera.position);
    this.eggs.update(dt);
    this.meat.update(session.meat);
    this.critters.update(dt, session.critters, (critter, out) => session.critterPose(critter, out));
    this.vents.update(session.time);
    this.carcasses.update(session.carcasses, (carcass) => this.carrierPose(carcass));
    this.beacons.update(session.happenings, time);
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

  /** Eating dinosaurs chew: a bite every CHEW_SECONDS. */
  private chew(id: number, timeMs: number): void {
    if (timeMs - (this.chewedAt.get(id) ?? Number.NEGATIVE_INFINITY) < CHEW_SECONDS * 1000) return;
    this.chewedAt.set(id, timeMs);
    this.crowd.find(id)?.bite();
  }

  /** Where to draw a carried carcass: in its carrier's mouth, wherever that's drawn this frame. */
  private carrierPose(carcass: SessionCarcass): CarrierPose | undefined {
    const carrier =
      carcass.carrierId === null ? undefined : this.session.dinos.get(carcass.carrierId);
    if (!carrier?.alive) return undefined;
    const pose = this.poses.get(carrier.id) ?? carrier;
    this.carrier.x = pose.x;
    this.carrier.z = pose.z;
    this.carrier.heading = pose.heading;
    this.carrier.scale = this.crowd.viewOf(carrier).bodyScale;
    return this.carrier;
  }

  /**
   * The meteor finale: the sky reddens and the ground rumbles through the last minute, then
   * a white flash and a shockwave at impact. The sky stays red over the podium.
   */
  private updateDoom(timeMs: number): void {
    const { phase, clock, settings } = this.session.round;
    const doom = phase === 'playing' ? warningProgress(clock, settings) : 1;
    const impact =
      phase === 'impact'
        ? (clock - settings.durationSeconds) / settings.impactSequenceSeconds
        : phase === 'podium'
          ? 1
          : -1;
    this.meteor.update(phase === 'playing' ? doom : 0, impact, timeMs / 1000, this.focus);
    const flash = clamp(1 - (timeMs - this.impactAt) / (EFFECTS.impactFlashSeconds * 1000), 0, 1);
    setDoom({ sky: this.sky, fog: this.fog, ambient: this.ambient, sun: this.sun }, doom, flash);
    this.impactFlash.style.opacity = flash.toFixed(3);
    this.cameraRig.rumble(phase === 'playing' ? EFFECTS.meteorRumble * doom : 0);
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
    const round = this.session.round;
    this.hud.update(player.mass);
    this.hud.setStamina(player.stamina, player.winded);
    this.hud.setStatus(this.statusChips(player));
    this.killFeed.update(timeMs);
    if (!player.alive && round.phase === 'playing') this.deathScreen.update(player.respawnIn);
    this.hint.update(timeMs, this.controls.used);
    this.roundTimer.update(round);
    this.banner.update(timeMs);
    this.leaderboard.update(this.session.leaderboard, player);
    const pose = this.poses.get(player.id) ?? player;
    this.minimap.update(timeMs, {
      player: player.alive ? pose : undefined,
      playerId: player.id,
      happenings: this.session.happenings,
      leaders: this.session.leaderboard,
    });
    if (round.phase === 'podium') {
      if (!this.podium.visible) this.podium.show(round.podium, player.id, this.placeAtImpact);
      this.podium.update(timeToNextRound(round.clock, round.settings));
    } else if (this.podium.visible) {
      this.podium.hide();
    }
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
    if (player.carrying) {
      const food = this.carriedFood(player);
      chips.push(
        player.eating
          ? { kind: 'eating', text: `Eating: ${Math.ceil(food)} food left` }
          : { kind: 'carrying', text: `Carrying ${Math.ceil(food)} food: hold E to eat` },
      );
    } else if (player.eating) {
      chips.push({ kind: 'eating', text: 'Eating' });
    }
    const zone = dangerZoneAt(player.x, player.z);
    if (zone !== null) {
      const name = DANGER_ZONE_NAMES[zone];
      chips.push({
        kind: 'danger',
        text: `${name[0].toUpperCase()}${name.slice(1)}: food ×${foodMultiplierAt(player.x, player.z)}`,
      });
    }
    if (isHiddenInFerns(player)) chips.push({ kind: 'hidden', text: 'Hidden in the ferns' });
    if (player.sprinting) {
      chips.push({ kind: 'sprinting', text: 'Sprinting' });
    } else if (player.winded && this.input.sprint) {
      chips.push({ kind: 'tired', text: 'Winded: catch your breath' });
    }
    const terrain = terrainSpeedFactor(player.x, player.z);
    if (terrain === WORLD.tarPitSpeedMultiplier) {
      chips.push({ kind: 'slowed', text: 'Stuck in tar: half speed' });
    } else if (terrain === WORLD.riverSpeedMultiplier) {
      chips.push({ kind: 'slowed', text: 'Wading through the river' });
    }
    return chips;
  }

  /** Food left in the carcass the player is carrying. */
  private carriedFood(player: SessionDino): number {
    for (const carcass of this.session.carcasses.values()) {
      if (carcass.carrierId === player.id) return carcass.food;
    }
    return 0;
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
          stamina: player?.stamina ?? 0,
          winded: player?.winded ?? false,
          carrying: player?.carrying ?? false,
          carriedFood: player ? this.carriedFood(player) : 0,
          eating: player?.eating ?? false,
          rank: player?.rank ?? 0,
          hidden: player ? isHiddenInFerns(player) : false,
          eatenBy: eater?.name ?? null,
          eggsAlive: this.eggsAlive(),
          meat: session.meat.size,
          carcasses: session.carcasses.size,
          dinosAlive: this.dinosAlive(),
          controls: this.controls.scheme,
          round: {
            number: session.round.number,
            phase: session.round.phase,
            clock: session.round.clock,
          },
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
      startEvent: (kind, ahead) => {
        session.test.startEvent(kind, ahead);
      },
      leaderboard: () => [...session.leaderboard],
      podium: () => [...session.round.podium],
      carcasses: () =>
        [...session.carcasses.values()].map((carcass) => ({
          id: carcass.id,
          x: carcass.x,
          z: carcass.z,
          food: carcass.food,
          kind: carcass.kind,
          carrierId: carcass.carrierId,
        })),
      placeEggAhead: (distance) => {
        if (!session.test.placeEggAhead) throw offlineOnly('placeEggAhead');
        session.test.placeEggAhead(distance);
      },
      placeDinoAhead: (mass, distance, facing, side, still) => {
        if (!session.test.placeDinoAhead) throw offlineOnly('placeDinoAhead');
        return session.test.placeDinoAhead(mass, distance, facing, side, still);
      },
    };
  }
}
