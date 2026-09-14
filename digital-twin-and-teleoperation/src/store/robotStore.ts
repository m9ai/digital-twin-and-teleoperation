import { create } from 'zustand';
import type { JointState, RobotTelemetry } from '@/types';

export interface RobotState {
  jointState: JointState;
  telemetry: RobotTelemetry;
  eStop: boolean;
  logs: string[];
  setJointState: (state: JointState) => void;
  setTelemetry: (telemetry: Partial<RobotTelemetry>) => void;
  toggleEStop: () => void;
  setEStop: (active: boolean) => void;
  addLog: (message: string) => void;
}

const initialTelemetry: RobotTelemetry = {
  batteryPercent: 84,
  batteryVoltage: 24.2,
  linearVelocity: 0,
  angularVelocity: 0,
  cpuTemp: 42,
  timestamp: Date.now(),
};

export const useRobotStore = create<RobotState>((set) => ({
  jointState: {
    name: [],
    position: [],
    velocity: [],
    effort: [],
  },
  telemetry: initialTelemetry,
  eStop: false,
  logs: [],
  setJointState: (state) => set({ jointState: state }),
  setTelemetry: (telemetry) =>
    set((prev) => ({
      telemetry: { ...prev.telemetry, ...telemetry, timestamp: Date.now() },
    })),
  toggleEStop: () => set((prev) => ({ eStop: !prev.eStop })),
  setEStop: (active) => set({ eStop: active }),
  addLog: (message) =>
    set((prev) => ({
      logs: [message, ...prev.logs].slice(0, 200),
    })),
}));
