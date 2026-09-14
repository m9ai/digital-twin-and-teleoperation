import { useRobotStore } from '@/store/robotStore';
import { rosClientRef } from '@/lib/rosRef';
import type { Twist } from '@/types';

/**
 * Emergency stop (E-Stop) latch.
 *
 * Triggering is idempotent and always re-publishes, because a lost or late
 * packet must never leave the cell running. Releasing is deliberately a
 * separate, explicit action — a keyboard shortcut only ever latches *on*.
 */

const ZERO_TWIST: Twist = {
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
};

function publishToROS(action: 'engage' | 'release'): void {
  const client = rosClientRef.current;
  if (!client) return;

  try {
    client.publishEStop(action === 'engage');
    if (action === 'engage') {
      // Cut motion immediately as well; not every stack honours the latch alone.
      client.publishTwist(ZERO_TWIST);
    }
  } catch (err) {
    useRobotStore
      .getState()
      .addLog(`E-Stop ${action} 发布失败: ${err instanceof Error ? err.message : 'ROS not connected'}`);
  }
}

export function triggerEmergencyStop(reason = 'operator'): void {
  const store = useRobotStore.getState();
  store.setEStop(true);
  store.addLog(`E-STOP ENGAGED (${reason}) — 关节指令已锁定`);
  publishToROS('engage');
}

export function releaseEmergencyStop(): void {
  if (!useRobotStore.getState().eStop) return;
  const store = useRobotStore.getState();
  store.setEStop(false);
  store.addLog('E-STOP RELEASED — 恢复使能');
  publishToROS('release');
}
