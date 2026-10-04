/**
 * Sound (BUILD_PROMPT.md §6 and §9): every sound is synthesised with the Web Audio API, so
 * there are no audio files to download or license. The context starts on the first click or
 * key press (browsers block sound before then), and M mutes it, remembered between visits.
 */

const MUTE_KEY = 'extinct.muted';
/** Overall loudness. */
const MASTER_VOLUME = 0.7;
/** A sound this far from the listener plays at half volume; past the cutoff, not at all. */
const HALF_VOLUME_DISTANCE = 18;
const CUTOFF_DISTANCE = 90;

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Storage blocked: the setting just won't be remembered.
  }
}

/** A sound's position, to fade it with distance from the listener. */
export interface Place {
  readonly x: number;
  readonly z: number;
}

export class SoundBoard {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private muted = readMuted();
  private readonly listener = { x: 0, z: 0 };
  private rumble: { gain: GainNode; filter: BiquadFilterNode } | undefined;
  private wind: GainNode | undefined;
  private nextBirdAt = 0;

  constructor() {
    const start = (): void => {
      this.unlock();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    window.addEventListener('touchstart', start);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Whether sound is running (after the first click or key press, unless muted). */
  get isPlaying(): boolean {
    return this.context?.state === 'running' && !this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    writeMuted(this.muted);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : MASTER_VOLUME,
        this.context.currentTime,
        0.05,
      );
    }
    return this.muted;
  }

  /** Where the player is, for fading distant sounds. */
  setListener(x: number, z: number): void {
    this.listener.x = x;
    this.listener.z = z;
  }

