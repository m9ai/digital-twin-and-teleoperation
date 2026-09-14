/**
 * Motion record & replay state.
 *
 * Recording samples the incoming /joint_states stream (whatever drives the
 * digital twin — simulation or live ROS) into a time-stamped trajectory.
 * Replaying walks that trajectory back out: in simulation it drives the twin
 * through joint targets, in live mode it publishes /joint_command at a
 * throttled rate and stays interruptible by E-Stop.
 */
import { create } from 'zustand';
import type { JointState, JointTrajectory, TrajectoryFrame } from '@/types';
import { useRobotStore } from '@/store/robotStore';
import { useConnectionStore } from '@/store/connectionStore';
import { createTrajectoryId, normalizeTrajectory } from '@/lib/trajectory';
import { concatTrajectories } from '@/lib/trajectoryEditing';

export type RecordingSource = 'simulation' | 'live';
export type PlaybackSpeed = 0.5 | 1 | 2;

/** Cap the sampling rate so a high-frequency live stream cannot exhaust memory. */
const MIN_SAMPLE_MS = 10;
const MAX_FRAMES = 20000;
/** How often the recording HUD (elapsed time / frame count) refreshes. */
const UI_TICK_MS = 200;

let recordingActive = false;
let recordJointNames: string[] = [];
let recordSource: RecordingSource = 'simulation';
let recordStartedAt = 0;
let recordLastSampleAt = 0;
let recordBuffer: TrajectoryFrame[] = [];
let uiTimer: number | null = null;
/** Jog state captured when playback takes over the joints, restored on stop. */
let restoreJogActive = false;

export interface RecordingState {
  isRecording: boolean;
  recordedMs: number;
  recordedFrames: number;

  library: JointTrajectory[];
  selectedId: string | null;

  isPlaying: boolean;
  playheadMs: number;
  speed: PlaybackSpeed;
  loop: boolean;
  /** Live-mode gate: the operator must explicitly arm replay on real hardware. */
  liveArmed: boolean;

  startRecording: (jointNames: string[], source: RecordingSource) => void;
  captureFrame: (jointState: JointState) => void;
  stopRecording: () => void;
  discardRecording: () => void;

  addTrajectory: (trajectory: JointTrajectory) => void;
  selectTrajectory: (id: string | null) => void;
  removeTrajectory: (id: string) => void;
  /** Edit in place: the updater returns a new trajectory for the same entry. */
  updateTrajectory: (
    id: string,
    updater: (trajectory: JointTrajectory) => JointTrajectory,
    label: string
  ) => void;
  /** Append another library entry after `targetId`, producing a new entry. */
  appendTrajectory: (targetId: string, sourceId: string) => void;

