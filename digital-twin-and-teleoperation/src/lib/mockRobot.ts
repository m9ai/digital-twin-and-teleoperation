import type { JointState, RobotTelemetry } from '@/types';
import type { URDFJointDefinition } from '@/lib/urdfJoints';

/**
 * Mock data generator for Demo / Simulation mode.
 *
 * The workspace must be usable with no ROS 2 stack running at all, so the
 * generator synthesises a continuous joint animation from the limits parsed
 * out of the loaded URDF. Each joint gets its own frequency and phase offset
 * from a shared base, which keeps the motion smooth (C-infinite) and
 * non-repetitive enough for a demo while staying strictly inside the limits.
 */

/** Base angular frequency (rad/s) of the demo choreography. */
const BASE_OMEGA = 0.55;
/** Amplitude as a fraction of the available travel. */
const TRAVEL_FRACTION = 0.42;
/** Cap for continuous joints, whose URDF range is ±PI by convention. */
const MAX_AMPLITUDE_RAD = 1.1;

/** Used when no URDF has been parsed yet, so demo mode still animates. */
export const DEFAULT_MOCK_JOINTS: URDFJointDefinition[] = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5'].map(
  (name, index) => ({
    name,
    type: 'revolute',
    lower: index === 1 || index === 2 ? -1.4 : -Math.PI,
    upper: index === 1 || index === 2 ? 1.4 : Math.PI,
    velocity: 1,
    effort: 10,
    axis: [0, 0, 1],
    parent: index === 0 ? 'base' : `link${index}`,
    child: `link${index + 1}`,
  })
);

export interface MockJointProfile {
  name: string;
  /** Centre of the swept range. */
  center: number;
  amplitude: number;
  omega: number;
  phase: number;
}

export function buildMockProfiles(joints: URDFJointDefinition[]): MockJointProfile[] {
  return joints.map((joint, index) => {
    const lower = Math.min(joint.lower, joint.upper);
    const upper = Math.max(joint.lower, joint.upper);
    const isPrismatic = joint.type === 'prismatic';
    const halfSpan = (upper - lower) / 2;

    const amplitude = isPrismatic
      ? halfSpan * TRAVEL_FRACTION
      : joint.type === 'continuous'
        ? MAX_AMPLITUDE_RAD
        : Math.min(halfSpan * TRAVEL_FRACTION, MAX_AMPLITUDE_RAD);

    return {
      name: joint.name,
      center: (lower + upper) / 2,
      amplitude: Number.isFinite(amplitude) ? amplitude : MAX_AMPLITUDE_RAD,
      // Slightly detune every joint so the arm never looks like a rigid sweep.
      omega: BASE_OMEGA * (1 + index * 0.17),
      phase: index * 0.9,
    };
  });
}

/**
 * Profiles are derived only from the URDF limits, so they are cached by joint
 * list identity — the generator runs at 100 Hz and must not allocate per tick.
 */
const profileCache = new WeakMap<URDFJointDefinition[], MockJointProfile[]>();

export function getMockProfiles(joints: URDFJointDefinition[]): MockJointProfile[] {
  const cached = profileCache.get(joints);
  if (cached) return cached;
  const profiles = buildMockProfiles(joints);
  profileCache.set(joints, profiles);
  return profiles;
}

export function sampleMockPositions(profiles: MockJointProfile[], timeSeconds: number): number[] {
  return profiles.map(
    (profile) => profile.center + Math.sin(timeSeconds * profile.omega + profile.phase) * profile.amplitude
  );
}

export function sampleMockVelocities(profiles: MockJointProfile[], timeSeconds: number): number[] {
  return profiles.map(
    (profile) => Math.cos(timeSeconds * profile.omega + profile.phase) * profile.amplitude * profile.omega
  );
}

/**
 * Build the simulated /joint_states message.
 *
 * Manual jog targets still win over the generated animation for the joints the
 * operator is driving, so the demo mode stays interactive.
 */
export function buildMockJointState(
  joints: URDFJointDefinition[],
  targets: Record<string, number> = {},
  jogActive = false,
  timeSeconds = Date.now() / 1000
): JointState {
  const profiles = getMockProfiles(joints);

  const name: string[] = [];
  const position: number[] = [];
  const velocity: number[] = [];
  const effort: number[] = [];

  for (const profile of profiles) {
    name.push(profile.name);

    if (jogActive && targets[profile.name] !== undefined) {
      position.push(targets[profile.name]);
      velocity.push(0);
    } else {
      const phase = timeSeconds * profile.omega + profile.phase;
      position.push(profile.center + Math.sin(phase) * profile.amplitude);
      velocity.push(Math.cos(phase) * profile.amplitude * profile.omega);
    }

    effort.push(Math.random() * 2);
  }

  return { name, position, velocity, effort };
}

/** Smoothly drifting telemetry so charts and gauges look alive in demo mode. */
export function buildMockTelemetry(timeSeconds = Date.now() / 1000): RobotTelemetry {
  return {
    batteryPercent: 78 + Math.sin(timeSeconds * 0.05) * 6,
    batteryVoltage: 24 + Math.sin(timeSeconds * 0.08) * 0.6,
    linearVelocity: Math.abs(Math.sin(timeSeconds * 0.4)) * 0.8,
    angularVelocity: Math.sin(timeSeconds * 0.33) * 0.9,
    cpuTemp: 44 + Math.sin(timeSeconds * 0.11) * 6,
    timestamp: Date.now(),
  };
}
