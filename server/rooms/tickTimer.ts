/** How long the last ticks took and how often they ran, for the load test and /stats. */
export class TickTimer {
  private readonly starts: number[] = [];
  private readonly durations: number[] = [];
  private readonly window: number;

  constructor(window = 200) {
    this.window = window;
  }

  /** Record one tick that started at `startedAt` (ms) and took `durationMs`. */
  record(durationMs: number, startedAt = performance.now() - durationMs): void {
    this.starts.push(startedAt);
    this.durations.push(durationMs);
    if (this.starts.length > this.window) {
      this.starts.shift();
      this.durations.shift();
    }
  }

  summary(): { ticksPerSecond: number; stepMsAverage: number; stepMsMax: number } {
    const count = this.starts.length;
    if (count < 2) return { ticksPerSecond: 0, stepMsAverage: 0, stepMsMax: 0 };
    const elapsedMs = this.starts[count - 1] - this.starts[0];
    const total = this.durations.reduce((sum, ms) => sum + ms, 0);
    return {
      ticksPerSecond: elapsedMs > 0 ? ((count - 1) * 1000) / elapsedMs : 0,
      stepMsAverage: total / count,
      stepMsMax: Math.max(...this.durations),
    };
  }
}
