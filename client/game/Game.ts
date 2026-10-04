import {
  type AbilityId,
  attackZone,
  bodyRadius,
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
  VOLCANO,
  VOLCANO_VENTS,
  warningProgress,
  roarRadius,
  spitRange,
  WORLD,
  zoneTouches,
} from '@extinct/shared';
import {
  type BufferGeometry,
  type Fog,
  type Group,
  type HemisphereLight,
  InstancedMesh,
  Mesh,
  PCFShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { SoundBoard } from '../audio/audio.ts';
import { Controls } from '../input/controls.ts';
import { BeaconsView } from '../render/beacons.ts';
import { CameraRig } from '../render/cameraRig.ts';
import { CarcassesView } from '../render/carcasses.ts';
import { CrittersView } from '../render/critters.ts';
import type { Grip } from '../render/dino/corpse.ts';
import { DinoCrowd } from '../render/dino/crowd.ts';
import type { DinoView } from '../render/dino/DinoView.ts';
import { Effects } from '../render/effects.ts';
import {
  Clouds,
  createAmbientLight,
  createFog,
  createSky,
  setDoom,
  Sun,
} from '../render/environment.ts';
import { FoodView } from '../render/food.ts';
import { MeteorView } from '../render/meteor.ts';
import type { QualitySettings } from '../render/quality.ts';
import { animateLava, createLavaFlows, createPools, createTerrain } from '../render/terrain.ts';
import { Water } from '../render/water.ts';
import { PostProcessing } from '../render/post.ts';
import { Pterosaurs } from '../render/pterosaurs.ts';
import { ThreatRings } from '../render/threatRings.ts';
import { createVegetation, SEE_THROUGH } from '../render/vegetation.ts';
import { VentsView } from '../render/vents.ts';
import { AbilityPanel } from '../ui/abilityPanel.ts';
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
  BotBehaviour,
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
/** A footstep every this many body scales walked; other dinosaurs' steps are heard once they're this big. */
const FOOTSTEP_SPACING = 1.1;
const BIG_FOOTSTEPS_SCALE = 2.6;
/** Sprinting kicks up a puff of dust this often. */
const DUST_EVERY_MS = 70;
/** Spit blurs the view by this many pixels, fading over its last this-many seconds. */
const BLUR_PIXELS = 7;
const BLUR_FADE_SECONDS = 0.6;
/** The volcano puffs out smoke this often (twice as often by the meteor). */
const SMOKE_EVERY_MS = 160;

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
  /** The tier's ability (null for a hatchling), seconds before it's ready, and its effects. */
  ability: AbilityId | null;
  abilityCooldown: number;
  chargingFor: number;
  stunnedFor: number;
  blurredFor: number;
  /** Name of whoever caught the player last, if anyone. */
  eatenBy: string | null;
  scrapsAlive: number;
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
  stunnedFor: number;
  blurredFor: number;
}

/**
 * Peek at and poke the game from tests and the browser console, as `window.__extinct`. The
 * pokes (setMass and friends) act on the offline sandbox, or online on a test server only.
 */
