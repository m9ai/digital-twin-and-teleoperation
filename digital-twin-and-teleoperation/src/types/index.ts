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
