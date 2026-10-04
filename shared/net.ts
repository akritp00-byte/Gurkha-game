import { clamp } from './math.ts';
import type { MoveInput } from './movement.ts';

/**
 * The client–server protocol (BUILD_PROMPT.md §5). Room state itself is a Colyseus schema in
 * server/rooms/schema.ts; this file holds everything both sides must agree on beyond that.
 */

/** The matchmaking name of the game room. */
export const ROOM_NAME = 'game';

/** Message types. */
export const MESSAGE = {
  /** Server → client after a tick: the events this client should know about. */
  events: 'events',
  /** Client → server: a test command, honoured only by a server started with --test-commands. */
  test: 'test',
} as const;

/** Options a client joins with. `bots` and `seed` only count on a test server. */
export interface JoinOptions {
  name?: string;
  /** Join (or create) the room with this tag, e.g. one per browser test. */
  room?: string;
  bots?: number;
  seed?: number;
}

/**
 * Inputs travel as small integers, so that "not turning" and "standing still" are exact:
 * turn from -127 (full right) to 127 (full left), throttle from 0 to 255.
 */
export const WIRE_INPUT = { turn: 127, throttle: 255 } as const;

export interface WireInput {
  turn: number;
  throttle: number;
  sprint: boolean;
}

export function toWireInput(input: MoveInput, out: WireInput): WireInput {
  out.turn = Math.round(clamp(input.turn, -1, 1) * WIRE_INPUT.turn);
  out.throttle = Math.round(clamp(input.throttle, 0, 1) * WIRE_INPUT.throttle);
  out.sprint = input.sprint;
  return out;
}

/** Decode a wire input; anything malformed counts as no input. */
export function fromWireInput(wire: { readonly [K in keyof WireInput]?: unknown }): MoveInput {
  const turn = typeof wire.turn === 'number' && Number.isFinite(wire.turn) ? wire.turn : 0;
  const throttle =
    typeof wire.throttle === 'number' && Number.isFinite(wire.throttle) ? wire.throttle : 0;
  return {
    turn: clamp(turn / WIRE_INPUT.turn, -1, 1),
    throttle: clamp(throttle / WIRE_INPUT.throttle, 0, 1),
    sprint: wire.sprint === true,
  };
}

/** Events the server sends a client after a tick: only those it should hear about. */
export type NetEvent =
  /** A dinosaur this client can see ate some food. */
  | { readonly type: 'bite'; readonly dinoId: number }
  /** Sent to everyone, for the kill feed; names travel along since the dinosaurs may be out of view. */
  | {
      readonly type: 'dinoEaten';
      readonly eaterId: number;
      readonly victimId: number;
      readonly eaterName: string;
      readonly victimName: string;
      /** The eater's mass after the meal, and the victim's when it was eaten. */
      readonly eaterMass: number;
      readonly victimMass: number;
    }
  | { readonly type: 'dinoSpawned'; readonly dinoId: number }
  /** Only to the dinosaur's own player. */
  | {
      readonly type: 'tierChanged';
      readonly dinoId: number;
      readonly tier: number;
      readonly previousTier: number;
    }
  | { readonly type: 'ventErupted'; readonly vent: number };

/** Test commands, for browser tests against a dev server. They act on the sender's own dinosaur. */
export type TestCommand =
  | { readonly cmd: 'setMass'; readonly mass: number }
  | { readonly cmd: 'teleport'; readonly x: number; readonly z: number; readonly heading?: number }
  | { readonly cmd: 'endProtection' };

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * A player name: printable, trimmed, at most `maxLength` characters (counting an emoji as
 * one), or `fallback`.
 */
export function cleanName(raw: unknown, maxLength: number, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const characters = Array.from(graphemes.segment(raw.replace(/\s+/g, ' ').trim()))
    .map((part) => part.segment)
    .filter((character) => character >= ' ' && character !== '\u007f');
  const name = characters.slice(0, maxLength).join('').trim();
  return name === '' ? fallback : name;
}

/*
 * The shape of the synced room state as clients read it. The server defines it as a Colyseus
 * schema (server/rooms/schema.ts, checked against these at compile time); clients decode it
 * without the schema classes, so they code against these interfaces.
 */

export interface NetDino {
  readonly name: string;
  readonly bot: boolean;
  /** Session id of the controlling player, '' for bots. */
  readonly owner: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly pushX: number;
  readonly pushZ: number;
  readonly mass: number;
  readonly alive: boolean;
  readonly sprinting: boolean;
  readonly protectedFor: number;
  readonly respawnIn: number;
  /** Id of whoever ate it last, 0 if nobody. */
  readonly eatenBy: number;
  readonly massAtDeath: number;
}

export interface NetEgg {
  readonly x: number;
  readonly z: number;
  readonly alive: boolean;
}

export interface NetMeat {
  readonly x: number;
  readonly z: number;
  /** The tick it was dropped on. */
  readonly born: number;
}

export interface NetCritter {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly alive: boolean;
}
