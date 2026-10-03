import { describe, expect, it } from 'vitest';
import { WORLD } from '../config.ts';
import { createRandom } from '../random.ts';
import { RIVER, TAR_PITS, VOLCANO } from './layout.ts';
import {
  buildHeightfield,
  distanceToRiver,
  heightAt,
  isOpenGround,
  islandHeightfield,
  randomOpenGround,
  sampleHeight,
  tarPitAt,
  tarSurfaceHeight,
  WATER_LEVEL,
} from './terrain.ts';

const field = islandHeightfield();

describe('island terrain', () => {
  it('is identical every time it is built', () => {
    expect(buildHeightfield().heights).toEqual(field.heights);
  });

  it('rises to a volcano with a sunken crater in the middle', () => {
    const rim = heightAt(field, VOLCANO.craterRadius, 0);
    expect(rim).toBeGreaterThan(15);
    expect(heightAt(field, 0, 0)).toBeLessThan(rim - 3);
    expect(heightAt(field, VOLCANO.baseRadius * 0.5, 0)).toBeLessThan(rim);
  });

  it('is dry land inland and sea beyond the coast all the way round', () => {
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const [x, z] = [Math.cos(angle) * 110, Math.sin(angle) * 110];
      if (distanceToRiver(x, z) > RIVER.width && !tarPitAt(x, z, 3)) {
        expect(heightAt(field, x, z)).toBeGreaterThan(WATER_LEVEL);
      }
      expect(heightAt(field, Math.cos(angle) * 165, Math.sin(angle) * 165)).toBeLessThan(
        WATER_LEVEL,
      );
    }
  });

  it('keeps the walkable edge on the beach, above the water', () => {
    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * Math.PI * 2;
      const [x, z] = [
        Math.cos(angle) * WORLD.walkableRadius,
        Math.sin(angle) * WORLD.walkableRadius,
      ];
      if (distanceToRiver(x, z) > RIVER.width) {
        expect(sampleHeight(x, z)).toBeGreaterThan(WATER_LEVEL);
      }
    }
  });

  it('carves the river below the water line along its course', () => {
    for (const [x, z] of RIVER.course) {
      if (Math.hypot(x, z) < WORLD.walkableRadius) {
        expect(sampleHeight(x, z)).toBeLessThan(WATER_LEVEL);
        expect(sampleHeight(x, z)).toBeGreaterThan(-1); // shallow enough to wade
      }
    }
  });

  it('sinks every tar pit into a flat pool below the surrounding ground', () => {
    TAR_PITS.forEach((pit, index) => {
      const floor = sampleHeight(pit.x, pit.z);
      expect(sampleHeight(pit.x + pit.radius * 0.5, pit.z)).toBeCloseTo(floor, 5);
      expect(sampleHeight(pit.x + pit.radius + 4, pit.z)).toBeGreaterThan(floor);
      expect(tarSurfaceHeight(index)).toBeGreaterThan(floor);
    });
  });

  it('interpolates exactly through the grid samples and linearly across each triangle', () => {
    const { cellSize, origin } = field;
    const [column, row] = [70, 61];
    const x = origin + column * cellSize;
    const z = origin + row * cellSize;
    const h00 = heightAt(field, x, z);
    const h11 = heightAt(field, x + cellSize, z + cellSize);
    expect(h00).toBeCloseTo(sampleHeight(x, z), 4);
    expect(heightAt(field, x + cellSize / 2, z + cellSize / 2)).toBeCloseTo((h00 + h11) / 2, 4);
  });

  it('finds open ground for spawning anywhere on the island', () => {
    const random = createRandom(42);
    for (let i = 0; i < 300; i++) {
      const { x, z } = randomOpenGround(field, random);
      expect(isOpenGround(field, x, z)).toBe(true);
      expect(Math.hypot(x, z)).toBeLessThan(WORLD.walkableRadius);
    }
  });
});
