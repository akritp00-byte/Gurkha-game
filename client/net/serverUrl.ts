import { NETWORK } from '@extinct/shared';

/**
 * Resolve the game server's base URL (no trailing slash).
 *
 * `VITE_SERVER_URL` wins when set. Otherwise the server is assumed to run on the same host as
 * the page, on the default port, which covers local development and phones on the same network.
 */
export function resolveServerUrl(
  configured: string | undefined,
  page: Pick<Location, 'protocol' | 'hostname'>,
): string {
  const explicit = configured?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return `${page.protocol}//${page.hostname}:${NETWORK.defaultServerPort}`;
}
