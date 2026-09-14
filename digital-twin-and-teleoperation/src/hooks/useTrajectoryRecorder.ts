/**
 * Samples the incoming joint state stream while a recording is active.
 *
 * The recorder reads the out-of-band joint bus instead of the throttled React
 * store, so captured trajectories keep their fidelity even though the UI only
 * refreshes at 10 Hz. Capture is capped at ~30 Hz: that is well above what a
 * teaching pendant needs and keeps long recordings from ballooning.
 */
import { useEffect } from 'react';
import { subscribeJointState } from '@/lib/jointBus';
import { useRecordingStore } from '@/store/recordingStore';
import type { JointState } from '@/types';

const CAPTURE_INTERVAL_MS = 33;

export function useTrajectoryRecorder(): void {
  useEffect(() => {
    let latest: JointState | null = null;

    const unsubscribe = subscribeJointState((state) => {
      latest = state;
    });

    const timer = window.setInterval(() => {
      if (!latest) return;
      useRecordingStore.getState().captureFrame(latest);
    }, CAPTURE_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);
}
