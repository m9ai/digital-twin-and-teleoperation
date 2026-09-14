/**
 * Applies a trajectory sample to whatever the platform is currently driving.
 *
 * - Simulation: writes joint targets so the existing synthetic /joint_states
 *   loop carries them into the digital twin (no second source of truth).
 * - Live ROS: publishes /joint_command, throttled to avoid flooding rosbridge.
 */
import type { JointTrajectory } from '@/types';
import { useRobotStore } from '@/store/robotStore';
import { useConnectionStore } from '@/store/connectionStore';
import { rosClientRef } from '@/lib/rosRef';
import { sampleTrajectory } from '@/lib/trajectory';

const LIVE_PUBLISH_MS = 60;

let lastPublishAt = 0;

export function applyTrajectorySample(trajectory: JointTrajectory, tMs: number, force = false): void {
  const positions = sampleTrajectory(trajectory, tMs);

  if (useConnectionStore.getState().useSimulation) {
    const targets: Record<string, number> = { ...useRobotStore.getState().jointTargets };
    trajectory.jointNames.forEach((name, i) => {
      targets[name] = positions[i];
    });
    useRobotStore.getState().setJointTargets(targets);
    return;
  }

  const now = performance.now();
  if (!force && now - lastPublishAt < LIVE_PUBLISH_MS) return;
  lastPublishAt = now;

  try {
    rosClientRef.current?.publishJointCommand(trajectory.jointNames, positions);
  } catch (err) {
    useRobotStore
      .getState()
      .addLog(`回放下发失败：${err instanceof Error ? err.message : 'ROS 未连接'}`);
  }
}
