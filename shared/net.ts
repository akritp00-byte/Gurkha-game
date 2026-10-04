import { clamp } from './math.ts';
import type { PlayerInput } from './movement.ts';
import type { HappeningKind, MeatSize } from './sim/entities.ts';
import type { DangerZoneId } from './world/layout.ts';

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

/** Options a client joins with. `bots`, `seed` and `roundSeconds` only count on a test server. */
export interface JoinOptions {
  name?: string;
  /** Join (or create) the room with this tag, e.g. one per browser test. */
  room?: string;
  bots?: number;
  seed?: number;
  /** Round length, so browser tests can play a whole round quickly. */
  roundSeconds?: number;
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
  bite: boolean;
  eat: boolean;
}

export function toWireInput(input: PlayerInput, out: WireInput): WireInput {
  out.turn = Math.round(clamp(input.turn, -1, 1) * WIRE_INPUT.turn);
  out.throttle = Math.round(clamp(input.throttle, 0, 1) * WIRE_INPUT.throttle);
  out.sprint = input.sprint;
  out.bite = input.bite;
  out.eat = input.eat;
  return out;
}

/** Decode a wire input; anything malformed counts as no input. */
export function fromWireInput(wire: { readonly [K in keyof WireInput]?: unknown }): PlayerInput {
  const turn = typeof wire.turn === 'number' && Number.isFinite(wire.turn) ? wire.turn : 0;
  const throttle =
    typeof wire.throttle === 'number' && Number.isFinite(wire.throttle) ? wire.throttle : 0;
  return {
    turn: clamp(turn / WIRE_INPUT.turn, -1, 1),
    throttle: clamp(throttle / WIRE_INPUT.throttle, 0, 1),
    sprint: wire.sprint === true,
    bite: wire.bite === true,
    eat: wire.eat === true,
  };
}

/** Kinds and zones travel as small numbers: their index in these lists. */
export const CARCASS_KIND_CODES = ['kill', 'event'] as const;
export const HAPPENING_KIND_CODES = [
  'carcass',
  'meatDrop',
] as const satisfies readonly HappeningKind[];
export const ZONE_CODES = [
  null,
  'ashlands',
  'tarPits',
] as const satisfies readonly (DangerZoneId | null)[];

export function zoneCode(zone: DangerZoneId | null): number {
  return ZONE_CODES.indexOf(zone);
}

export function zoneFromCode(code: number): DangerZoneId | null {
  return ZONE_CODES[code] ?? null;
}

/** A meat size sent as a number, kept to the sizes there are. */
export function meatSizeOf(code: number): MeatSize {
  return code >= 2 ? 2 : code >= 1 ? 1 : 0;
}

/** Events the server sends a client after a tick: only those it should hear about. */
export type NetEvent =
  /** A dinosaur this client can see bit something, or ate some food. */
  | { readonly type: 'bite'; readonly dinoId: number }
  /** Sent to everyone, for the kill feed; names travel along since the dinosaurs may be out of view. */
  | {
      readonly type: 'dinoKilled';
      readonly killerId: number;
      readonly victimId: number;
      readonly killerName: string;
      readonly victimName: string;
      /** Both masses at the moment of the kill, and the victim's place on the leaderboard. */
      readonly killerMass: number;
      readonly victimMass: number;
      readonly victimRank: number;
    }
  /** A bite knocked this dinosaur back (and loose of anything it carried). */
  | { readonly type: 'shoved'; readonly dinoId: number; readonly byId: number }
  | { readonly type: 'dinoSpawned'; readonly dinoId: number }
  /** Only to the dinosaur's own player. */
  | {
      readonly type: 'tierChanged';
      readonly dinoId: number;
      readonly tier: number;
      readonly previousTier: number;
    }
  | { readonly type: 'ventErupted'; readonly vent: number }
  /** A world event started (to everyone, for the announcement). */
  | {
      readonly type: 'happening';
      readonly id: number;
      readonly kind: HappeningKind;
      /** Which carcass species (an index into CARCASS_SPECIES). */
      readonly variant: number;
      readonly x: number;
      readonly z: number;
      readonly zone: DangerZoneId | null;
      readonly food: number;
    }
  | { readonly type: 'meteorWarning' }
  | { readonly type: 'meteorImpact' }
  | { readonly type: 'roundStarted'; readonly round: number };

/** Test commands, for browser tests against a dev server. They act on the sender's own dinosaur. */
export type TestCommand =
  | { readonly cmd: 'setMass'; readonly mass: number }
  | { readonly cmd: 'teleport'; readonly x: number; readonly z: number; readonly heading?: number }
  | { readonly cmd: 'endProtection' }
  /** Start a world event this many units in front of the dinosaur (or somewhere random). */
  | { readonly cmd: 'startEvent'; readonly kind: HappeningKind; readonly ahead?: number };

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
  /** Id of whoever killed it last, 0 if nobody. */
  readonly eatenBy: number;
  readonly massAtDeath: number;
  /** Leaderboard place when it was killed. */
  readonly rankAtDeath: number;
  /** Place on the leaderboard (1 is the biggest), 0 while dead. */
  readonly rank: number;
  readonly stamina: number;
  readonly winded: boolean;
  readonly refillIn: number;
  /** Has a carcass in its mouth. */
  readonly carrying: boolean;
  readonly eating: boolean;
}

export interface NetScrap {
  readonly x: number;
  readonly z: number;
  /** An index into MEAT_SIZES. */
  readonly size: number;
  readonly alive: boolean;
}

export interface NetMeat {
  readonly x: number;
  readonly z: number;
  /** An index into MEAT_SIZES. */
  readonly size: number;
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

/** A carcass, carried or on the ground. `kind` and `carrier` are codes (see CARCASS_KIND_CODES). */
export interface NetCarcass {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly food: number;
  /** Food it started with. */
  readonly size: number;
  readonly radius: number;
  readonly kind: number;
  /** A kill's victim mass, so it's drawn as that body; 0 for an event carcass. */
  readonly bodyMass: number;
  /** An event carcass's species (an index into CARCASS_SPECIES). */
  readonly variant: number;
  /** Id of the dinosaur carrying it, 0 if it's on the ground. */
  readonly carrier: number;
}

/** A running world event, sent to everyone for the minimap. */
export interface NetHappening {
  readonly kind: number;
  readonly variant: number;
  readonly x: number;
  readonly z: number;
  readonly zone: number;
  readonly food: number;
}

/** A place on the leaderboard or the podium. Leaders' positions are coarse, for the minimap. */
export interface NetStanding {
  readonly dino: number;
  readonly name: string;
  readonly mass: number;
  readonly bot: boolean;
  readonly x: number;
  readonly z: number;
  /** Whether the minimap may show it (dinosaurs hidden in ferns stay off it). */
  readonly shown: boolean;
}

/** The round: its number, the tick it started on, its timings, and once it's over, the podium. */
export interface NetRound {
  readonly number: number;
  readonly startTick: number;
  readonly durationSeconds: number;
  readonly meteorWarningAtSeconds: number;
  readonly impactSequenceSeconds: number;
  readonly intermissionSeconds: number;
  readonly podium: ArrayLike<NetStanding>;
}
