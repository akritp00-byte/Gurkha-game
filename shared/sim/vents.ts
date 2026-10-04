import { VENTS } from '../config.ts';
import type { Vent } from '../world/layout.ts';

/**
 * How far this vent is through its eruption cycle, in seconds. Every vent erupts each
 * VENTS.periodSeconds, when this wraps back to 0; the phases stagger them.
 */
export function ventCycle(vent: Vent, time: number): number {
  const t = (time + vent.phase) % VENTS.periodSeconds;
  return t < 0 ? t + VENTS.periodSeconds : t;
}

/** Seconds until this vent next erupts. */
export function secondsToEruption(vent: Vent, time: number): number {
  return VENTS.periodSeconds - ventCycle(vent, time);
}

/** Whether this vent is rumbling as a warning before it erupts. */
export function isRumbling(vent: Vent, time: number): boolean {
  return secondsToEruption(vent, time) <= VENTS.warningSeconds;
}
