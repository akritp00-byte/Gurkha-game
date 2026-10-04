/**
 * The look of each tier's dinosaur: proportions, colours, patterns and features. Lengths are
 * relative; every species is rescaled so its snout sits at the shared bite reach, and in-game
 * size then comes from `scaleForMass`.
 */

export type Pattern = 'stripes' | 'spots' | 'bands' | 'mottled';

export interface Anatomy {
  /** Torso from the hips to the shoulders: length, half-depth and half-width. */
  readonly body: { readonly length: number; readonly depth: number; readonly width: number };
  /** How far the chest hangs below the hips. */
  readonly chestDrop: number;
  readonly neck: { readonly length: number; readonly rise: number; readonly thickness: number };
  readonly head: {
    readonly length: number;
    readonly depth: number;
    readonly width: number;
    /** Snout depth as a share of the skull's depth. */
    readonly snout: number;
    /** Lower jaw depth as a share of the skull's depth. */
    readonly jaw: number;
  };
  /** How far the tail tip rises above (or droops below) its base. */
  readonly tail: { readonly length: number; readonly thickness: number; readonly lift: number };
  /** Bird-like legs: thigh, shin and the long foot bone, plus thickness at the hip. */
  readonly leg: {
    readonly thigh: number;
    readonly shin: number;
    readonly foot: number;
    readonly thickness: number;
  };
  readonly arm: { readonly length: number; readonly thickness: number };
  readonly crest: boolean;
  readonly browHorns: boolean;
  readonly feathers: 'fuzz' | 'wings' | null;
  readonly sickleClaw: boolean;
  readonly backRidge: 'spikes' | 'scutes' | null;
  readonly pattern: Pattern;
  readonly colors: {
    readonly body: number;
    readonly belly: number;
    /** Stripes, spots or bands. */
    readonly marking: number;
    /** Crests, horns, feathers and claws. */
    readonly accent: number;
  };
}

export const ANATOMY: Readonly<Record<number, Anatomy>> = {
  // Compsognathus: a tiny, quick runner with a long neck and whip tail, green with dark stripes
  // and a fuzz of proto-feathers along its neck.
  1: {
    body: { length: 0.3, depth: 0.12, width: 0.1 },
    chestDrop: 0.02,
    neck: { length: 0.26, rise: 0.85, thickness: 0.045 },
    head: { length: 0.17, depth: 0.075, width: 0.06, snout: 0.5, jaw: 0.42 },
    tail: { length: 0.72, thickness: 0.07, lift: 0.04 },
    leg: { thigh: 0.17, shin: 0.2, foot: 0.12, thickness: 0.075 },
    arm: { length: 0.1, thickness: 0.018 },
    crest: false,
    browHorns: false,
    feathers: 'fuzz',
    sickleClaw: false,
    backRidge: null,
    pattern: 'stripes',
    colors: { body: 0x8fcb4f, belly: 0xf3eaa4, marking: 0x3f6f25, accent: 0xe8b13a },
  },
  // Velociraptor: a feathered hunter with a long low snout, winged arms, a stiff tail ending in
  // a fan, and the famous sickle claw.
  2: {
    body: { length: 0.34, depth: 0.12, width: 0.1 },
    chestDrop: 0.01,
    neck: { length: 0.2, rise: 0.75, thickness: 0.05 },
    head: { length: 0.24, depth: 0.075, width: 0.065, snout: 0.45, jaw: 0.38 },
    tail: { length: 0.8, thickness: 0.07, lift: 0.08 },
    leg: { thigh: 0.18, shin: 0.21, foot: 0.12, thickness: 0.085 },
    arm: { length: 0.17, thickness: 0.025 },
    crest: false,
    browHorns: false,
    feathers: 'wings',
    sickleClaw: true,
    backRidge: null,
    pattern: 'stripes',
    colors: { body: 0xd98a3d, belly: 0xf6e3bd, marking: 0x6b3518, accent: 0x3a6f8f },
  },
  // Dilophosaurus: a lanky predator with twin red crests and a spotted teal hide.
  3: {
    body: { length: 0.38, depth: 0.15, width: 0.12 },
    chestDrop: 0.03,
    neck: { length: 0.26, rise: 0.8, thickness: 0.065 },
    head: { length: 0.26, depth: 0.1, width: 0.08, snout: 0.55, jaw: 0.4 },
    tail: { length: 0.78, thickness: 0.09, lift: 0 },
    leg: { thigh: 0.21, shin: 0.21, foot: 0.12, thickness: 0.115 },
    arm: { length: 0.15, thickness: 0.03 },
    crest: true,
    browHorns: false,
    feathers: null,
    sickleClaw: false,
    backRidge: 'spikes',
    pattern: 'spots',
    colors: { body: 0x35a093, belly: 0xdcefd9, marking: 0xf2d24a, accent: 0xd9402f },
  },
  // Allosaurus: heavy and big-headed, with red brow horns, a ridge of scutes and dark bands.
  4: {
    body: { length: 0.42, depth: 0.2, width: 0.16 },
    chestDrop: 0.05,
    neck: { length: 0.2, rise: 0.62, thickness: 0.1 },
    head: { length: 0.33, depth: 0.15, width: 0.12, snout: 0.6, jaw: 0.42 },
    tail: { length: 0.82, thickness: 0.13, lift: -0.02 },
    leg: { thigh: 0.24, shin: 0.21, foot: 0.11, thickness: 0.17 },
    arm: { length: 0.15, thickness: 0.04 },
    crest: false,
    browHorns: true,
    feathers: null,
    sickleClaw: false,
    backRidge: 'scutes',
    pattern: 'bands',
    colors: { body: 0xb75b3c, belly: 0xefd0a6, marking: 0x5c2a1c, accent: 0xe0462e },
  },
  // T-Rex: the king. A massive body and skull, a deep heavy jaw, tiny arms, and a mottled
  // dark olive hide.
  5: {
    body: { length: 0.44, depth: 0.25, width: 0.2 },
    chestDrop: 0.08,
    neck: { length: 0.16, rise: 0.5, thickness: 0.14 },
    head: { length: 0.4, depth: 0.2, width: 0.17, snout: 0.62, jaw: 0.5 },
    tail: { length: 0.85, thickness: 0.17, lift: -0.02 },
    leg: { thigh: 0.26, shin: 0.22, foot: 0.11, thickness: 0.21 },
    arm: { length: 0.08, thickness: 0.035 },
    crest: false,
    browHorns: false,
    feathers: null,
    sickleClaw: false,
    backRidge: 'scutes',
    pattern: 'mottled',
    colors: { body: 0x5f6844, belly: 0xd8cb9c, marking: 0x343a26, accent: 0xa8432d },
  },
};
