/**
 * Joint trajectory sampling, serialization and validation.
 *
 * A trajectory is a time-stamped sequence of joint positions. It is the unit
 * of exchange for the record / replay feature: it can be captured from a live
 * teleoperation session, replayed against the digital twin or the real robot,
 * and exported as JSON so another operator can reproduce the exact motion.
 */
import type { JointTrajectory, TrajectoryFrame } from '@/types';

export const TRAJECTORY_FILE_FORMAT = 'embodied-ai.joint-trajectory';
export const TRAJECTORY_FILE_VERSION = 1;

export interface TrajectoryFile {
  format: typeof TRAJECTORY_FILE_FORMAT;
  version: number;
  trajectory: JointTrajectory;
}

export function createTrajectoryId(): string {
  return `traj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/**
 * Linearly interpolate the joint positions at `tMs`.
 *
 * Interpolation matters for safety: replaying raw keyframes would send step
 * changes to the controller, whereas the recorded motion was continuous.
 */
export function sampleTrajectory(traj: JointTrajectory, tMs: number): number[] {
  const frames = traj.frames;
  const dof = traj.jointNames.length;

  if (frames.length === 0) return new Array<number>(dof).fill(0);

  const first = frames[0];
  if (frames.length === 1 || tMs <= first.t) return padPositions(first.position, dof);

  const last = frames[frames.length - 1];
  if (tMs >= last.t) return padPositions(last.position, dof);

  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= tMs) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];
  const span = b.t - a.t;
  const alpha = span > 0 ? (tMs - a.t) / span : 0;

  const out = new Array<number>(dof);
  for (let i = 0; i < dof; i++) {
    const av = a.position[i] ?? 0;
    const bv = b.position[i] ?? 0;
    out[i] = av + (bv - av) * alpha;
  }
  return out;
}

function padPositions(position: number[], dof: number): number[] {
  const out = new Array<number>(dof);
  for (let i = 0; i < dof; i++) out[i] = position[i] ?? 0;
  return out;
}

/** Recompute `durationMs` from the frames so imported files stay self-consistent. */
export function normalizeTrajectory(traj: JointTrajectory): JointTrajectory {
  const frames = traj.frames
    .filter(
      (f): f is TrajectoryFrame =>
        Number.isFinite(f?.t) && Array.isArray(f?.position) && f.position.every((v) => Number.isFinite(v))
    )
    .map((f) => ({ t: f.t, position: f.position.map((v) => Number(v)) }))
    .sort((a, b) => a.t - b.t);

  const durationMs = frames.length > 0 ? frames[frames.length - 1].t : 0;

  return {
    ...traj,
    frames,
    durationMs,
  };
}

/** Trigger a browser download for a JSON payload. */
export function downloadJsonFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function serializeTrajectory(traj: JointTrajectory): string {
  const file: TrajectoryFile = {
    format: TRAJECTORY_FILE_FORMAT,
    version: TRAJECTORY_FILE_VERSION,
    trajectory: traj,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse an uploaded trajectory file. Throws with a user-facing message when
 * the payload is not a trajectory this app produced.
 */
export function parseTrajectoryFile(raw: string): JointTrajectory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('不是合法的 JSON 文件');
  }

  const candidate = (() => {
    if (Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.format === TRAJECTORY_FILE_FORMAT && obj.trajectory) {
      return obj.trajectory as Record<string, unknown>;
    }
    // Also accept a bare trajectory object.
    if (Array.isArray(obj.frames) && Array.isArray(obj.jointNames)) return obj;
    return null;
  })();

  if (!candidate) throw new Error('不是动作轨迹文件（缺少 trajectory 字段）');
  if (!Array.isArray(candidate.jointNames) || candidate.jointNames.some((n) => typeof n !== 'string')) {
    throw new Error('轨迹缺少合法的 jointNames');
  }
  if (!Array.isArray(candidate.frames) || candidate.frames.length === 0) {
    throw new Error('轨迹不包含任何采样帧');
  }

  const source = candidate.source === 'live' ? 'live' : 'simulation';

  return normalizeTrajectory({
    id: typeof candidate.id === 'string' ? candidate.id : createTrajectoryId(),
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : '导入轨迹',
    createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : Date.now(),
    jointNames: candidate.jointNames as string[],
    durationMs: Number.isFinite(candidate.durationMs) ? Number(candidate.durationMs) : 0,
    frames: candidate.frames as TrajectoryFrame[],
    source,
  });
}
