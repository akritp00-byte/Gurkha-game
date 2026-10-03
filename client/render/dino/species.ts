/**
 * Proportions and colours of each tier's placeholder dinosaur (BUILD_PROMPT.md §7: capsule
 * body, head, tail, legs, colour per tier). Lengths are relative: every species is rescaled so
 * its snout sits at the shared bite reach, and in-game size then comes from `scaleForMass`.
 */
export interface SpeciesStyle {
  /** Torso half-sizes: width, height, length. */
  readonly torso: readonly [number, number, number];
  readonly thigh: number;
  readonly shin: number;
  readonly legRadius: number;
  readonly neckLength: number;
  readonly neckRadius: number;
  /** Neck angle above horizontal, in radians. */
  readonly neckRise: number;
  readonly headLength: number;
  readonly headHeight: number;
  readonly headWidth: number;
  readonly tailLength: number;
  readonly tailRadius: number;
  /** How far the tail tip hangs below its base. */
  readonly tailDroop: number;
  readonly armLength: number;
  /** Dilophosaurus' twin head crests. */
  readonly crest: boolean;
  /** Allosaurus' brow horns. */
  readonly horns: boolean;
  readonly colors: { readonly body: number; readonly belly: number; readonly accent: number };
}

export const SPECIES_STYLES: Readonly<Record<number, SpeciesStyle>> = {
  // Compsognathus: tiny, slim and quick, with a long neck and tail.
  1: {
    torso: [0.12, 0.14, 0.24],
    thigh: 0.22,
    shin: 0.24,
    legRadius: 0.04,
    neckLength: 0.22,
    neckRadius: 0.05,
    neckRise: 0.75,
    headLength: 0.2,
    headHeight: 0.1,
    headWidth: 0.09,
    tailLength: 0.68,
    tailRadius: 0.085,
    tailDroop: 0.08,
    armLength: 0.1,
    crest: false,
    horns: false,
    colors: { body: 0x86c04a, belly: 0xece4a6, accent: 0x4f7f2a },
  },
  // Velociraptor: lean hunter with a long stiff tail and big hands.
  2: {
    torso: [0.13, 0.14, 0.3],
    thigh: 0.24,
    shin: 0.27,
    legRadius: 0.048,
    neckLength: 0.2,
    neckRadius: 0.055,
    neckRise: 0.62,
    headLength: 0.27,
    headHeight: 0.11,
    headWidth: 0.1,
    tailLength: 0.82,
    tailRadius: 0.09,
    tailDroop: 0.02,
    armLength: 0.17,
    crest: false,
    horns: false,
    colors: { body: 0xd98a3d, belly: 0xf3dfb4, accent: 0x8a4b1e },
  },
  // Dilophosaurus: medium build with two red crests.
  3: {
    torso: [0.16, 0.18, 0.32],
    thigh: 0.26,
    shin: 0.26,
    legRadius: 0.06,
    neckLength: 0.26,
    neckRadius: 0.075,
    neckRise: 0.68,
    headLength: 0.3,
    headHeight: 0.13,
    headWidth: 0.12,
    tailLength: 0.76,
    tailRadius: 0.12,
    tailDroop: 0.08,
    armLength: 0.15,
    crest: true,
    horns: false,
    colors: { body: 0x3fa59a, belly: 0xd8efe0, accent: 0xd9483b },
  },
  // Allosaurus: bulky, big-headed, with brow horns.
  4: {
    torso: [0.21, 0.23, 0.36],
    thigh: 0.28,
    shin: 0.26,
    legRadius: 0.08,
    neckLength: 0.18,
    neckRadius: 0.11,
    neckRise: 0.55,
    headLength: 0.36,
    headHeight: 0.19,
    headWidth: 0.16,
    tailLength: 0.8,
    tailRadius: 0.15,
    tailDroop: 0.1,
    armLength: 0.14,
    crest: false,
    horns: true,
    colors: { body: 0xb5563a, belly: 0xedcfa8, accent: 0x6e2f22 },
  },
  // T-Rex: massive body, huge head, tiny arms.
  5: {
    torso: [0.26, 0.28, 0.38],
    thigh: 0.3,
    shin: 0.27,
    legRadius: 0.1,
    neckLength: 0.16,
    neckRadius: 0.15,
    neckRise: 0.45,
    headLength: 0.44,
    headHeight: 0.25,
    headWidth: 0.22,
    tailLength: 0.85,
    tailRadius: 0.18,
    tailDroop: 0.12,
    armLength: 0.08,
    crest: false,
    horns: false,
    colors: { body: 0x6f6e4a, belly: 0xd3c69c, accent: 0x3f3d2c },
  },
};
