import { schema, t } from '@colyseus/schema';
import type {
  NetCarcass,
  NetCritter,
  NetDino,
  NetScrap,
  NetHappening,
  NetMeat,
  NetRound,
  NetStanding,
} from '@extinct/shared';

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
    /** Id of whoever killed this dinosaur last, 0 if nobody. */
    eatenBy: t.uint16().default(0),
    massAtDeath: t.float32().default(0),
    rankAtDeath: t.uint8().default(0),
    /** Place on the leaderboard, 0 while dead. */
    rank: t.uint8().default(0),
    stamina: t.float32().default(1),
    winded: t.boolean().default(false),
    refillIn: t.float32().default(0),
    carrying: t.boolean().default(false),
    eating: t.boolean().default(false),
  },
  'Dino',
);
export type DinoState = InstanceType<typeof DinoState>;

export const ScrapState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    size: t.uint8().default(0),
    alive: t.boolean().default(false),
  },
  'Scrap',
);
export type ScrapState = InstanceType<typeof ScrapState>;

/** `born` is the tick it was dropped, so clients can work out its age without updates. */
export const MeatState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    size: t.uint8().default(0),
    born: t.uint32().default(0),
  },
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

/** `kind` and `carrier` are codes: see CARCASS_KIND_CODES in shared/net.ts; carrier 0 is nobody. */
export const CarcassState = schema(
  {
    x: t.float32().default(0),
    z: t.float32().default(0),
    heading: t.float32().default(0),
    food: t.float32().default(0),
    size: t.float32().default(0),
    radius: t.float32().default(0),
    kind: t.uint8().default(0),
    bodyMass: t.float32().default(0),
    variant: t.uint8().default(0),
    carrier: t.uint16().default(0),
  },
  'Carcass',
);
export type CarcassState = InstanceType<typeof CarcassState>;

/** A running world event, for everyone's minimap. Codes as in shared/net.ts. */
export const HappeningState = schema(
  {
    kind: t.uint8().default(0),
    variant: t.uint8().default(0),
    x: t.float32().default(0),
    z: t.float32().default(0),
    zone: t.uint8().default(0),
    food: t.float32().default(0),
  },
  'Happening',
);
export type HappeningState = InstanceType<typeof HappeningState>;

/** A place on the leaderboard or the podium. */
export const StandingState = schema(
  {
    dino: t.uint16().default(0),
    name: t.string().default(''),
    mass: t.float32().default(0),
    bot: t.boolean().default(false),
    x: t.float32().default(0),
    z: t.float32().default(0),
    shown: t.boolean().default(false),
  },
  'Standing',
);
export type StandingState = InstanceType<typeof StandingState>;

/** The round clock runs from `startTick`; the podium fills at the meteor's impact. */
export const RoundSchema = schema(
  {
    number: t.uint16().default(1),
    startTick: t.uint32().default(0),
    durationSeconds: t.float32().default(0),
    meteorWarningAtSeconds: t.float32().default(0),
    impactSequenceSeconds: t.float32().default(0),
    intermissionSeconds: t.float32().default(0),
    podium: t.array(StandingState),
  },
  'Round',
);
export type RoundSchema = InstanceType<typeof RoundSchema>;

export const GameState = schema(
  {
    /** Ticks simulated so far: world time is tick / NETWORK.tickRate (the vents run on it). */
    tick: t.uint32().default(0),
    /** Keyed by dinosaur id; scraps by slot, meat, critters and carcasses by id. */
    dinos: t.map(DinoState).view(),
    scraps: t.map(ScrapState).view(),
    meat: t.map(MeatState).view(),
    critters: t.map(CritterState).view(),
    carcasses: t.map(CarcassState).view(),
    /** Everyone gets these: world events (keyed by id), the round and the top ten. */
    happenings: t.map(HappeningState),
    round: t.ref(RoundSchema),
    leaderboard: t.array(StandingState),
  },
  'GameState',
);
export type GameState = InstanceType<typeof GameState>;

/**
 * One tick of a player's input, as small integers (see WIRE_INPUT in shared/net.ts) so that
 * "not turning" is exactly zero.
 */
export const InputState = schema(
  {
    turn: t.int8().default(0),
    throttle: t.uint8().default(0),
    sprint: t.boolean().default(false),
    bite: t.boolean().default(false),
    eat: t.boolean().default(false),
  },
  'Input',
);
export type InputState = InstanceType<typeof InputState>;

// The schema must keep matching the protocol types clients read it through (shared/net.ts):
// if a field drifts, this stops compiling.
type Expect<T extends true> = T;
type Fits<Actual, Expected> = [Actual] extends [Expected] ? true : false;
export type SchemaMatchesProtocol = [
  Expect<Fits<DinoState, NetDino>>,
  Expect<Fits<ScrapState, NetScrap>>,
  Expect<Fits<MeatState, NetMeat>>,
  Expect<Fits<CritterState, NetCritter>>,
  Expect<Fits<CarcassState, NetCarcass>>,
  Expect<Fits<HappeningState, NetHappening>>,
  Expect<Fits<StandingState, NetStanding>>,
  Expect<Fits<RoundSchema, NetRound>>,
];
