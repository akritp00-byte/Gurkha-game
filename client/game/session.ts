import type {
  DangerZoneId,
  HappeningKind,
  MeatSize,
  NetEvent,
  PlayerInput,
  RoundPhase,
  RoundSettings,
  ScrapSlot,
} from '@extinct/shared';
import type { PoseSample } from './poseHistory.ts';

/** A dinosaur as the renderer and the interface see it. */
export interface SessionDino {
  readonly id: number;
  readonly name: string;
  readonly isBot: boolean;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly mass: number;
  readonly alive: boolean;
  readonly protectedFor: number;
  readonly sprinting: boolean;
  readonly respawnIn: number;
  /** Id of whoever killed it last, if anyone. */
  readonly eatenBy: number | null;
  readonly massAtDeath: number;
  /** Leaderboard place when it was last killed. */
  readonly rankAtDeath: number;
  /** Place on the leaderboard (1 is the biggest), 0 while dead. */
  readonly rank: number;
  /** Sprint bar, 0 to 1, and whether it's run dry. */
  readonly stamina: number;
  readonly winded: boolean;
  /** Has a carcass in its mouth, and is eating this tick. */
  readonly carrying: boolean;
  readonly eating: boolean;
}

/** A carcass, carried in a mouth or lying on the ground. */
export interface SessionCarcass {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly food: number;
  /** Food it started with. */
  readonly size: number;
  readonly radius: number;
  readonly kind: 'kill' | 'event';
  /** A kill is drawn as the victim's body: its mass when it died. 0 for an event carcass. */
  readonly bodyMass: number;
  /** An event carcass's species (an index into CARCASS_SPECIES). */
  readonly variant: number;
  readonly carrierId: number | null;
}

/** A running world event. */
export interface SessionHappening {
  readonly id: number;
  readonly kind: HappeningKind;
  readonly variant: number;
  readonly x: number;
  readonly z: number;
  readonly zone: DangerZoneId | null;
  readonly food: number;
}

/** A place on the leaderboard or podium, with a coarse position if the minimap may show it. */
export interface SessionStanding {
  readonly dinoId: number;
  readonly name: string;
  readonly mass: number;
  readonly isBot: boolean;
  readonly x: number;
  readonly z: number;
  readonly shown: boolean;
}

/** Where the round is. `clock` is seconds since it started, smooth for display. */
export interface SessionRound {
  readonly number: number;
  readonly clock: number;
  readonly phase: RoundPhase;
  readonly settings: RoundSettings;
  /** The winners, biggest first, once the meteor has hit. */
  readonly podium: readonly SessionStanding[];
}

export interface SessionMeat {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly size: MeatSize;
  /** Seconds since it was dropped. */
  readonly age: number;
}

export interface SessionCritter {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly alive: boolean;
}

/** Something to react to: the server's events, plus scrap changes worth animating. */
export type SessionEvent =
  | NetEvent
  | { readonly type: 'scrapEaten'; readonly slot: number }
  | { readonly type: 'scrapSpawned'; readonly slot: number };

/**
 * What a bot placed by a test does: carry on as normal (`roam`), stand `still` for a minute,
 * or `hunt` the player single-mindedly, biting the moment it can.
 */
export type BotBehaviour = 'roam' | 'still' | 'hunt';

export interface BotSummary {
  id: number;
  name: string;
  x: number;
  z: number;
  mass: number;
  alive: boolean;
  mode: string;
}

/**
 * Hooks for browser tests and the console. Online, they become test commands that only a test
 * server (`pnpm dev`) obeys; the optional ones exist offline only.
 */
export interface TestHooks {
  setMass(mass: number): void;
  teleport(x: number, z: number, heading?: number): void;
  endProtection(): void;
  /** Start a world event `ahead` units in front of the player (or somewhere random). */
  startEvent(kind: HappeningKind, ahead?: number): void;
  placeScrapAhead?(distance: number): void;
  placeDinoAhead?(
    mass: number,
    distance: number,
    facing: 'toward' | 'away',
    side?: number,
    behaviour?: BotBehaviour,
  ): number;
  bots?(): BotSummary[];
}

/**
 * Where the world comes from: the shared simulation running in the browser (offline) or a game
 * server (online). The Game draws and controls whichever it's given.
 */
export interface Session {
  readonly mode: 'offline' | 'online';
  /** The player's own dinosaur, once it exists. */
  readonly player: SessionDino | undefined;
  readonly dinos: ReadonlyMap<number, SessionDino>;
  /** One slot per scrap (SCRAPS.count); online, scraps out of view read as not alive. */
  readonly scraps: readonly ScrapSlot[];
  readonly meat: ReadonlyMap<number, SessionMeat>;
  /** Indexed by critter id. */
  readonly critters: readonly SessionCritter[];
  readonly carcasses: ReadonlyMap<number, SessionCarcass>;
  /** World events still running (everyone knows about them, near or far). */
  readonly happenings: ReadonlyMap<number, SessionHappening>;
  readonly round: SessionRound;
  /** The top ten, biggest first. */
  readonly leaderboard: readonly SessionStanding[];
  /** World time in seconds (the vents run on it), smooth for rendering. */
  readonly time: number;
  /** Round trip to the server in ms; null offline. */
  readonly pingMs: number | null;
  readonly test: TestHooks;
  /** Take this frame's input and bring the world up to date. Returns what happened since. */
  advance(nowMs: number, dt: number, input: PlayerInput): readonly SessionEvent[];
  /** Where to draw a dinosaur this frame (interpolated, or predicted for your own). */
  dinoPose(dino: SessionDino, out: PoseSample): PoseSample;
  critterPose(critter: SessionCritter, out: PoseSample): PoseSample;
  dispose(): void;
}
