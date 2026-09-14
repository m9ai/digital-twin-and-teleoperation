/**
 * Samples the incoming joint state stream while a recording is active.
 *
 * The recorder subscribes to the robot store rather than to ROS directly, so
 * it captures exactly what the digital twin displays — whether that comes from
 * the simulation loop, operator jogging, or a live /joint_states subscription.
 */
import { useEffect } from 'react';
import { useRobotStore } from '@/store/robotStore';
import { useRecordingStore } from '@/store/recordingStore';

export function useTrajectoryRecorder(): void {
  useEffect(() => {
    let previous = useRobotStore.getState().jointState;

    const unsubscribe = useRobotStore.subscribe((state) => {
      if (state.jointState === previous) return;
      previous = state.jointState;
      useRecordingStore.getState().captureFrame(state.jointState);
    });

    return unsubscribe;
  }, []);
}
