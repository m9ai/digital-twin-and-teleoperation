import { create } from 'zustand';
import type { JointState, RobotTelemetry } from '@/types';

export interface RobotState {
  jointState: JointState;
  telemetry: RobotTelemetry;
  eStop: boolean;
  logs: string[];
  /** Manual jog targets keyed by joint name; only meaningful while jogActive. */
  jointTargets: Record<string, number>;
  jogActive: boolean;
  setJointState: (state: JointState) => void;
  setJointTarget: (name: string, value: number) => void;
  setJointTargets: (targets: Record<string, number>) => void;
  setJogActive: (active: boolean) => void;
  clearJointTargets: () => void;
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
  jointTargets: {},
  jogActive: false,
  setJointState: (state) => set({ jointState: state }),
  setJointTarget: (name, value) =>
    set((prev) => ({ jointTargets: { ...prev.jointTargets, [name]: value } })),
  setJointTargets: (targets) => set({ jointTargets: targets }),
  setJogActive: (active) => set({ jogActive: active }),
  clearJointTargets: () => set({ jointTargets: {} }),
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