  setPlayhead: (ms: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  toggleLoop: () => void;
  setLiveArmed: (armed: boolean) => void;
  play: () => void;
  pause: () => void;
  stopPlayback: (reason?: string) => void;
}

function log(message: string): void {
  useRobotStore.getState().addLog(message);
}

function nextTrajectoryName(library: JointTrajectory[]): string {
  let max = 0;
  for (const item of library) {
    const match = /^轨迹\s*(\d+)$/.exec(item.name);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `轨迹 ${max + 1}`;
}

export const useRecordingStore = create<RecordingState>((set, get) => {
  const stopUiTimer = () => {
    if (uiTimer !== null) {
      window.clearInterval(uiTimer);
      uiTimer = null;
    }
  };

  const finalize = (discard: boolean): void => {
    if (!recordingActive) return;
    recordingActive = false;
    stopUiTimer();

    const frames = recordBuffer;
    recordBuffer = [];
    set({ isRecording: false, recordedMs: 0, recordedFrames: 0 });

    if (discard) {
      log('录制已放弃');
      return;
    }

    if (frames.length < 2) {
      log('录制时间过短，未生成轨迹');
      return;
    }

    const durationMs = frames[frames.length - 1].t;
    const trajectory: JointTrajectory = {
      id: createTrajectoryId(),
      name: nextTrajectoryName(get().library),
      createdAt: Date.now(),
      jointNames: [...recordJointNames],
      durationMs,
      frames,
      source: recordSource,
    };

    set((prev) => ({
      library: [trajectory, ...prev.library],
      selectedId: trajectory.id,
      playheadMs: 0,
    }));
    log(
      `录制完成：${trajectory.name}（${frames.length} 帧 / ${(durationMs / 1000).toFixed(1)}s / ${trajectory.jointNames.length} 关节）`
    );
  };

  const haltPlayback = () => {
    set({ isPlaying: false, playheadMs: 0 });
    useRobotStore.getState().setJogActive(restoreJogActive);
    if (!restoreJogActive) useRobotStore.getState().clearJointTargets();
  };

  return {
    isRecording: false,
    recordedMs: 0,
    recordedFrames: 0,
    library: [],
    selectedId: null,
    isPlaying: false,
    playheadMs: 0,
    speed: 1,
    loop: false,
    liveArmed: false,

    startRecording: (jointNames, source) => {
      if (recordingActive) return;
      if (jointNames.length === 0) {
        log('当前 URDF 没有可动关节，无法录制');
        return;
      }
      recordingActive = true;
      recordJointNames = [...jointNames];
      recordSource = source;
      recordStartedAt = performance.now();
      recordLastSampleAt = 0;
      recordBuffer = [];

      get().stopPlayback();
      set({ isRecording: true, recordedMs: 0, recordedFrames: 0 });

      uiTimer = window.setInterval(() => {
        const frames = recordBuffer.length;
        const elapsed = frames > 0 ? recordBuffer[frames - 1].t : 0;
        set({ recordedMs: elapsed, recordedFrames: frames });
      }, UI_TICK_MS);

      log(`开始录制（${jointNames.length} 个关节，${source === 'live' ? 'Live ROS' : 'Simulation'}）`);
    },

    captureFrame: (jointState) => {
      if (!recordingActive) return;

      const now = performance.now();
      if (now - recordLastSampleAt < MIN_SAMPLE_MS) return;
      if (recordBuffer.length >= MAX_FRAMES) {
        log('录制达到帧数上限，自动停止');
        finalize(false);
        return;
      }
      recordLastSampleAt = now;

      const indices = recordJointNames.map((name) => jointState.name.indexOf(name));
      const previous = recordBuffer[recordBuffer.length - 1];
      const position = indices.map((index, i) => {
        if (index >= 0) return jointState.position[index] ?? 0;
        return previous?.position[i] ?? 0;
      });

      recordBuffer.push({ t: now - recordStartedAt, position });
    },

    stopRecording: () => finalize(false),
    discardRecording: () => finalize(true),

    addTrajectory: (trajectory) => {
      const normalized = normalizeTrajectory(trajectory);
      set((prev) => ({
        library: [normalized, ...prev.library],
        selectedId: normalized.id,
        playheadMs: 0,
        isPlaying: false,
      }));
      log(`导入轨迹：${normalized.name}（${normalized.frames.length} 帧）`);
    },

    selectTrajectory: (id) => {
      if (get().isPlaying) haltPlayback();
      set({ selectedId: id, playheadMs: 0 });
    },

    updateTrajectory: (id, updater, label) => {
      const current = get().library.find((item) => item.id === id);
      if (!current) return;

      const next = normalizeTrajectory(updater(current));
      if (next.frames.length < 2) {
        log('编辑后轨迹不足 2 帧，已取消');
        return;
      }

      if (get().isPlaying) haltPlayback();

      set((prev) => ({
        library: prev.library.map((item) =>
          item.id === id ? { ...next, id: item.id, name: item.name } : item
        ),
        playheadMs: 0,
        isPlaying: false,
      }));

      log(
        `${label}：${current.frames.length} → ${next.frames.length} 帧 / ${(next.durationMs / 1000).toFixed(1)}s`
      );
    },

    appendTrajectory: (targetId, sourceId) => {
      const library = get().library;
      const target = library.find((item) => item.id === targetId);
      const source = library.find((item) => item.id === sourceId);
      if (!target || !source) return;

      try {
        const merged = concatTrajectories(target, source);
        if (get().isPlaying) haltPlayback();

        const trajectory: JointTrajectory = {
          ...merged,
          id: createTrajectoryId(),
          name: `${target.name}+${source.name}`,
          createdAt: Date.now(),
          source: target.source,
        };

        set((prev) => ({
          library: [trajectory, ...prev.library],
          selectedId: trajectory.id,
          playheadMs: 0,
          isPlaying: false,
        }));

        log(
          `拼接轨迹：${trajectory.name}（${trajectory.frames.length} 帧 / ${(trajectory.durationMs / 1000).toFixed(1)}s）`
        );
      } catch (err) {
        log(`拼接失败：${err instanceof Error ? err.message : '未知错误'}`);
      }
    },

    removeTrajectory: (id) => {
      const target = get().library.find((item) => item.id === id);
      if (!target) return;
      if (get().selectedId === id) {
        if (get().isPlaying) haltPlayback();
        set({ selectedId: null, playheadMs: 0 });
      }
      set((prev) => ({ library: prev.library.filter((item) => item.id !== id) }));
      log(`已删除轨迹：${target.name}`);
    },

    setPlayhead: (ms) => set({ playheadMs: ms }),
    setSpeed: (speed) => set({ speed }),
    toggleLoop: () => set((prev) => ({ loop: !prev.loop })),

    setLiveArmed: (armed) => {
      set({ liveArmed: armed });
      if (!armed && !useConnectionStore.getState().useSimulation && get().isPlaying) {
        haltPlayback();
        log('真机回放已上锁，回放停止');
      }
    },

    play: () => {
      const state = get();
      const trajectory = state.library.find((item) => item.id === state.selectedId);
      if (!trajectory) {
        log('请先选择一条轨迹');
        return;
      }
      if (useRobotStore.getState().eStop) {
        log('E-Stop 已触发，无法回放');
        return;
      }
      if (!useConnectionStore.getState().useSimulation && !state.liveArmed) {
        log('Live 模式回放需要先解锁真机回放');
        return;
      }
      if (state.isPlaying) return;

      restoreJogActive = useRobotStore.getState().jogActive;
      useRobotStore.getState().setJogActive(true);

      const startMs = state.playheadMs >= trajectory.durationMs ? 0 : state.playheadMs;
      set({ isPlaying: true, playheadMs: startMs });
      log(`开始回放：${trajectory.name}（${state.speed}x）`);
    },

    pause: () => {
      if (!get().isPlaying) return;
      set({ isPlaying: false });
      log('回放暂停');
    },

    stopPlayback: (reason) => {
      const state = get();
      if (!state.isPlaying && state.playheadMs === 0) return;
      haltPlayback();
      log(reason ?? '回放停止');
    },
  };
});
