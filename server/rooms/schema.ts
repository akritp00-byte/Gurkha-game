import { schema, t } from '@colyseus/schema';
import type { NetCritter, NetDino, NetEgg, NetMeat } from '@extinct/shared';

/**
 * The room state as clients receive it. Each collection is filtered per client by a
 * StateView: a client only gets the entities near it, and never a small dinosaur hidden in
 * ferns further than FERNS.revealDistance away (BUILD_PROMPT.md §3 and §5).
 */

export const DinoState = schema(
  {
    name: t.string().default(''),
    bot: t.boolean().default(false),
    /** The controlling player's session id ('' for bots), so each client can find its own. */
    owner: t.string().default(''),
    x: t.float32().default(0),
    z: t.float32().default(0),
    heading: t.float32().default(0),
    speed: t.float32().default(0),
    pushX: t.float32().default(0),
    pushZ: t.float32().default(0),
    mass: t.float32().default(0),
    alive: t.boolean().default(false),
    sprinting: t.boolean().default(false),
    protectedFor: t.float32().default(0),
    respawnIn: t.float32().default(0),
    /** Id of whoever ate this dinosaur last, 0 if nobody. */
    eatenBy: t.uint16().default(0),
    massAtDeath: t.float32().default(0),
  },
  'Dino',
);
export type DinoState = InstanceType<typeof DinoState>;

export const EggState = schema(
  { x: t.float32().default(0), z: t.float32().default(0), alive: t.boolean().default(false) },
  'Egg',
);
export type EggState = InstanceType<typeof EggState>;

/** `born` is the tick it was dropped, so clients can work out its age without updates. */
export const MeatState = schema(
  { x: t.float32().default(0), z: t.float32().default(0), born: t.uint32().default(0) },
  'Meat',
);
export type MeatState = InstanceType<typeof MeatState>;

export const CritterState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    heading: t.float32().default(0),
    speed: t.float32().default(0),
    alive: t.boolean().default(false),
  },
  'Critter',
);
export type CritterState = InstanceType<typeof CritterState>;

export const GameState = schema(
  {
    /** Ticks simulated so far: world time is tick / NETWORK.tickRate (the vents run on it). */
    tick: t.uint32().default(0),
    /** Keyed by dinosaur id; eggs by slot, meat and critters by id. */
    dinos: t.map(DinoState).view(),
    eggs: t.map(EggState).view(),
    meat: t.map(MeatState).view(),
    critters: t.map(CritterState).view(),
  },
  'GameState',
);
export type GameState = InstanceType<typeof GameState>;

/**
 * One tick of a player's input, as small integers (see WIRE_INPUT in shared/net.ts) so that
 * "not turning" is exactly zero.
 */
export const InputState = schema(
  { turn: t.int8().default(0), throttle: t.uint8().default(0), sprint: t.boolean().default(false) },
  'Input',
);
export type InputState = InstanceType<typeof InputState>;

// The schema must keep matching the protocol types clients read it through (shared/net.ts):
// if a field drifts, this stops compiling.
type Expect<T extends true> = T;
type Fits<Actual, Expected> = [Actual] extends [Expected] ? true : false;
export type SchemaMatchesProtocol = [
  Expect<Fits<DinoState, NetDino>>,
  Expect<Fits<EggState, NetEgg>>,
  Expect<Fits<MeatState, NetMeat>>,
  Expect<Fits<CritterState, NetCritter>>,
];
