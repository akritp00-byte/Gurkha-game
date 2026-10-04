import { describe, expect, it } from 'vitest';
import { BOTS, FERNS } from '../config.ts';
import { attackZone, biteTouches, bodyRadius, zoneTouches } from '../eating.ts';
import { type PlayerInput, stepLocomotion } from '../movement.ts';
import { createRandom, type Random } from '../random.ts';
import { FERN_PATCHES } from '../world/layout.ts';
import { type BotBrain, botInput, createBotBrain } from './bots.ts';
import type { Carcass, Dino, ScrapSlot, WorldSenses } from './entities.ts';

const TICK = 1 / 20;
/** A random source that always says 0.5: no distractions, no wobble, average everything. */
const steady: Random = () => 0.5;

function dino(id: number, x: number, z: number, mass = 10, heading = 0): Dino {
  return {
    id,
    name: `Dino ${id}`,
    isBot: true,
    x,
    z,
    heading,
    speed: 0,
    pushX: 0,
    pushZ: 0,
    stamina: 1,
    winded: false,
    refillIn: 0,
    sprinting: false,
    mass,
    alive: true,
    respawnIn: 0,
    protectedFor: 0,
    biteCooldown: 0,
    carryingId: null,
    carrying: false,
    eating: false,
    eatenBy: null,
    massAtDeath: 0,
    rankAtDeath: 0,
    rank: 0,
  };
}

function senses(dinos: Dino[], scraps: ScrapSlot[] = [], carcasses: Carcass[] = []): WorldSenses {
  return {
    dinos: new Map(dinos.map((d) => [d.id, d])),
    scraps,
    meat: new Map(),
    critters: [],
    carcasses: new Map(carcasses.map((c) => [c.id, c])),
  };
}

function carcass(id: number, x: number, z: number, food: number, kind: Carcass['kind']): Carcass {
  return {
    id,
    x,
    z,
    heading: 0,
    food,
    size: food,
    radius: 2.4,
    kind,
    bodyMass: kind === 'kill' ? food / 0.7 : 0,
    variant: 0,
    carrierId: null,
    age: 0,
    lifetime: 120,
    happeningId: kind === 'event' ? 1 : null,
  };
}

/** Let the brain drive `self` with the real movement step until `done` (or time runs out). */
function drive(
  brain: BotBrain,
  self: Dino,
  world: WorldSenses,
  seconds: number,
  done: () => boolean = () => false,
  random: Random = steady,
  onInput: (input: PlayerInput) => void = () => undefined,
): boolean {
  for (let t = 0; t < seconds; t += TICK) {
    const input = botInput(brain, self, world, random, TICK);
    onInput(input);
    stepLocomotion(self, input, TICK);
    if (done()) return true;
  }
  return false;
}

