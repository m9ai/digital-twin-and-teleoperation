/**
 * Convert a recorded trajectory into ROS 2 `trajectory_msgs/JointTrajectory`
 * so it can be handed straight to `joint_trajectory_controller`.
 *
 * Times use the ROS 2 `builtin_interfaces/Time` field names (`sec` /
 * `nanosec`), which is what rosbridge expects on a ROS 2 system.
 */
import type { JointTrajectory } from '@/types';
import { sampleTrajectory } from '@/lib/trajectory';

/** Default input topic of a ros2_control joint_trajectory_controller. */
export const ROS_TRAJECTORY_TOPIC = '/joint_trajectory_controller/joint_trajectory';
export const ROS_TRAJECTORY_TYPE = 'trajectory_msgs/JointTrajectory';
export const ROS_ACTION_TYPE = 'control_msgs/action/FollowJointTrajectory';
export const ROS_ACTION_NAME = '/joint_trajectory_controller/follow_joint_trajectory';

export interface RosTrajectoryOptions {
  /** Resample to a fixed control period; 0 keeps the recorded frames. */
  stepMs?: number;
  includeVelocities?: boolean;
  frameId?: string;
}

export interface RosDuration {
  sec: number;
  nanosec: number;
}

export interface RosTrajectoryPoint {
  positions: number[];
  velocities: number[];
  accelerations: number[];
  time_from_start: RosDuration;
}

export interface RosJointTrajectory {
  header: { stamp: RosDuration; frame_id: string };
  joint_names: string[];
  points: RosTrajectoryPoint[];
}

function toRosDuration(tMs: number): RosDuration {
  const sec = Math.floor(tMs / 1000);
  const nanosec = Math.round((tMs - sec * 1000) * 1e6);
  return { sec, nanosec };
}

/** Sample times: either a fixed control period or the original frame timing. */
function buildSampleTimes(traj: JointTrajectory, stepMs: number): number[] {
  if (stepMs > 0) {
    const times: number[] = [];
    for (let t = 0; t < traj.durationMs; t += stepMs) times.push(t);
    times.push(traj.durationMs);
    return times;
  }
  return traj.frames.map((frame) => frame.t);
}

/** Central-difference velocities in rad/s; one-sided at both ends. */
function estimateVelocities(times: number[], positions: number[][]): number[][] {
  const dof = positions[0]?.length ?? 0;

  return positions.map((_, i) => {
    const prev = positions[i - 1];
    const next = positions[i + 1];

    if (prev && next) {
      const dt = (times[i + 1] - times[i - 1]) / 1000;
      return Array.from({ length: dof }, (_, j) => (dt > 0 ? (next[j] - prev[j]) / dt : 0));
    }

    // One-sided difference at the ends: forward-looking at the start,
    // backward-looking at the end.
    const dt = Math.abs(times[i + (next ? 1 : -1)] - times[i]) / 1000;
    const neighbour = next ?? prev;
    if (!neighbour || dt === 0) return new Array<number>(dof).fill(0);

    const from = next ? positions[i] : neighbour;
    const to = next ? neighbour : positions[i];
    return Array.from({ length: dof }, (_, j) => (to[j] - from[j]) / dt);
  });
}

export function toRosJointTrajectory(
  traj: JointTrajectory,
  options: RosTrajectoryOptions = {}
): RosJointTrajectory {
  const stepMs = options.stepMs && options.stepMs > 0 ? options.stepMs : 0;
  const includeVelocities = options.includeVelocities ?? true;

  const times = buildSampleTimes(traj, stepMs);
  const positions = times.map((t) => sampleTrajectory(traj, t));
  const velocities = includeVelocities
    ? estimateVelocities(times, positions)
    : positions.map((p) => p.map(() => 0));

  const now = Date.now();

  return {
    header: {
      stamp: toRosDuration(now),
      frame_id: options.frameId ?? '',
    },
    joint_names: [...traj.jointNames],
    points: times.map((t, i) => ({
      positions: positions[i].map((v) => Number(v.toFixed(6))),
      velocities: velocities[i].map((v) => Number(v.toFixed(6))),
      accelerations: velocities[i].map(() => 0),
      time_from_start: toRosDuration(t),
    })),
  };
}

/** rosbridge `send_action_goal` payload for FollowJointTrajectory. */
export function toFollowJointTrajectoryGoal(
  traj: JointTrajectory,
  options: RosTrajectoryOptions = {}
): Record<string, unknown> {
  return {
    action: ROS_ACTION_NAME,
    action_type: ROS_ACTION_TYPE,
    goal: { trajectory: toRosJointTrajectory(traj, options) },
  };
}

interface PublishableRosClient {
  publish: (topic: string, type: string, payload: Record<string, unknown>) => void;
}

export function publishJointTrajectory(
  client: PublishableRosClient | null,
  message: RosJointTrajectory,
  topic: string = ROS_TRAJECTORY_TOPIC
): void {
  if (!client) throw new Error('ROS 未连接');
  client.publish(topic, ROS_TRAJECTORY_TYPE, message as unknown as Record<string, unknown>);
}
