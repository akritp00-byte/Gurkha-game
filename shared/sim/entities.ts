import type { AbilityId } from '../config.ts';
import type { Locomotion } from '../movement.ts';
import type { DangerZoneId } from '../world/layout.ts';
import type { RoundPhase, RoundSettings, Standing } from './round.ts';

/** A dinosaur in the simulation: a player or a bot. */
export interface Dino extends Locomotion {
  readonly id: number;
  readonly name: string;
  readonly isBot: boolean;
  mass: number;
  alive: boolean;
  /** Seconds until a dead dinosaur comes back. */
  respawnIn: number;
  /** Seconds of spawn protection left: it can't kill or be killed. */
  protectedFor: number;
  /** Seconds until it can bite again. */
  biteCooldown: number;
  /** The carcass in its mouth, if any. */
  carryingId: number | null;
  /** Has a carcass in its mouth (kept in step with carryingId; movement reads it). */
  carrying: boolean;
  /** Ate from a carcass this tick (holding E with something to eat). */
  eating: boolean;
  /** Who killed this dinosaur most recently (for the death screen), if anyone. */
  eatenBy: number | null;
  /** Mass and leaderboard place at the moment it was last killed. */
  massAtDeath: number;
  rankAtDeath: number;
  /** Place on the leaderboard (1 is the biggest), 0 while dead. Updated every tick. */
  rank: number;
  /** Seconds of blurred sight left, from being spat at. */
  blurredFor: number;
}

/** Meat comes in three sizes: an index into MEAT_SIZES (a scrap, a cut or a haunch). */
export type MeatSize = 0 | 1 | 2;

/**
 * One scrap of meat's slot. An eaten scrap waits out a timer, then reappears somewhere else,
 * maybe bigger or smaller. Rich slots always reappear in a danger zone.
 */
export interface ScrapSlot {
  x: number;
  z: number;
  size: MeatSize;
  /** This slot belongs to the danger zones. */
  readonly rich: boolean;
  alive: boolean;
  /** Seconds until an eaten scrap reappears. */
  respawnIn: number;
}

/** A chunk of meat, scattered by a world event. */
export interface MeatChunk {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly size: MeatSize;
  /** Seconds since it landed; it rots away at MEAT.lifetimeSeconds. */
  age: number;
  /** The world event that scattered it. */
  readonly happeningId: number | null;
}

/** A small fleeing critter. Critters keep their slot (id) and respawn after being eaten. */
export interface Critter {
  readonly id: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  alive: boolean;
  respawnIn: number;
  fleeing: boolean;
  /** Seconds of bolting left before it tires, and of rest left once it has. */
  boltLeft: number;
  restLeft: number;
  /** Where a wandering critter is heading, and seconds until it picks somewhere else. */
  wanderHeading: number;
  wanderIn: number;
}

/**
 * A carcass: what a kill leaves, or a huge one from a world event. It's either in a
 * dinosaur's mouth (`carrierId`) or lying on the ground, and anyone holding E with it in reach
 * eats from it until the food runs out.
 */
export interface Carcass {
  readonly id: number;
  x: number;
  z: number;
  heading: number;
  /** Food left in it. */
  food: number;
  /** Food it started with (its size on screen shrinks as it's eaten). */
  readonly size: number;
  /** Bites and mouths reach it within this radius of its middle. */
  readonly radius: number;
  readonly kind: 'kill' | 'event';
  /** A kill is drawn as the victim's body: its mass when it died. 0 for an event carcass. */
  readonly bodyMass: number;
  /** An event carcass's species (an index into CARCASS_SPECIES). 0 for a kill. */
  readonly variant: number;
  carrierId: number | null;
  /** Seconds it has lain on the ground. It rots at `lifetime`. */
  age: number;
  readonly lifetime: number;
  readonly happeningId: number | null;
}

export type HappeningKind = 'carcass' | 'meatDrop';

/** A random world event: announced to everyone and shown on the minimap. */
export interface Happening {
  readonly id: number;
  readonly kind: HappeningKind;
  readonly x: number;
  readonly z: number;
  readonly zone: DangerZoneId | null;
  /** Food it brought onto the island. */
  readonly food: number;
  /** Which carcass species it is (an index into CARCASS_SPECIES), for the announcement. */
  readonly variant: number;
  /** Seconds since it started. */
  age: number;
}

/** Where the round is: its number, its clock and, once the meteor has hit, who won. */
export interface RoundState {
  number: number;
  /** Seconds since this round started (see sim/round.ts). */
  clock: number;
  phase: RoundPhase;
  readonly settings: RoundSettings;
  /** The biggest dinosaurs at the moment of impact, biggest first. Empty until then. */
  podium: Standing[];
}

/** What a bite did. */
export type BiteOutcome = 'kill' | 'grab' | 'drop' | 'shove' | 'miss';

export type WorldEvent =
  | { readonly type: 'scrapEaten'; readonly dinoId: number; readonly slot: number }
  | { readonly type: 'scrapSpawned'; readonly slot: number }
  | { readonly type: 'meatDropped'; readonly meatId: number }
  | { readonly type: 'meatEaten'; readonly meatId: number; readonly dinoId: number }
  | { readonly type: 'meatRotted'; readonly meatId: number }
  | { readonly type: 'critterEaten'; readonly critterId: number; readonly dinoId: number }
  | { readonly type: 'critterSpawned'; readonly critterId: number }
  | { readonly type: 'bite'; readonly dinoId: number; readonly outcome: BiteOutcome }
  /** A dinosaur used its ability (a pounce, spit, charge or roar). */
  | { readonly type: 'ability'; readonly dinoId: number; readonly ability: AbilityId }
  /** A spit hit this dinosaur in the eyes. */
  | { readonly type: 'spat'; readonly targetId: number; readonly byId: number }
  /** A roar stunned this dinosaur. */
  | { readonly type: 'stunned'; readonly dinoId: number; readonly byId: number }
  | {
      readonly type: 'dinoKilled';
      readonly killerId: number;
      readonly victimId: number;
      readonly carcassId: number;
    }
  | { readonly type: 'shoved'; readonly dinoId: number; readonly byId: number }
  | { readonly type: 'carcassEaten'; readonly carcassId: number; readonly dinoId: number }
  | { readonly type: 'carcassRotted'; readonly carcassId: number }
  | { readonly type: 'dinoSpawned'; readonly dinoId: number }
  | {
      readonly type: 'tierChanged';
      readonly dinoId: number;
      readonly tier: number;
      readonly previousTier: number;
    }
  | { readonly type: 'ventRumbling'; readonly vent: number }
  | { readonly type: 'ventErupted'; readonly vent: number }
  | { readonly type: 'happeningStarted'; readonly happeningId: number }
  | { readonly type: 'happeningEnded'; readonly happeningId: number }
  | { readonly type: 'meteorWarning' }
  | { readonly type: 'meteorImpact' }
  | { readonly type: 'roundStarted'; readonly round: number };

/** Everything a bot can look at when deciding what to do. GameWorld provides this. */
export interface WorldSenses {
  readonly dinos: ReadonlyMap<number, Dino>;
  readonly scraps: readonly ScrapSlot[];
  readonly meat: ReadonlyMap<number, MeatChunk>;
  readonly critters: readonly Critter[];
  readonly carcasses: ReadonlyMap<number, Carcass>;
}
