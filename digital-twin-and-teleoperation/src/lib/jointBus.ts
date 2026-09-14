import type { JointState } from '@/types';

/**
 * Out-of-band joint-state channel.
 *
 * `/joint_states` can arrive at 100 Hz; routing every message through React
 * state would re-render the whole workspace at that rate. Telemetry panels
 * subscribe to the throttled store instead, while the 3D view subscribes here
 * and samples the stream inside its render loop.
 */

type Listener = (state: JointState) => void;

const listeners = new Set<Listener>();

let lastState: JointState | null = null;

export function publishJointState(state: JointState): void {
  lastState = state;
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      console.error('[jointBus] listener failed:', err);
    }
  }
}

export function subscribeJointState(listener: Listener): () => void {
  listeners.add(listener);
  if (lastState) listener(lastState);
  return () => {
    listeners.delete(listener);
  };
}

export function getLastJointState(): JointState | null {
  return lastState;
}
