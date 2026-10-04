import { describe, expect, it } from 'vitest';
import { IDLE_INPUT } from './movement.ts';
import {
  cleanName,
  fromWireInput,
  toWireInput,
  type WireInput,
  WIRE_INPUT,
  zoneCode,
  zoneFromCode,
} from './net.ts';

describe('wire inputs', () => {
  const wire: WireInput = { turn: 0, throttle: 0, sprint: false, bite: false, eat: false };

  it('make "not turning" and "standing still" exact', () => {
    expect(fromWireInput(toWireInput(IDLE_INPUT, wire))).toEqual(IDLE_INPUT);
    expect(
      toWireInput({ turn: 1, throttle: 1, sprint: true, bite: true, eat: true }, wire),
    ).toEqual({
      turn: WIRE_INPUT.turn,
      throttle: WIRE_INPUT.throttle,
      sprint: true,
      bite: true,
      eat: true,
    });
    expect(fromWireInput(wire)).toEqual({
      turn: 1,
      throttle: 1,
      sprint: true,
      bite: true,
      eat: true,
    });
  });

  it('keep steering to within half a step', () => {
    for (const turn of [-0.9, -0.33, 0.25, 0.71]) {
      const back = fromWireInput(toWireInput({ ...IDLE_INPUT, turn, throttle: 0.5 }, wire));
      expect(Math.abs(back.turn - turn)).toBeLessThanOrEqual(0.5 / WIRE_INPUT.turn);
      expect(Math.abs(back.throttle - 0.5)).toBeLessThanOrEqual(0.5 / WIRE_INPUT.throttle);
    }
  });

  it('treat anything malformed as no input, and clamp the rest', () => {
    expect(
      fromWireInput({ turn: 'left', throttle: Number.NaN, sprint: 1, bite: 'yes', eat: {} }),
    ).toEqual(IDLE_INPUT);
    expect(fromWireInput({ turn: 999, throttle: -5 })).toEqual({ ...IDLE_INPUT, turn: 1 });
  });

  it('send zones and kinds as small numbers', () => {
    expect(zoneFromCode(zoneCode('tarPits'))).toBe('tarPits');
    expect(zoneFromCode(zoneCode(null))).toBe(null);
    expect(zoneFromCode(99)).toBe(null);
  });
});

describe('player names', () => {
  it('trims, collapses spaces and drops control characters', () => {
    expect(cleanName('  Rex \t the\n King  ', 16, 'x')).toBe('Rex the King');
    expect(cleanName('Ra\u0000wr\u007f', 16, 'x')).toBe('Rawr');
  });

  it('caps the length, counting an emoji as one character', () => {
    expect(cleanName('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 16, 'x')).toBe('ABCDEFGHIJKLMNOP');
    expect(cleanName('🦖🦖🦖', 2, 'x')).toBe('🦖🦖');
  });

  it('falls back when there is nothing usable', () => {
    expect(cleanName('   ', 16, 'Player 7')).toBe('Player 7');
    expect(cleanName(42, 16, 'Player 7')).toBe('Player 7');
  });
});