  private unlock(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return;
    }
    const Context = window.AudioContext as typeof AudioContext | undefined;
    if (!Context) return;
    const context = new Context();
    this.context = context;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 4;
    compressor.connect(context.destination);
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(compressor);
    this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.startBeds(context, this.master);
  }

  /** Volume for a sound at `at`: 1 on top of the listener, fading with distance. */
  private distanceGain(at: Place | undefined): number {
    if (!at) return 1;
    const distance = Math.hypot(at.x - this.listener.x, at.z - this.listener.z);
    if (distance > CUTOFF_DISTANCE) return 0;
    return 1 / (1 + distance / HALF_VOLUME_DISTANCE);
  }

  /** The context and an output gain for a one-shot sound, or nothing if it shouldn't play. */
  private voice(volume: number, at?: Place): { context: AudioContext; out: GainNode } | undefined {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running' || this.muted) return undefined;
    const gain = volume * this.distanceGain(at);
    if (gain < 0.01) return undefined;
    const out = context.createGain();
    out.gain.value = gain;
    out.connect(this.master);
    return { context, out };
  }

  /** A burst of filtered noise with a sharp attack and an exponential decay. */
  private noiseHit(
    context: AudioContext,
    out: AudioNode,
    when: number,
    options: {
      readonly type: BiquadFilterType;
      readonly frequency: number;
      readonly to?: number;
      readonly q?: number;
      readonly volume: number;
      readonly decay: number;
    },
  ): void {
    if (!this.noise) return;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = context.createBiquadFilter();
    filter.type = options.type;
    filter.frequency.setValueAtTime(options.frequency, when);
    if (options.to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(options.to, when + options.decay);
    }
    filter.Q.value = options.q ?? 1;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(options.volume, when + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + options.decay);
    source.connect(filter).connect(gain).connect(out);
    source.start(when, Math.random() * 0.5);
    source.stop(when + options.decay + 0.05);
  }

  /** A tone gliding from one pitch to another, with a quick attack and a decay. */
  private tone(
    context: AudioContext,
    out: AudioNode,
    when: number,
    options: {
      readonly type: OscillatorType;
      readonly from: number;
      readonly to: number;
      readonly volume: number;
      readonly decay: number;
      readonly attack?: number;
    },
  ): void {
    const oscillator = context.createOscillator();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.from, when);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(options.to, 1),
      when + options.decay,
    );
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(options.volume, when + (options.attack ?? 0.006));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + options.decay);
    oscillator.connect(gain).connect(out);
    oscillator.start(when);
    oscillator.stop(when + options.decay + 0.05);
  }

  /**
   * The eating sound: a meaty chomp. A low thump of jaws closing, two or three crunchy grains
   * of bone and gristle, and a wet squelch, pitched down for bigger mouthfuls.
   */
  chomp(amount: number, at?: Place): void {
    const size = Math.min(Math.log2(1 + amount) / 5, 1);
    const voice = this.voice(0.55 + 0.45 * size, at);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    const pitch = (1.1 - 0.45 * size) * (0.92 + Math.random() * 0.16);
    this.tone(context, out, now, {
      type: 'sine',
      from: 170 * pitch,
      to: 55 * pitch,
      volume: 0.9,
      decay: 0.12,
    });
    const grains = 2 + Math.floor(Math.random() * 2 + size * 2);
    for (let i = 0; i < grains; i++) {
      const when = now + 0.012 + i * (0.028 + Math.random() * 0.02);
      this.noiseHit(context, out, when, {
        type: 'bandpass',
        frequency: (1400 + Math.random() * 1800) * pitch,
        q: 2.5,
        volume: 0.55 - i * 0.08,
        decay: 0.035 + Math.random() * 0.03,
      });
    }
    this.noiseHit(context, out, now + 0.03, {
      type: 'lowpass',
      frequency: 1300 * pitch,
      to: 260 * pitch,
      q: 7,
      volume: 0.45,
      decay: 0.16 + 0.1 * size,
    });
  }

  /** A bite snapping shut on nothing much: a sharp clack of teeth. */
  snap(bodyScale: number, at?: Place): void {
    const voice = this.voice(0.45, at);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    const pitch = 1 / Math.sqrt(Math.max(bodyScale, 0.5));
    this.noiseHit(context, out, now, {
      type: 'highpass',
      frequency: 2400 * pitch,
      volume: 0.6,
      decay: 0.03,
    });
    this.tone(context, out, now, {
      type: 'triangle',
      from: 420 * pitch,
      to: 160 * pitch,
      volume: 0.35,
      decay: 0.05,
    });
  }

  /** Catching a dinosaur: a heavy crunch of bone and a big wet chomp. */
  kill(at?: Place): void {
    const voice = this.voice(0.9, at);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    this.noiseHit(context, out, now, {
      type: 'highpass',
      frequency: 3500,
      volume: 0.7,
      decay: 0.05,
    });
    this.noiseHit(context, out, now + 0.02, {
      type: 'bandpass',
      frequency: 900,
      q: 1.5,
      volume: 0.8,
      decay: 0.18,
    });
    this.tone(context, out, now, { type: 'sine', from: 140, to: 40, volume: 1, decay: 0.25 });
    this.chomp(40, at);
  }

  /** A footstep thump, heavier for bigger dinosaurs. */
  footstep(bodyScale: number, at?: Place): void {
    const weight = Math.min(bodyScale / 6, 1);
    const voice = this.voice(0.12 + 0.6 * weight, at);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    const pitch = 1.6 - weight;
    this.tone(context, out, now, {
      type: 'sine',
      from: 95 * pitch,
      to: 38 * pitch,
      volume: 0.9,
      decay: 0.1 + 0.25 * weight,
    });
    this.noiseHit(context, out, now, {
      type: 'lowpass',
      frequency: 500 * pitch,
      volume: 0.35,
      decay: 0.08 + 0.12 * weight,
    });
  }

  /** A roar: a screech for the small, a deep bellow for a T-Rex, plus a rising shimmer when it's an evolution. */
  roar(tier: number, evolving: boolean, at?: Place): void {
    const voice = this.voice(0.75, at);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    const base = [0, 520, 340, 230, 140, 85][tier] ?? 140;
    const length = 0.6 + tier * 0.18;
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(base * 0.8, now);
    oscillator.frequency.linearRampToValueAtTime(base * 1.15, now + length * 0.3);
    oscillator.frequency.exponentialRampToValueAtTime(base * 0.55, now + length);
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 14;
    const depth = context.createGain();
    depth.gain.value = base * 0.06;
    vibrato.connect(depth).connect(oscillator.frequency);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(base * 4, now);
    filter.frequency.exponentialRampToValueAtTime(base * 1.5, now + length);
    filter.Q.value = 4;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.08);
    gain.gain.setValueAtTime(0.5, now + length * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    oscillator.connect(filter).connect(gain).connect(out);
    oscillator.start(now);
    vibrato.start(now);
    oscillator.stop(now + length + 0.05);
    vibrato.stop(now + length + 0.05);
    this.noiseHit(context, out, now, {
      type: 'bandpass',
      frequency: base * 3,
      q: 0.8,
      volume: 0.3,
      decay: length,
    });
    if (evolving) {
      [523, 659, 784, 1047].forEach((frequency, index) => {
        this.tone(context, out, now + index * 0.07, {
          type: 'triangle',
          from: frequency,
          to: frequency,
          volume: 0.22,
          decay: 0.5,
          attack: 0.02,
        });
      });
    }
  }

  /** Something big knocked you aside. */
  thud(): void {
    const voice = this.voice(0.6);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    this.tone(context, out, now, { type: 'sine', from: 110, to: 45, volume: 0.9, decay: 0.2 });
    this.noiseHit(context, out, now, { type: 'lowpass', frequency: 800, volume: 0.5, decay: 0.12 });
  }

  /** You were caught: a falling groan. */
  death(): void {
    const voice = this.voice(0.6);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    this.tone(context, out, now, {
      type: 'sawtooth',
      from: 300,
      to: 70,
      volume: 0.25,
      decay: 0.9,
      attack: 0.03,
    });
    this.tone(context, out, now + 0.05, { type: 'sine', from: 180, to: 50, volume: 0.5, decay: 1 });
  }

  /** A world event: a low horn call across the island. */
  horn(): void {
    const voice = this.voice(0.45);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    for (const [when, frequency] of [
      [0, 196],
      [0.38, 262],
    ] as const) {
      this.tone(context, out, now + when, {
        type: 'triangle',
        from: frequency,
        to: frequency * 0.98,
        volume: 0.45,
        decay: 0.55,
        attack: 0.05,
      });
      this.tone(context, out, now + when, {
        type: 'sine',
        from: frequency / 2,
        to: frequency / 2,
        volume: 0.35,
        decay: 0.6,
        attack: 0.05,
      });
    }
  }

  /** A volcano vent blasting steam. */
  eruption(at: Place): void {
    const voice = this.voice(0.8, at);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    this.noiseHit(context, out, now, {
      type: 'bandpass',
      frequency: 300,
      to: 1200,
      q: 0.7,
      volume: 0.8,
      decay: 1.1,
    });
    this.tone(context, out, now, { type: 'sine', from: 70, to: 30, volume: 0.6, decay: 0.6 });
  }

  /** The meteor hits: an enormous boom. */
  impact(): void {
    const voice = this.voice(1);
    if (!voice) return;
    const { context, out } = voice;
    const now = context.currentTime;
    this.tone(context, out, now, { type: 'sine', from: 90, to: 18, volume: 1, decay: 3 });
    this.noiseHit(context, out, now, {
      type: 'lowpass',
      frequency: 2000,
      to: 80,
      volume: 1,
      decay: 3.2,
    });
    this.noiseHit(context, out, now, {
      type: 'highpass',
      frequency: 3000,
      volume: 0.6,
      decay: 0.4,
    });
  }

  /** The ground rumbling as the meteor nears: 0 silent, 1 at impact. */
  setRumble(amount: number): void {
    if (!this.rumble || !this.context) return;
    const now = this.context.currentTime;
    this.rumble.gain.gain.setTargetAtTime(amount * 0.9, now, 0.3);
    this.rumble.filter.frequency.setTargetAtTime(60 + 140 * amount, now, 0.3);
  }

  /** Called every frame: the ambient bed of wind and birds. */
  update(timeSeconds: number, doom: number): void {
    const context = this.context;
    if (context?.state !== 'running' || this.muted) return;
    if (this.wind) this.wind.gain.setTargetAtTime(0.06 + 0.1 * doom, context.currentTime, 0.5);
    if (timeSeconds < this.nextBirdAt || doom > 0.3) return;
    this.nextBirdAt = timeSeconds + 2 + Math.random() * 6;
    const voice = this.voice(0.08 + Math.random() * 0.08);
    if (!voice) return;
    const now = context.currentTime;
    const base = 1800 + Math.random() * 1600;
    const calls = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < calls; i++) {
      this.tone(context, voice.out, now + i * 0.14, {
        type: 'sine',
        from: base,
        to: base * (1.3 + Math.random() * 0.4),
        volume: 0.5,
        decay: 0.09,
        attack: 0.01,
      });
    }
  }

  private startBeds(context: AudioContext, master: GainNode): void {
    if (!this.noise) return;
    // Wind: soft noise drifting through a slow-moving filter.
    const wind = context.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    wind.playbackRate.value = 0.5;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    const sway = context.createOscillator();
    sway.frequency.value = 0.08;
    const swayDepth = context.createGain();
    swayDepth.gain.value = 180;
    sway.connect(swayDepth).connect(windFilter.frequency);
    this.wind = context.createGain();
    this.wind.gain.value = 0.06;
    wind.connect(windFilter).connect(this.wind).connect(master);
    wind.start();
    sway.start();

    // The meteor's rumble, silent until the warning.
    const rumble = context.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    rumble.playbackRate.value = 0.3;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 60;
    filter.Q.value = 3;
    const gain = context.createGain();
    gain.gain.value = 0;
    rumble.connect(filter).connect(gain).connect(master);
    rumble.start();
    this.rumble = { gain, filter };
  }
}
