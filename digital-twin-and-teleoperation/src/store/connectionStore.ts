import { create } from 'zustand';
import type { ConnectionStatus } from '@/types';

export interface ConnectionState {
  status: ConnectionStatus;
  useSimulation: boolean;
  setConnected: (connected: boolean) => void;
  setUrl: (url: string) => void;
  setLatency: (latencyMs: number | null) => void;
  setError: (error: string | null) => void;
  setUseSimulation: (use: boolean) => void;
  resetError: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: {
    connected: false,
    url: 'ws://localhost:9090',
    latencyMs: null,
    error: null,
  },
  useSimulation: true,
  setConnected: (connected) =>
    set((prev) => ({ status: { ...prev.status, connected, error: connected ? null : prev.status.error } })),
  setUrl: (url) =>
    set((prev) => ({ status: { ...prev.status, url } })),
  setLatency: (latencyMs) =>
    set((prev) => ({ status: { ...prev.status, latencyMs } })),
  setError: (error) =>
    set((prev) => ({ status: { ...prev.status, error } })),
  setUseSimulation: (useSimulation) => set({ useSimulation }),
  resetError: () =>
    set((prev) => ({ status: { ...prev.status, error: null } })),
}));
