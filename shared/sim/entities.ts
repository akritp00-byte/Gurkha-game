/** A dinosaur in the simulation: a player or a bot. */
export interface Dino {
  readonly id: number;
  readonly name: string;
  readonly isBot: boolean;
  x: number;
  z: number;
  /** Facing in radians (see Motion in movement.ts). */
  heading: number;
  speed: number;
  /** External push velocity, e.g. from a vent blast. */
  pushX: number;
  pushZ: number;
  mass: number;
  alive: boolean;
  /** Seconds until a dead dinosaur comes back. */
  respawnIn: number;
  /** Seconds of spawn protection left: it can't eat dinosaurs or be eaten. */
  protectedFor: number;
  /** Sprinting this tick: holding sprint while moving, with mass to burn. */
  sprinting: boolean;
  /** Mass burnt by sprinting that hasn't been dropped as meat yet. */
  meatOwed: number;
  /** Seconds until this dinosaur may drop another chunk of meat. */
  meatCooldown: number;
  /** Who ate this dinosaur most recently (for the death screen), if anyone. */
  eatenBy: number | null;
  /** Mass at the moment it was last eaten. */
  massAtDeath: number;
}

/** One egg's slot. An eaten egg waits out a timer, then reappears somewhere else. */
export interface EggSlot {
  x: number;
  z: number;
  alive: boolean;
  /** Seconds until an eaten egg reappears. */
  respawnIn: number;
}

/** A chunk of meat dropped behind a sprinting dinosaur. */
export interface MeatChunk {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Seconds since it was dropped; it rots away at MEAT.lifetimeSeconds. */
  age: number;
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
  /** Where a wandering critter is heading, and seconds until it picks somewhere else. */
  wanderHeading: number;
  wanderIn: number;
}

export type WorldEvent =
  | { readonly type: 'eggEaten'; readonly dinoId: number; readonly slot: number }
  | { readonly type: 'eggSpawned'; readonly slot: number }
  | { readonly type: 'meatDropped'; readonly meatId: number; readonly dinoId: number }
  | { readonly type: 'meatEaten'; readonly meatId: number; readonly dinoId: number }
  | { readonly type: 'meatRotted'; readonly meatId: number }
  | { readonly type: 'critterEaten'; readonly critterId: number; readonly dinoId: number }
  | { readonly type: 'critterSpawned'; readonly critterId: number }
  | {
      readonly type: 'dinoEaten';
      readonly eaterId: number;
      readonly victimId: number;
      readonly massGained: number;
    }
  | { readonly type: 'dinoSpawned'; readonly dinoId: number }
  | {
      readonly type: 'tierChanged';
      readonly dinoId: number;
      readonly tier: number;
      readonly previousTier: number;
    }
  | { readonly type: 'ventRumbling'; readonly vent: number }
  | { readonly type: 'ventErupted'; readonly vent: number };

/** Everything a bot can look at when deciding what to do. GameWorld provides this. */
export interface WorldSenses {
  readonly dinos: ReadonlyMap<number, Dino>;
  readonly eggs: readonly EggSlot[];
  readonly meat: ReadonlyMap<number, MeatChunk>;
  readonly critters: readonly Critter[];
}
