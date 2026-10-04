import { describe, expect, it } from 'vitest';
import { BOTS, FERNS } from '../config.ts';
import { biteTouches, bodyRadius } from '../eating.ts';
import { stepMotion } from '../movement.ts';
import { createRandom, type Random } from '../random.ts';
import { FERN_PATCHES } from '../world/layout.ts';
import { type BotBrain, botInput, createBotBrain } from './bots.ts';
import type { Dino, EggSlot, WorldSenses } from './entities.ts';

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
    mass,
    alive: true,
    respawnIn: 0,
    protectedFor: 0,
    sprinting: false,
    meatOwed: 0,
    meatCooldown: 0,
    eatenBy: null,
    massAtDeath: 0,
  };
}

function senses(dinos: Dino[], eggs: EggSlot[] = []): WorldSenses {
  return { dinos: new Map(dinos.map((d) => [d.id, d])), eggs, meat: new Map(), critters: [] };
}

/** Let the brain drive `self` with the real movement step until `done` (or time runs out). */
function drive(
  brain: BotBrain,
  self: Dino,
  world: WorldSenses,
  seconds: number,
  done: () => boolean = () => false,
  random: Random = steady,
): boolean {
  for (let t = 0; t < seconds; t += TICK) {
    const input = botInput(brain, self, world, random, TICK);
    Object.assign(self, stepMotion(self, input, { mass: self.mass, terrainFactor: 1 }, TICK));
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

    expect(Math.hypot(self.x - threat.x, self.z - threat.z)).toBeGreaterThan(6 + 15);
  });

  it('hunt smaller dinosaurs and catch ones that stand still', () => {
    const self = dino(1, 60, 0, 50);
    const prey = dino(2, 66, 10);
    const brain = createBotBrain(steady, 0.9);

    const caught = drive(brain, self, senses([self, prey]), 4, () =>
      biteTouches(self, self.mass, prey.x, prey.z, bodyRadius(prey.mass)),
    );

    expect(caught).toBe(true);
    expect(brain.mode).toBe('hunt');
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
    const egg = { x: 66, z: -6, alive: true, respawnIn: 0 };
    const brain = createBotBrain(steady, 0.5);

    const reached = drive(brain, self, senses([self], [egg]), 4, () =>
      biteTouches(self, self.mass, egg.x, egg.z, 0.25),
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
    expect(mean(brains.filter((b) => b.skill > 0.7))).toBeLessThan(
      mean(brains.filter((b) => b.skill < 0.35)),
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
    expect(clumsy).toBeGreaterThan(sharp * 3);
    expect(clumsy).toBeLessThanOrEqual(BOTS.maxSteeringWobble);
  });

  it('give up a chase they are not winning', () => {
    const self = dino(1, 100, -10, 50);
    const prey = dino(2, 100, 5);
    const world = senses([self, prey]);
    const brain = createBotBrain(steady, 0.9);
    let gaveUp = false;
    for (let t = 0; t < BOTS.chaseGiveUpSeconds + 2 && !gaveUp; t += TICK) {
      const input = botInput(brain, self, world, steady, TICK);
      Object.assign(self, stepMotion(self, input, { mass: self.mass, terrainFactor: 1 }, TICK));
      // The prey always stays 15 units ahead.
      prey.x = self.x + Math.sin(self.heading) * 15;
      prey.z = self.z + Math.cos(self.heading) * 15;
      gaveUp = brain.huntCooldown > 0;
    }
    expect(gaveUp).toBe(true);
    expect(brain.mode).not.toBe('hunt');
  });
});
