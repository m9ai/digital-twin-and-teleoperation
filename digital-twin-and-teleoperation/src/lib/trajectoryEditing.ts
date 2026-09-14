/**
 * Trajectory editing primitives.
 *
 * All helpers are pure: they take a trajectory and return a new one, so the
 * library entry can be swapped atomically and the UI stays predictable.
 */
import type { JointTrajectory, TrajectoryFrame } from '@/types';
import { normalizeTrajectory, sampleTrajectory } from '@/lib/trajectory';

function cloneFrame(frame: TrajectoryFrame): TrajectoryFrame {
  return { t: frame.t, position: [...frame.position] };
}

/** Stretch or compress time. factor > 1 slows the motion down. */
export function scaleTrajectoryTime(traj: JointTrajectory, factor: number): JointTrajectory {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if (safeFactor === 1) return traj;

  return normalizeTrajectory({
    ...traj,
    frames: traj.frames.map((frame) => ({ t: frame.t * safeFactor, position: [...frame.position] })),
  });
}

/**
 * Drop frames that are closer together than `minGapMs`, always keeping the
 * first and last sample so the motion endpoints are preserved.
 */
export function decimateTrajectory(traj: JointTrajectory, minGapMs: number): JointTrajectory {
  const gap = Number.isFinite(minGapMs) && minGapMs > 0 ? minGapMs : 0;
  if (gap === 0 || traj.frames.length <= 2) return traj;

  const kept: TrajectoryFrame[] = [cloneFrame(traj.frames[0])];
  let lastKeptT = kept[0].t;

  for (const frame of traj.frames) {
    if (frame.t - lastKeptT >= gap && frame.t !== traj.frames[traj.frames.length - 1].t) {
      kept.push(cloneFrame(frame));
      lastKeptT = frame.t;
    }
  }

  const last = traj.frames[traj.frames.length - 1];
  if (last.t - lastKeptT > 0) kept.push(cloneFrame(last));

  if (kept.length < 2) return traj;

  return normalizeTrajectory({ ...traj, frames: kept });
}

/** Keep only [startMs, endMs], re-timed so the result starts at t = 0. */
export function trimTrajectory(traj: JointTrajectory, startMs: number, endMs: number): JointTrajectory {
  const start = Math.max(0, Math.min(startMs, endMs));
  const end = Math.min(traj.durationMs, Math.max(startMs, endMs));
  if (end - start <= 0) return traj;

  const frames: TrajectoryFrame[] = [{ t: 0, position: sampleTrajectory(traj, start) }];
  for (const frame of traj.frames) {
    if (frame.t > start && frame.t < end) {
      frames.push({ t: frame.t - start, position: [...frame.position] });
    }
  }
  frames.push({ t: end - start, position: sampleTrajectory(traj, end) });

  return normalizeTrajectory({ ...traj, frames });
}

export function canConcat(a: JointTrajectory, b: JointTrajectory): boolean {
  return a.jointNames.length === b.jointNames.length && a.jointNames.every((name, i) => name === b.jointNames[i]);
}

/** Append `b` after `a`; the caller owns naming / id assignment. */
export function concatTrajectories(a: JointTrajectory, b: JointTrajectory): JointTrajectory {
  if (!canConcat(a, b)) {
    throw new Error('两条轨迹的关节不一致，无法拼接');
  }

  const offset = a.durationMs;
  const frames: TrajectoryFrame[] = a.frames.map(cloneFrame);

  for (const frame of b.frames) {
    if (frame.t === 0 && frames.length > 0) continue;
    frames.push({ t: frame.t + offset, position: [...frame.position] });
  }

  return normalizeTrajectory({
    ...a,
    frames,
  });
}
