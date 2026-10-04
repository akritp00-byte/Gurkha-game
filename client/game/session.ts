import type { EggSlot, MoveInput, NetEvent } from '@extinct/shared';
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
  /** Id of whoever ate it last, if anyone. */
  readonly eatenBy: number | null;
  readonly massAtDeath: number;
}

export interface SessionMeat {
  readonly id: number;
  readonly x: number;
  readonly z: number;
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

/** Something to react to: the server's events, plus egg changes worth animating. */
export type SessionEvent =
  | NetEvent
  | { readonly type: 'eggEaten'; readonly slot: number }
  | { readonly type: 'eggSpawned'; readonly slot: number };

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
  placeEggAhead?(distance: number): void;
  placeDinoAhead?(mass: number, distance: number, facing: 'toward' | 'away', side?: number): number;
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
  /** One slot per egg (FOOD.eggCount); online, eggs out of view read as not alive. */
  readonly eggs: readonly EggSlot[];
  readonly meat: ReadonlyMap<number, SessionMeat>;
  /** Indexed by critter id. */
  readonly critters: readonly SessionCritter[];
  /** World time in seconds (the vents run on it), smooth for rendering. */
  readonly time: number;
  /** Round trip to the server in ms; null offline. */
  readonly pingMs: number | null;
  readonly test: TestHooks;
  /** Take this frame's input and bring the world up to date. Returns what happened since. */
  advance(nowMs: number, dt: number, input: MoveInput): readonly SessionEvent[];
  /** Where to draw a dinosaur this frame (interpolated, or predicted for your own). */
  dinoPose(dino: SessionDino, out: PoseSample): PoseSample;
  critterPose(critter: SessionCritter, out: PoseSample): PoseSample;
  dispose(): void;
}
