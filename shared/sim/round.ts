import { ROUND } from '../config.ts';
import { clamp } from '../math.ts';

/**
 * The round loop (BUILD_PROMPT.md §3, "Round loop"): five minutes of play with the meteor
 * warning in the last minute, a three-second impact that freezes everything, then the podium,
 * then a fresh round. One clock, counting seconds since the round started, drives it all.
 */

/** Timings for one round. Tests shorten them. */
export interface RoundSettings {
  readonly durationSeconds: number;
  readonly meteorWarningAtSeconds: number;
  readonly impactSequenceSeconds: number;
  readonly intermissionSeconds: number;
}

export const DEFAULT_ROUND: RoundSettings = {
  durationSeconds: ROUND.durationSeconds,
  meteorWarningAtSeconds: ROUND.meteorWarningAtSeconds,
  impactSequenceSeconds: ROUND.impactSequenceSeconds,
  intermissionSeconds: ROUND.intermissionSeconds,
};

/** Round timings for a round of `durationSeconds`, with the warning at the same point in it. */
export function roundOfLength(durationSeconds: number): RoundSettings {
  const warningShare = ROUND.meteorWarningAtSeconds / ROUND.durationSeconds;
  return {
    ...DEFAULT_ROUND,
    durationSeconds,
    meteorWarningAtSeconds: durationSeconds * warningShare,
  };
}

/** `playing` (with the meteor warning near the end), then `impact` (frozen), then `podium`. */
export type RoundPhase = 'playing' | 'impact' | 'podium';

export function roundPhase(clock: number, settings: RoundSettings): RoundPhase {
  if (clock < settings.durationSeconds) return 'playing';
  return clock < settings.durationSeconds + settings.impactSequenceSeconds ? 'impact' : 'podium';
}

/** Seconds from a round's start to the next one's. */
export function roundLength(settings: RoundSettings): number {
  return settings.durationSeconds + settings.impactSequenceSeconds + settings.intermissionSeconds;
}

/** How far through the meteor warning the round is: 0 before it starts, 1 at impact. */
export function warningProgress(clock: number, settings: RoundSettings): number {
  const span = settings.durationSeconds - settings.meteorWarningAtSeconds;
  if (span <= 0) return clock >= settings.durationSeconds ? 1 : 0;
  return clamp((clock - settings.meteorWarningAtSeconds) / span, 0, 1);
}

/** Seconds of play left before impact, never below zero. */
export function timeToImpact(clock: number, settings: RoundSettings): number {
  return Math.max(0, settings.durationSeconds - clock);
}

/** Seconds until the next round starts, counted during the impact and podium. */
export function timeToNextRound(clock: number, settings: RoundSettings): number {
  return Math.max(0, roundLength(settings) - clock);
}

/** One place on the podium (or the leaderboard). */
export interface Standing {
  readonly dinoId: number;
  readonly name: string;
  readonly mass: number;
  readonly isBot: boolean;
}
