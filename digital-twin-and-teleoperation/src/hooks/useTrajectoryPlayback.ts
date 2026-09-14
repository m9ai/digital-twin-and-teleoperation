/**
 * Drives playback: advances the playhead on the animation clock and pushes the
 * interpolated sample into the simulation or to the real robot.
 *
 * Playback is intentionally interruptible — every tick re-checks E-Stop and the
 * live-mode arming gate, so pulling the E-Stop stops the motion immediately.
 */
import { useEffect } from 'react';
import { useRobotStore } from '@/store/robotStore';
import { useConnectionStore } from '@/store/connectionStore';
import { useRecordingStore } from '@/store/recordingStore';
import { applyTrajectorySample } from '@/lib/trajectoryPlayer';

/** Throttle playhead writes to the store; the internal clock stays exact. */
const PLAYHEAD_UI_MS = 33;

export function useTrajectoryPlayback(): void {
  const isPlaying = useRecordingStore((s) => s.isPlaying);
  const selectedId = useRecordingStore((s) => s.selectedId);

  useEffect(() => {
    if (!isPlaying || !selectedId) return;

    const trajectory = useRecordingStore.getState().library.find((item) => item.id === selectedId);
    if (!trajectory || trajectory.durationMs <= 0) return;

    let raf = 0;
    let lastAt = performance.now();
    let playhead = useRecordingStore.getState().playheadMs;
    let lastUiSync = 0;

    const tick = (now: number) => {
      const store = useRecordingStore.getState();
      const dt = (now - lastAt) * store.speed;
      lastAt = now;

      if (useRobotStore.getState().eStop) {
        store.stopPlayback('E-Stop 触发，回放中断');
        return;
      }

      if (!useConnectionStore.getState().useSimulation && !store.liveArmed) {
        store.stopPlayback();
        return;
      }

      playhead += dt;

      if (playhead >= trajectory.durationMs) {
        if (store.loop) {
          playhead = playhead % trajectory.durationMs;
        } else {
          playhead = trajectory.durationMs;
          applyTrajectorySample(trajectory, playhead, true);
          store.setPlayhead(playhead);
          store.stopPlayback();
          return;
        }
      }

      applyTrajectorySample(trajectory, playhead);

      if (now - lastUiSync >= PLAYHEAD_UI_MS) {
        lastUiSync = now;
        store.setPlayhead(playhead);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, selectedId]);
}
