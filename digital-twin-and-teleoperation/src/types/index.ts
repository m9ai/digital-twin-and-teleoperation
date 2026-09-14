export interface JointState {
  name: string[];
  position: number[];
  velocity: number[];
  effort: number[];
}

export interface RobotTelemetry {
  batteryPercent: number;
  batteryVoltage: number;
  linearVelocity: number;
  angularVelocity: number;
  cpuTemp: number;
  timestamp: number;
}

export interface Twist {
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
}

export interface ConnectionStatus {
  connected: boolean;
  url: string;
  latencyMs: number | null;
  error: string | null;
}

export interface GamepadAxes {
  x: number;
  y: number;
}

/** One sample of a recorded motion: joint positions at a relative timestamp. */
export interface TrajectoryFrame {
  /** Milliseconds elapsed since the start of the recording. */
  t: number;
  /** Joint positions, index-aligned with the owning trajectory's `jointNames`. */
  position: number[];
}

/** A recordable / replayable joint-space motion. */
export interface JointTrajectory {
  id: string;
  name: string;
  createdAt: number;
  jointNames: string[];
  durationMs: number;
  frames: TrajectoryFrame[];
  source: 'simulation' | 'live';
}