export interface DebugApi {
  state(): DebugState;
  stats(): { fps: number; cpuMs: number; drawCalls: number; triangles: number };
  /** Triangles each named part of the scene would draw, biggest first (for performance work). */
  triangleBreakdown(): { name: string; triangles: number }[];
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
  /** Offline only: move a plain scrap of meat (worth 1) to this many units in front of the player. */
  placeScrapAhead(distance: number): void;
  /**
   * Offline only: put a bot of `mass` this far in front of the player (and `side` units to its
   * right), facing `toward` the player or `away` from it, with no spawn protection, doing
   * what `behaviour` says (see BotBehaviour). It takes the bot furthest from the player, so
   * repeated calls place different bots. Returns its id.
   */
  placeDinoAhead(
    mass: number,
    distance: number,
    facing: 'toward' | 'away',
    side?: number,
    behaviour?: BotBehaviour,
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
  private readonly touchFirst: boolean;
  private readonly cameraRig: CameraRig;
  private readonly sun: Sun;
  private readonly sky: Mesh;
  private readonly fog: Fog;
  private readonly ambient: HemisphereLight;
  private readonly pools: Group;
  private readonly food: FoodView;
  private readonly crowd: DinoCrowd;
  private readonly rings: ThreatRings;
  private readonly critters: CrittersView;
  private readonly vents: VentsView;
  private readonly carcasses: CarcassesView;
  private readonly beacons: BeaconsView;
  private readonly meteor: MeteorView;
  private readonly effects = new Effects();
  private readonly water: Water;
  private readonly post: PostProcessing | undefined;
  private readonly clouds = new Clouds();
  private readonly pterosaurs = new Pterosaurs();
  private readonly sound = new SoundBoard();
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
  private readonly abilityPanel: AbilityPanel;
  private readonly splat: HTMLElement;
  /** Whether the player was carrying last frame, and the round phase, to notice changes. */
  private wasCarrying = false;
  private lastPhase = '';

  private readonly poses = new Map<number, PoseSample>();
  private input: PlayerInput = IDLE_INPUT;
  /** When each eating dinosaur last chewed, for the chewing animation. */
  private readonly chewedAt = new Map<number, number>();
  /** Distance each dinosaur has walked since its last footstep, and since its last puff of dust. */
  private readonly strides = new Map<number, number>();
  private readonly dustAt = new Map<number, number>();
  /** The player's mass last frame, to notice food going down. */
  private lastMass = 0;
  private smokeAt = 0;
  /** The player's place when the meteor hit (0 if it was dead by then), for the podium. */
  private placeAtImpact = 0;
  private impactAt = Number.NEGATIVE_INFINITY;
  private readonly grip: { mouth: Vector3; heading: number } = { mouth: new Vector3(), heading: 0 };
  private readonly mouthAt = new Vector3();
  private readonly spitAt = new Vector3();
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
    this.touchFirst = options.touchFirst;
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
    this.pools.add(createLavaFlows(this.field));
    this.water = new Water(this.field);
    this.food = new FoodView(session.scraps, this.field);
    this.rings = new ThreatRings(this.field, ROOM.maxPlayers);
    this.critters = new CrittersView(this.field, CRITTERS.count);
    this.vents = new VentsView(this.field);
    this.carcasses = new CarcassesView(this.field);
    this.beacons = new BeaconsView(this.field);
    this.meteor = new MeteorView(this.field);
    this.scene.add(
      this.sky,
      this.ambient,
      createTerrain(this.field),
      this.water.mesh,
      this.clouds.mesh,
      this.pterosaurs.group,
      this.pools,
      createVegetation(this.field, options.quality),
      this.food.group,
      this.rings.mesh,
      this.critters.mesh,
      this.vents.group,
      this.carcasses.group,
      this.beacons.mesh,
      this.meteor.group,
      this.effects.group,
    );
    this.crowd = new DinoCrowd(this.scene);
    this.cameraRig = new CameraRig(this.field);
    // Bloom renders the scene several times a frame, so count draw calls over the whole frame.
    this.renderer.info.autoReset = false;
    this.post = options.quality.bloom
      ? new PostProcessing(this.renderer, this.scene, this.cameraRig.camera)
      : undefined;

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
    this.splat = document.createElement('div');
    this.splat.className = 'spit-splat';
    this.splat.dataset.testid = 'spit-splat';
    ui.append(this.impactFlash, this.splat);
    this.abilityPanel = new AbilityPanel(this.hud.card);
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
        case 'scrapEaten':
          this.food.scrapEaten(event.slot);
          break;
        case 'scrapSpawned':
          this.food.scrapSpawned(event.slot);
          break;
        case 'bite':
          // Your own bite already played when you clicked.
          if (event.dinoId !== player?.id) {
            this.crowd.find(event.dinoId)?.bite();
            const biter = this.session.dinos.get(event.dinoId);
            if (biter) this.sound.snap(this.crowd.viewOf(biter).bodyScale, biter);
          }
          break;
        case 'dinoKilled':
          this.dinoKilled(event, timeMs);
          break;
        case 'shoved':
          if (event.dinoId === player?.id) {
            this.cameraRig.punch(CAMERA.shovePunch);
            this.sound.thud();
          }
          break;
        case 'dinoSpawned': {
          const dino = this.session.dinos.get(event.dinoId);
          this.crowd.find(event.dinoId)?.snap(dino?.mass ?? MASS.start);
          if (event.dinoId === player?.id) {
            this.deathScreen.hide();
            this.sound.hatch();
          }
          break;
        }
        case 'ability':
          this.abilityUsed(event.dinoId, event.ability, events);
          break;
        case 'spat': {
          const target = this.poses.get(event.targetId);
          if (target) this.sound.splat(target);
          if (event.targetId === player?.id) this.cameraRig.punch(CAMERA.shovePunch * 0.5);
          break;
        }
        case 'stunned':
          if (event.dinoId === player?.id) {
            this.sound.stunned();
            this.cameraRig.shake(EFFECTS.roarShake);
          }
          break;
        case 'tierChanged':
          if (event.dinoId === player?.id && event.tier > event.previousTier) {
            this.cameraRig.punch(CAMERA.evolvePunch);
          }
          break;
        case 'ventErupted': {
          if (!player?.alive) break;
          const vent = VOLCANO_VENTS[event.vent];
          const ventAt = { x: vent.x, y: heightAt(this.field, vent.x, vent.z), z: vent.z };
          this.effects.burst('smoke', ventAt, 14, {
            speed: 9,
            size: 2.4,
            life: 3,
            color: 0xd8d2c8,
            lift: 0.9,
            spread: 0.3,
          });
          this.effects.burst('ember', ventAt, 20, {
            speed: 12,
            size: 0.6,
            life: 1.4,
            color: 0xff7a2a,
            lift: 0.85,
          });
          this.sound.eruption(vent);
          const distance = Math.hypot(vent.x - player.x, vent.z - player.z);
          if (distance < CAMERA.ventPunchDistance) {
            this.cameraRig.punch(CAMERA.ventPunch * (1 - distance / CAMERA.ventPunchDistance));
          }
          break;
        }
        case 'happening':
          this.announce(event, timeMs);
          this.sound.horn();
          break;
        case 'meteorWarning':
          this.banner.show(timeMs, 'The meteor is coming! Be the biggest when it hits.', 'meteor');
          this.sound.meteorWarning();
          break;
        case 'meteorImpact':
          this.placeAtImpact = player?.alive ? player.rank : 0;
          this.impactAt = timeMs;
          this.cameraRig.shake(EFFECTS.impactShake);
          this.sound.impact();
          this.impactBlast();
          this.deathScreen.hide();
          break;
        case 'roundStarted':
          this.podium.hide();
          this.deathScreen.hide();
          this.killFeed.clear();
          this.banner.show(timeMs, `Round ${event.round}: eat, grow, survive the meteor`, 'round');
          this.sound.roundStart();
          break;
      }
    }
  }

  /** A dinosaur used its ability: show it and play it. */
  private abilityUsed(dinoId: number, ability: AbilityId, events: readonly SessionEvent[]): void {
    const dino = this.session.dinos.get(dinoId);
    const view = this.crowd.find(dinoId);
    const pose = this.poses.get(dinoId);
    if (!dino || !view || !pose) return;
    const isPlayer = dinoId === this.session.player?.id;
    const scale = view.bodyScale;
    const ground = heightAt(this.field, pose.x, pose.z);
    switch (ability) {
      case 'pounce':
        view.leap();
        this.effects.burst('dust', { x: pose.x, y: ground + 0.1, z: pose.z }, 8, {
          speed: 3 * scale,
          size: 0.35 * scale,
          life: 0.8,
          color: 0xc8b48a,
          lift: 0.3,
        });
        this.sound.pounce(pose);
        if (isPlayer) this.cameraRig.punch(CAMERA.bitePunch);
        break;
      case 'spit': {
        view.bite();
        view.mouth(this.mouthAt);
        // Towards whoever it hit, or straight ahead if it missed.
        const hit = events.find((event) => event.type === 'spat' && event.byId === dinoId);
        const target = hit?.type === 'spat' ? this.poses.get(hit.targetId) : undefined;
        const range = spitRange(dino.mass);
        const to = target
          ? this.spitAt.set(
              target.x,
              heightAt(this.field, target.x, target.z) + 0.6 * scale,
              target.z,
            )
          : this.spitAt.set(
              pose.x + Math.sin(pose.heading) * range,
              ground,
              pose.z + Math.cos(pose.heading) * range,
            );
        this.effects.spit(this.mouthAt, to, 0.22 * scale);
        this.sound.spit(pose);
        break;
      }
      case 'charge':
        this.sound.charge(pose);
        if (isPlayer) this.cameraRig.shake(EFFECTS.chargeShake);
        break;
      case 'roar': {
        view.roar();
        const at = { x: pose.x, y: ground + 0.2, z: pose.z };
        const radius = roarRadius(dino.mass);
        this.effects.ring(at, radius, 0.9, 0xffb050);
        this.effects.ring(at, radius * 0.6, 0.6, 0xfff0c8);
        this.sound.roar(tierForMass(dino.mass).tier, false, pose);
        const player = this.session.player;
        if (player?.alive) {
          const distance = Math.hypot(player.x - pose.x, player.z - pose.z);
          if (distance < radius * 1.5) this.cameraRig.shake(EFFECTS.roarShake);
        }
        break;
      }
    }
  }

  /** The meteor's blast: fire and ash rolling over the island, and a ring of light racing out. */
  private impactBlast(): void {
    const at = { x: this.focus.x, y: this.focus.y + 0.5, z: this.focus.z };
    this.effects.ring(at, 140, 2.4, 0xffa040);
    this.effects.ring(at, 60, 1.4, 0xfff0c0);
    this.effects.burst('smoke', at, 40, {
      speed: 26,
      size: 9,
      life: 4,
      color: 0x5a3a2c,
      lift: 0.25,
      spread: 0.4,
    });
    this.effects.burst('ember', at, 80, {
      speed: 30,
      size: 1.2,
      life: 2.5,
      color: 0xff7a2a,
      lift: 0.5,
      spread: 0.9,
    });
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
    // A spray of gore where the victim was.
    const victim = this.poses.get(event.victimId);
    if (victim) {
      const scale = Math.cbrt(Math.max(event.victimMass, 1) / 10);
      const at = {
        x: victim.x,
        y: heightAt(this.field, victim.x, victim.z) + 0.5 * scale,
        z: victim.z,
      };
      this.effects.burst('blood', at, 18, {
        speed: 4 * Math.sqrt(scale),
        size: 0.18 * scale,
        life: 0.9,
        color: 0xa3221c,
        lift: 0.6,
      });
      this.sound.kill(victim);
    }
    if (event.victimId === playerId) this.sound.death();
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
      view.update(
        dt,
        {
          ...pose,
          mass: dino.mass,
          carrying: dino.carrying,
          stunned: dino.stunnedFor > 0,
          charging: dino.chargingFor > 0,
        },
        this.field,
      );
      if (dino.stunnedFor > 0) {
        const head = heightAt(this.field, pose.x, pose.z) + view.bodyScale * 0.95;
        this.effects.stars({ x: pose.x, y: head, z: pose.z }, view.bodyScale, time);
      }
      if (dino.eating) this.chew(dino.id, timeMs);
      this.feel(dino, pose, view, dt, timeMs, dino === player);
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
    // Plants between the camera and the dinosaur dissolve so they never hide it.
    SEE_THROUGH.value =
      camera.position.distanceTo(this.focus.set(subjectPose.x, ground, subjectPose.z)) * 0.85;

    // Bigger dinosaurs see further, and their shadows reach further.
    this.fog.near = 30 + 10 * zoom;
    this.fog.far = 120 + 30 * zoom;
    this.focus.set(subjectPose.x, ground, subjectPose.z);
    this.sun.follow(this.focus, 22 + 9 * zoom);
    this.updateDoom(timeMs);
    this.sky.position.copy(camera.position);
    this.food.update(dt, session.meat);
    this.noticeFood(player);
    this.smoke(timeMs);
    this.effects.update(dt, camera);
    this.sound.setListener(subjectPose.x, subjectPose.z);
    this.critters.update(dt, session.critters, (critter, out) => session.critterPose(critter, out));
    this.vents.update(session.time);
    this.carcasses.update(dt, session.carcasses, subjectPose, (carcass) => this.gripOf(carcass));
    this.beacons.update(session.happenings, time);
    animateLava(this.pools, time);
    this.water.update(time);
    this.pterosaurs.update(time);

    this.renderer.info.reset();
    if (this.post) this.post.render(camera);
    else this.renderer.render(this.scene, camera);
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

  /** Eating dinosaurs chew: a bite every CHEW_SECONDS, with a chomp and a few scraps flying. */
  private chew(id: number, timeMs: number): void {
    if (timeMs - (this.chewedAt.get(id) ?? Number.NEGATIVE_INFINITY) < CHEW_SECONDS * 1000) return;
    this.chewedAt.set(id, timeMs);
    const view = this.crowd.find(id);
    if (!view) return;
    view.chew();
    view.mouth(this.mouthAt);
    const scale = view.bodyScale;
    this.effects.burst('blood', this.mouthAt, 3, {
      speed: 2.2 * Math.sqrt(scale),
      size: 0.1 * scale,
      life: 0.6,
      color: 0x9c2a22,
      lift: 0.7,
    });
    this.sound.chomp(4 * scale, { x: this.mouthAt.x, z: this.mouthAt.z });
  }

  /** Footsteps, roars on evolving, and dust kicked up by sprinting. */
  private feel(
    dino: SessionDino,
    pose: { readonly x: number; readonly z: number; readonly speed: number },
    view: DinoView,
    dt: number,
    timeMs: number,
    isPlayer: boolean,
  ): void {
    const scale = view.bodyScale;
    const ground = heightAt(this.field, pose.x, pose.z);
    if (view.takeEvolution()) {
      this.effects.evolve({ x: pose.x, y: ground, z: pose.z }, scale);
      this.sound.roar(view.species, true, pose);
    }
    const walked = (this.strides.get(dino.id) ?? 0) + pose.speed * dt;
    if (walked > FOOTSTEP_SPACING * scale) {
      this.strides.set(dino.id, 0);
      if (isPlayer || scale > BIG_FOOTSTEPS_SCALE) this.sound.footstep(scale, pose);
      // The ground shakes under a giant's feet.
      const player = this.session.player;
      if (!isPlayer && scale > BIG_FOOTSTEPS_SCALE && player?.alive) {
        const distance = Math.hypot(player.x - pose.x, player.z - pose.z);
        const near = 1 - distance / EFFECTS.footstepShakeDistance;
        if (near > 0) this.cameraRig.shake(EFFECTS.footstepShake * near * Math.min(scale / 10, 1));
      }
    } else {
      this.strides.set(dino.id, walked);
    }
    if (
      (dino.sprinting || dino.chargingFor > 0) &&
      timeMs - (this.dustAt.get(dino.id) ?? 0) > DUST_EVERY_MS
    ) {
      this.dustAt.set(dino.id, timeMs);
      this.effects.burst('dust', { x: pose.x, y: ground + 0.1 * scale, z: pose.z }, 2, {
        speed: 1.2 * scale,
        size: 0.28 * scale,
        life: 0.7,
        color: 0xc8b48a,
        lift: 0.3,
      });
    }
  }

  /** A chomp and a spray of meat when the player gulps down some food. */
  private noticeFood(player: SessionDino): void {
    const gained = player.mass - this.lastMass;
    if (player.alive && this.lastMass > 0 && gained > 0.4 && !player.eating) {
      const view = this.crowd.find(player.id);
      if (view) {
        view.mouth(this.mouthAt);
        const scale = view.bodyScale;
        this.effects.burst('blood', this.mouthAt, 4 + Math.min(Math.round(gained), 10), {
          speed: 2.5 * Math.sqrt(scale),
          size: 0.1 * scale,
          life: 0.5,
          color: 0xb8352d,
          lift: 0.7,
        });
        if (dangerZoneAt(player.x, player.z) !== null) {
          this.effects.burst('spark', this.mouthAt, 16, {
            speed: 4 * Math.sqrt(scale),
            size: 0.3 * scale,
            life: 0.8,
            color: 0xffcf4a,
            lift: 0.8,
          });
        }
      }
      this.sound.chomp(gained);
    }
    this.lastMass = player.alive ? player.mass : 0;
  }

  /** The volcano smokes, and spits embers, more and more as the meteor nears. */
  private smoke(timeMs: number): void {
    if (timeMs < this.smokeAt) return;
    const doom =
      this.session.round.phase === 'playing'
        ? warningProgress(this.session.round.clock, this.session.round.settings)
        : 1;
    this.smokeAt = timeMs + SMOKE_EVERY_MS * (1 - 0.5 * doom);
    const crater = {
      x: (Math.random() - 0.5) * 6,
      y: VOLCANO.peakHeight - 3,
      z: (Math.random() - 0.5) * 6,
    };
    this.effects.burst('smoke', crater, 1, {
      speed: 2.5,
      size: 5 + 3 * doom,
      life: 10,
      color: doom > 0.5 ? 0x3a302c : 0x6c6560,
      lift: 0.95,
      spread: 0.2,
    });
    if (Math.random() < 0.3 + 0.5 * doom) {
      this.effects.burst('ember', crater, 3, {
        speed: 9,
        size: 0.9,
        life: 2.2,
        color: 0xff8a30,
        lift: 0.9,
      });
    }
  }

  /** Where to draw a carried carcass: in its carrier's jaws, wherever they are this frame. */
  private gripOf(carcass: SessionCarcass): Grip | undefined {
    const carrier =
      carcass.carrierId === null ? undefined : this.session.dinos.get(carcass.carrierId);
    if (!carrier?.alive) return undefined;
    const view = this.crowd.find(carrier.id);
    if (!view) return undefined;
    view.mouth(this.grip.mouth);
    this.grip.heading = (this.poses.get(carrier.id) ?? carrier).heading;
    return this.grip;
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
    this.clouds.update(timeMs / 1000, doom);
    this.impactFlash.style.opacity = flash.toFixed(3);
    this.cameraRig.rumble(phase === 'playing' ? EFFECTS.meteorRumble * doom : 0);
    this.sound.setRumble(phase === 'playing' ? doom : 0);
    this.sound.update(timeMs / 1000, doom);
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
    this.abilityPanel.update(tierForMass(player.mass).ability, player.abilityCooldown);
    // Spat in the eyes: the world goes blurry and green, clearing as it wears off.
    const blur = player.alive ? Math.min(player.blurredFor / BLUR_FADE_SECONDS, 1) : 0;
    this.canvas.style.filter = blur > 0 ? `blur(${(blur * BLUR_PIXELS).toFixed(1)}px)` : '';
    this.splat.style.opacity = blur.toFixed(2);
    if (player.carrying && !this.wasCarrying && player.alive) this.sound.grab();
    this.wasCarrying = player.carrying;
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
    if (round.phase === 'podium' && this.lastPhase !== 'podium')
      this.sound.podium(this.placeAtImpact);
    this.lastPhase = round.phase;
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
        scraps: this.scrapsAlive(),
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
    } else if (this.carcassInReach(player)) {
      chips.push({
        kind: 'carrying',
        text: this.touchFirst ? 'Hold Eat to eat this carcass' : 'Hold E to eat this carcass',
      });
    }
    if (player.stunnedFor > 0) chips.push({ kind: 'stunned', text: 'Stunned!' });
    if (player.blurredFor > 0) chips.push({ kind: 'blurred', text: 'Spat in the eyes!' });
    if (player.chargingFor > 0) chips.push({ kind: 'charging', text: 'Charging!' });
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

  /** Whether a carcass on the ground is close enough to eat from (as GameWorld decides it). */
  private carcassInReach(player: SessionDino): boolean {
    const zone = attackZone(player, player.mass);
    const body = bodyRadius(player.mass);
    for (const carcass of this.session.carcasses.values()) {
      if (carcass.carrierId !== null) continue;
      if (zoneTouches(zone, carcass.x, carcass.z, carcass.radius)) return true;
      if (Math.hypot(carcass.x - player.x, carcass.z - player.z) <= carcass.radius + body) {
        return true;
      }
    }
    return false;
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

  private scrapsAlive(): number {
    let alive = 0;
    for (const scrap of this.session.scraps) if (scrap.alive) alive++;
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
    this.post?.setSize(width, height, this.renderer.getPixelRatio());
    this.cameraRig.setAspect(width / height);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyM' && !event.repeat) {
      const muted = this.sound.toggleMute();
      this.banner.show(
        performance.now(),
        muted ? 'Sound off (M to turn it on)' : 'Sound on',
        'round',
      );
      return;
    }
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
          ability: player ? tierForMass(player.mass).ability : null,
          abilityCooldown: player?.abilityCooldown ?? 0,
          chargingFor: player?.chargingFor ?? 0,
          stunnedFor: player?.stunnedFor ?? 0,
          blurredFor: player?.blurredFor ?? 0,
          eatenBy: eater?.name ?? null,
          scrapsAlive: this.scrapsAlive(),
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
      triangleBreakdown: () => {
        const totals = new Map<string, number>();
        this.scene.traverseVisible((object) => {
          if (!(object instanceof Mesh)) return;
          const geometry = object.geometry as BufferGeometry;
          const perCopy = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
          const copies = object instanceof InstancedMesh ? object.count : 1;
          const name =
            [object.name, object.parent?.name ?? ''].find((label) => label !== '') ?? object.type;
          totals.set(name, (totals.get(name) ?? 0) + perCopy * copies);
        });
        return [...totals]
          .map(([name, triangles]) => ({ name, triangles: Math.round(triangles) }))
          .sort((a, b) => b.triangles - a.triangles);
      },
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
            stunnedFor: dino.stunnedFor,
            blurredFor: dino.blurredFor,
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
      placeScrapAhead: (distance) => {
        if (!session.test.placeScrapAhead) throw offlineOnly('placeScrapAhead');
        session.test.placeScrapAhead(distance);
      },
      placeDinoAhead: (mass, distance, facing, side, behaviour) => {
        if (!session.test.placeDinoAhead) throw offlineOnly('placeDinoAhead');
        return session.test.placeDinoAhead(mass, distance, facing, side, behaviour);
      },
    };
  }
}
