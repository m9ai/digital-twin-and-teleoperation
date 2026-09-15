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
  /** Robot link ↔ static scene obstacle contacts (opt-in per environment). */
  obstacles: LinkProximity[];
  at: number;
}

/* ------------------------------------------------------------------ *
 * Scene / environment
 * ------------------------------------------------------------------ */

/** Built-in environments procedurally generated in the browser. */
export type EnvironmentPresetId = 'none' | 'workshop' | 'room' | 'street' | 'lab';

/** Viewport backdrop. Rendered as a vertical gradient / sky quad. */
export type SceneBackgroundId = 'studio' | 'night' | 'daylight' | 'transparent';

/** Placement of a user supplied scene model, applied on top of auto-fit. */
export interface CustomSceneTransform {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
}

export type CustomSceneStatus = 'loading' | 'ready' | 'error';

export interface CustomSceneStats {
  meshes: number;
  triangles: number;
  /** Bounding box size in metres after normalization. */
  size: [number, number, number];
}

/** A user uploaded 3D scene (.glb / .gltf) placed around the robot. */
export interface CustomScene {
  id: string;
  /** Original file name. */
  name: string;
  /** Object URL of the uploaded file. */
  url: string;
  visible: boolean;
  /** Normalize any authoring unit / origin so the model lands around the robot. */
  autoFit: boolean;
  /** Longest edge in metres used when `autoFit` is on. */
  targetSize: number;
  /** Rotate -90° about X: for scenes exported from a Z-up tool. */
  zUp: boolean;
  transform: CustomSceneTransform;
  status: CustomSceneStatus;
  error?: string;
  stats?: CustomSceneStats;
}

export interface SceneLightingConfig {
  /** Compass direction of the key light, degrees. */
  azimuthDeg: number;
  /** Height of the key light above the horizon, degrees. */
  elevationDeg: number;
  intensity: number;
  ambient: number;
  /** Image based lighting from a procedural room HDR. */
  envMap: boolean;
  envIntensity: number;
  exposure: number;
  shadows: boolean;
}

export interface SceneSafetyConfig {
  /** Include scene obstacles in the proximity scan. */
  obstacleCheck: boolean;
  /** Gap below which a robot link reports a scene contact warning. */
  warnDistance: number;
}

/** Snapshot of everything the environment rig needs to render a scene. */
export interface EnvironmentSettings {
  preset: EnvironmentPresetId;
  grid: { visible: boolean; size: number; divisions: number };
  axes: boolean;
  background: SceneBackgroundId;
  lighting: SceneLightingConfig;
  safety: SceneSafetyConfig;
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
