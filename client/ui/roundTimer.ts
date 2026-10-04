import { timeToImpact, timeToNextRound } from '@extinct/shared';
import type { SessionRound } from '../game/session.ts';

function clockText(seconds: number): string {
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Top-centre round clock: time to impact, red and pulsing once the meteor is on its way. */
export class RoundTimer {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly time: HTMLElement;
  private shown = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'round-timer';
    this.root.dataset.testid = 'round-timer';
    this.label = document.createElement('span');
    this.label.className = 'round-label';
    this.time = document.createElement('span');
    this.time.className = 'round-time';
    this.root.append(this.label, this.time);
    parent.append(this.root);
  }

  update(round: SessionRound): void {
    const { clock, settings } = round;
    let label: string;
    let time = '';
    let state: string;
    if (round.phase === 'playing') {
      const warning = clock >= settings.meteorWarningAtSeconds;
      label = warning ? 'Meteor impact in' : `Round ${round.number}`;
      time = clockText(timeToImpact(clock, settings));
      state = warning ? 'warning' : 'calm';
    } else if (round.phase === 'impact') {
      label = 'Impact!';
      state = 'impact';
    } else {
      label = 'Next round in';
      time = String(Math.ceil(timeToNextRound(clock, settings)));
      state = 'podium';
    }
    const key = `${state}|${label}|${time}`;
    if (key === this.shown) return;
    this.shown = key;
    this.root.dataset.state = state;
    this.label.textContent = label;
    this.time.textContent = time;
  }
}
