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

/** 位姿：`geometry_msgs/Pose` 的浏览器等价结构，用于 IK 目标下发。 */
export interface Pose {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
}

/** 超限/碰撞预警等级：`warn` 接近限界，`violation` 已越界。 */
export type SafetyLevel = 'warn' | 'violation';

export interface JointLimitWarning {
  joint: string;
  value: number;
  lower: number;
  upper: number;
  /** 距离最近限界的归一化余量，0 = 已在限界上，1 = 位于行程中点。 */
  margin: number;
  level: SafetyLevel;
}

export interface LinkProximity {
  a: string;
  b: string;
  distance: number;
  level: SafetyLevel;
}

export interface SafetyReport {
  joints: JointLimitWarning[];
  proximity: LinkProximity[];
  at: number;
}

/** 可复用的相机预设编号。 */
export type CameraPresetId = 'perspective' | 'head' | 'top' | 'tcp';

export type GizmoMode = 'translate' | 'rotate';

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