describe('bots', () => {
  it('flee from a bigger dinosaur they can see', () => {
    const self = dino(1, 60, 0);
    const threat = dino(2, 66, 0, 100);
    const brain = createBotBrain(steady, 0.9);

    drive(brain, self, senses([self, threat]), 0.6);
    expect(brain.mode).toBe('flee');
    drive(brain, self, senses([self, threat]), 2.4);

    expect(Math.hypot(self.x - threat.x, self.z - threat.z)).toBeGreaterThan(6 + 12);
  });

  it('hunt smaller dinosaurs and bite ones in reach, though not straight away', () => {
    const self = dino(1, 60, 0, 50);
    const prey = dino(2, 61, 5);
    const brain = createBotBrain(steady, BOTS.skill.max);
    let bitInReach = false;

    let sprinted = false;
    drive(
      brain,
      self,
      senses([self, prey]),
      12,
      () => bitInReach,
      createRandom(5),
      (input) => {
        sprinted ||= input.sprint;
        const inReach = zoneTouches(
          attackZone(self, self.mass),
          prey.x,
          prey.z,
          bodyRadius(prey.mass),
        );
        if (input.bite) bitInReach = inReach;
      },
    );

    expect(bitInReach).toBe(true);
    expect(brain.mode).toBe('hunt');
    expect(sprinted).toBe(false); // bots amble after prey: a player can always outrun them
  });

  it('stop hunting once they are big, and leave smaller dinosaurs alone', () => {
    const self = dino(1, 60, 0, BOTS.maxHuntingMass + 50);
    const prey = dino(2, 63, 6, 40);
    const brain = createBotBrain(createRandom(2), 0.6);
    let bit = false;
    drive(
      brain,
      self,
      senses([self, prey]),
      6,
      () => bit,
      createRandom(9),
      (input) => {
        bit ||= input.bite;
      },
    );
    expect(bit).toBe(false);
    expect(brain.mode).not.toBe('hunt');
  });

  it('shy away from the rich food in the danger zones', () => {
    const self = dino(1, 0, 40);
    // A haunch on the volcano's slopes, and a plain scrap just as far away on the plains.
    const rich: ScrapSlot = { x: 0, z: 30, size: 2, rich: true, alive: true, respawnIn: 0 };
    const plain: ScrapSlot = { x: 0, z: 50, size: 1, rich: false, alive: true, respawnIn: 0 };
    const brain = createBotBrain(steady, 0.5);
    drive(brain, self, senses([self], [rich, plain]), 1);
    expect(brain.mode).toBe('food');
    expect(brain.goalZ).toBeGreaterThan(40);
  });

  it('stop and eat the carcass in their mouth', () => {
    const self = dino(1, 60, 0, 50);
    self.carrying = true;
    self.carryingId = 7;
    const brain = createBotBrain(steady, 0.5);
    const meal = carcass(7, 60, 1, 20, 'kill');
    meal.carrierId = self.id;
    let last: PlayerInput | undefined;
    const record = (input: PlayerInput) => {
      last = input;
    };
    drive(brain, self, senses([self], [], [meal]), 1, () => false, steady, record);
    expect(last).toMatchObject({ eat: true, bite: false, throttle: 0 });
    expect(brain.mode).toBe('feed');
    expect(self.speed).toBe(0);
  });

  it('head for a world-event carcass they hear about, and eat once they reach it', () => {
    const self = dino(1, 60, 0, 30);
    const feast = carcass(3, 60, 70, 200, 'event');
    const scrap = { x: 64, z: -4, size: 0, rich: false, alive: true, respawnIn: 0 } as const;
    const brain = createBotBrain(steady, 0.6);
    let eating = false;
    drive(
      brain,
      self,
      senses([self], [scrap], [feast]),
      15,
      () => eating,
      steady,
      (input) => {
        eating = input.eat;
      },
    );
    expect(brain.mode).toBe('feed');
    expect(eating).toBe(true);
    expect(zoneTouches(attackZone(self, self.mass), feast.x, feast.z, feast.radius)).toBe(true);
  });

  it('shove a rival their size off the carcass they are eating', () => {
    const self = dino(1, 60, 0, 30);
    const feast = carcass(3, 60, 3, 200, 'event');
    const rival = dino(2, 61.2, 1.4, 31, Math.PI);
    const brain = createBotBrain(steady, 0.9);
    let shoved = false;
    const record = (input: PlayerInput) => {
      shoved = input.bite;
    };
    const world = senses([self, rival], [], [feast]);
    drive(brain, self, world, 3, () => shoved, createRandom(3), record);
    expect(shoved).toBe(true);
  });

  it("don't sprint while winded", () => {
    const self = dino(1, 60, 0, 30);
    self.winded = true;
    self.stamina = 0.1;
    const threat = dino(2, 63, 0, 100);
    const brain = createBotBrain(steady, 0.9);
    let sprinted = false;
    drive(
      brain,
      self,
      senses([self, threat]),
      1,
      () => sprinted,
      steady,
      (input) => {
        sprinted ||= input.sprint && self.winded;
      },
    );
    expect(brain.mode).toBe('flee');
    expect(sprinted).toBe(false);
  });

  it('leave protected dinosaurs alone', () => {
    const self = dino(1, 60, 0, 50);
    const prey = dino(2, 66, 10);
    prey.protectedFor = 3;
    const brain = createBotBrain(steady, 0.9);
    drive(brain, self, senses([self, prey]), 1);
    expect(brain.mode).not.toBe('hunt');
  });

  it('go for food when nothing is threatening or edible', () => {
    const self = dino(1, 60, 0);
    const scrap = { x: 66, z: -6, size: 0, rich: false, alive: true, respawnIn: 0 } as const;
    const brain = createBotBrain(steady, 0.5);

    const reached = drive(brain, self, senses([self], [scrap]), 4, () =>
      biteTouches(self, self.mass, scrap.x, scrap.z, 0.25),
    );

    expect(reached).toBe(true);
    expect(brain.mode).toBe('food');
  });

  it("can't see prey hidden in ferns until they're close", () => {
    const patch = FERN_PATCHES[0];
    const prey = dino(2, patch.x, patch.z);
    const far = dino(1, patch.x + FERNS.revealDistance + 8, patch.z, 50, -Math.PI / 2);
    const farBrain = createBotBrain(steady, 0.9);
    drive(farBrain, far, senses([far, prey]), 0.6);
    expect(farBrain.mode).not.toBe('hunt');

    const near = dino(1, patch.x + FERNS.revealDistance - 2, patch.z, 50, -Math.PI / 2);
    const nearBrain = createBotBrain(steady, 0.9);
    drive(nearBrain, near, senses([near, prey]), 0.6);
    expect(nearBrain.mode).toBe('hunt');
  });

  it('react after a human reaction time, faster with more skill', () => {
    const random = createRandom(7);
    const brains = Array.from({ length: 400 }, () => createBotBrain(random));
    for (const brain of brains) {
      expect(brain.reactionSeconds).toBeGreaterThanOrEqual(BOTS.reactionDelayMs.min / 1000);
      expect(brain.reactionSeconds).toBeLessThanOrEqual(BOTS.reactionDelayMs.max / 1000);
      expect(brain.skill).toBeGreaterThanOrEqual(BOTS.skill.min);
      expect(brain.skill).toBeLessThanOrEqual(BOTS.skill.max);
    }
    const mean = (list: BotBrain[]) =>
      list.reduce((sum, b) => sum + b.reactionSeconds, 0) / list.length;
    expect(mean(brains.filter((b) => b.skill > 0.45))).toBeLessThan(
      mean(brains.filter((b) => b.skill < 0.2)),
    );

    // A threat that appears just after a decision isn't noticed until the next one.
    const self = dino(1, 60, 0);
    const brain = createBotBrain(steady, 0.5);
    brain.thinkIn = 0;
    const calm = senses([self]);
    botInput(brain, self, calm, steady, TICK);
    const danger = senses([self, dino(2, 64, 0, 100)]);
    let seconds = 0;
    while (brain.mode !== 'flee' && seconds < 1) {
      botInput(brain, self, danger, steady, TICK);
      seconds += TICK;
    }
    expect(seconds).toBeGreaterThanOrEqual(BOTS.reactionDelayMs.min / 1000 - 1e-9);
    expect(seconds).toBeLessThanOrEqual(BOTS.reactionDelayMs.max / 1000 + TICK);
  });

  it('never steer perfectly, and clumsy bots wobble most', () => {
    const maxWobble = (skill: number) => {
      const random = createRandom(11);
      const self = dino(1, 60, 0);
      const brain = createBotBrain(random, skill);
      let wobble = 0;
      drive(
        brain,
        self,
        senses([self]),
        30,
        () => {
          wobble = Math.max(wobble, Math.abs(brain.wobble));
          return false;
        },
        random,
      );
      return wobble;
    };
    const clumsy = maxWobble(BOTS.skill.min);
    const sharp = maxWobble(BOTS.skill.max);
    expect(sharp).toBeGreaterThan(0);
    expect(clumsy).toBeGreaterThan(0.1);
    expect(clumsy).toBeGreaterThan(sharp * 1.5);
    expect(clumsy).toBeLessThanOrEqual(BOTS.maxSteeringWobble);
  });

  it('give up a chase they are not winning', () => {
    const self = dino(1, 100, -10, 50);
    const prey = dino(2, 100, 5);
    const world = senses([self, prey]);
    const brain = createBotBrain(steady, 0.9);
    let gaveUp = false;
    for (let t = 0; t < BOTS.chaseGiveUpSeconds + 2 && !gaveUp; t += TICK) {
      stepLocomotion(self, botInput(brain, self, world, steady, TICK), TICK);
      // The prey always stays 15 units ahead.
      prey.x = self.x + Math.sin(self.heading) * 15;
      prey.z = self.z + Math.cos(self.heading) * 15;
      gaveUp = brain.huntCooldown > 0;
    }
    expect(gaveUp).toBe(true);
    expect(brain.mode).not.toBe('hunt');
  });
});
