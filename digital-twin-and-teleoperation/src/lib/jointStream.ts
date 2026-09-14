import type { JointState } from '@/types';

/**
 * Ring buffer + interpolator for high frequency `/joint_states`.
 *
 * ROS bridges commonly push joint state at 50-200 Hz while the browser only
 * paints at 60 FPS, and WebSocket delivery is bursty. Pushing every message
 * straight into React / Three.js causes visible stutter and wasted renders.
 *
 * The stream therefore:
 *  1. records every incoming sample into a fixed-size ring buffer (no GC churn),
 *  2. renders at the display rate with a small playback delay, and
 *  3. linearly interpolates between the two samples that bracket the render
 *     timestamp, which removes the stepping caused by rate mismatch.
 */

export interface JointStreamOptions {
  /** Number of samples retained (≈ 1 s at 100 Hz by default). */
  capacity?: number;
  /** Playback delay in ms; guarantees a bracketing pair exists. */
  interpolationDelayMs?: number;
  /**
   * Joints without hard limits (continuous). Their angle wraps at ±PI, so
   * interpolation takes the shortest arc instead of the naive difference.
   */
  continuous?: (name: string) => boolean;
}

const DEFAULT_CAPACITY = 128;
const DEFAULT_DELAY_MS = 80;
/** Wrapping joints closer than this to ±PI interpolation flip is corrected. */
const SHORTEST_ARC_THRESHOLD = Math.PI;

export class JointStateStream {
  private capacity: number;
  private delayMs: number;
  private isContinuous: (name: string) => boolean;

  private names: string[] = [];
  private dof = 0;
  private times: Float64Array;
  private values: Float64Array;

  /** Number of valid samples (<= capacity). */
  private size = 0;
  /** Index the next sample will be written to. */
  private head = 0;

  /** Rolling window used to estimate the incoming message rate. */
  private rateWindow: number[] = [];
  private estimatedHz = 0;

  private scratch: Float64Array = new Float64Array(0);

  constructor(options: JointStreamOptions = {}) {
    this.capacity = Math.max(2, options.capacity ?? DEFAULT_CAPACITY);
    this.delayMs = options.interpolationDelayMs ?? DEFAULT_DELAY_MS;
    this.isContinuous = options.continuous ?? (() => false);
    this.times = new Float64Array(this.capacity);
    this.values = new Float64Array(0);
  }

  get sampleCount(): number {
    return this.size;
  }

  get jointNames(): string[] {
    return this.names;
  }

  /** Measured input rate in Hz (0 until two samples have arrived). */
  get inputRateHz(): number {
    return this.estimatedHz;
  }

  setPlaybackDelay(delayMs: number): void {
    this.delayMs = Math.max(0, delayMs);
  }

  private ensureCapacity(names: string[]): void {
    if (names.length === this.dof && names.every((n, i) => n === this.names[i])) return;

    this.names = [...names];
    this.dof = names.length;
    this.values = new Float64Array(this.capacity * this.dof);
    this.scratch = new Float64Array(this.dof);
    this.size = 0;
    this.head = 0;
    this.rateWindow = [];
  }

  /** Timestamp of the k-th newest sample (k = 0 is the newest). */
  private timeAt(k: number): number {
    const index = (this.head - 1 - k + this.capacity * 2) % this.capacity;
    return this.times[index];
  }

  push(state: JointState, timestamp = performance.now()): void {
    const names = state.name ?? [];
    if (names.length === 0) return;

    this.ensureCapacity(names);

    const base = this.head * this.dof;
    for (let i = 0; i < this.dof; i++) {
      const value = state.position?.[i];
      this.values[base + i] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    this.times[this.head] = timestamp;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;

    this.rateWindow.push(timestamp);
    while (this.rateWindow.length > 2 && timestamp - this.rateWindow[0] > 1000) {
      this.rateWindow.shift();
    }
    if (this.rateWindow.length >= 2) {
      const span = this.rateWindow[this.rateWindow.length - 1] - this.rateWindow[0];
      this.estimatedHz = span > 0 ? ((this.rateWindow.length - 1) / span) * 1000 : 0;
    }
  }

  /** Copy the k-th newest sample into `out`. */
  private readInto(k: number, out: Float64Array | number[]): void {
    const index = (this.head - 1 - k + this.capacity * 2) % this.capacity;
    const base = index * this.dof;
    for (let i = 0; i < this.dof; i++) out[i] = this.values[base + i];
  }

  /**
   * Interpolate the joint positions at `timestamp - playbackDelay`.
   * Returns `false` when no sample is available yet.
   */
  sampleInto(timestamp: number, out: number[]): boolean {
    if (this.size === 0 || this.dof === 0) return false;
    if (out.length !== this.dof) {
      out.length = this.dof;
    }

    const target = timestamp - this.delayMs;
    const newest = this.timeAt(0);
    if (target >= newest || this.size === 1) {
      this.readInto(0, out);
      return true;
    }

    const oldest = this.timeAt(this.size - 1);
    if (target <= oldest) {
      this.readInto(this.size - 1, out);
      return true;
    }

    // timeAt() decreases with k: find lo >= target >= hi.
    let lo = 0;
    let hi = this.size - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) >= target) lo = mid;
      else hi = mid;
    }

    const t0 = this.timeAt(hi);
    const t1 = this.timeAt(lo);
    const alpha = t1 > t0 ? (target - t0) / (t1 - t0) : 0;

    this.readInto(hi, this.scratch);
    const newerIndex = (this.head - 1 - lo + this.capacity * 2) % this.capacity;
    const newerBase = newerIndex * this.dof;

    for (let i = 0; i < this.dof; i++) {
      const a = this.scratch[i];
      const b = this.values[newerBase + i];
      let delta = b - a;
      if (this.isContinuous(this.names[i]) && Math.abs(delta) > SHORTEST_ARC_THRESHOLD) {
        delta -= Math.sign(delta) * Math.PI * 2;
      }
      out[i] = a + delta * alpha;
    }

    return true;
  }

  /** Convenience wrapper allocating a fresh array (avoid in hot paths). */
  sample(timestamp: number): number[] | null {
    const out: number[] = [];
    return this.sampleInto(timestamp, out) ? out : null;
  }

  /** Latest raw sample, used for UI readouts. */
  latest(): number[] | null {
    if (this.size === 0) return null;
    const out = new Array<number>(this.dof);
    this.readInto(0, out);
    return out;
  }

  reset(): void {
    this.size = 0;
    this.head = 0;
    this.rateWindow = [];
    this.estimatedHz = 0;
  }
}
