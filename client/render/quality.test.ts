import { describe, expect, it } from 'vitest';
import { chooseQuality, QUALITY_PRESETS } from './quality.ts';

describe('chooseQuality', () => {
  it('gives desktops high quality and touch-first devices medium', () => {
    expect(chooseQuality('', false)).toBe(QUALITY_PRESETS.high);
    expect(chooseQuality('', true)).toBe(QUALITY_PRESETS.medium);
  });

  it('lets ?quality= override the automatic choice', () => {
    expect(chooseQuality('?quality=low', false)).toBe(QUALITY_PRESETS.low);
    expect(chooseQuality('?seed=1&quality=high', true)).toBe(QUALITY_PRESETS.high);
    expect(chooseQuality('?quality=ultra', false)).toBe(QUALITY_PRESETS.high);
  });

  it('only turns shadows off at the lowest preset', () => {
    expect(QUALITY_PRESETS.low.shadows).toBe(false);
    expect(QUALITY_PRESETS.medium.shadows).toBe(true);
  });
});
