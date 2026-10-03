import { NETWORK } from '@extinct/shared';
import { describe, expect, it } from 'vitest';
import { resolveServerUrl } from './serverUrl.ts';

const page = { protocol: 'http:', hostname: '192.168.1.20' };

describe('resolveServerUrl', () => {
  it('uses the page host and the default server port when nothing is configured', () => {
    expect(resolveServerUrl(undefined, page)).toBe(
      `http://192.168.1.20:${NETWORK.defaultServerPort}`,
    );
    expect(resolveServerUrl('  ', page)).toBe(`http://192.168.1.20:${NETWORK.defaultServerPort}`);
  });

  it('keeps https pages on https', () => {
    expect(resolveServerUrl(undefined, { protocol: 'https:', hostname: 'play.example.com' })).toBe(
      `https://play.example.com:${NETWORK.defaultServerPort}`,
    );
  });

  it('prefers the configured URL and strips trailing slashes', () => {
    expect(resolveServerUrl('https://eu.example.com/', page)).toBe('https://eu.example.com');
  });
});
