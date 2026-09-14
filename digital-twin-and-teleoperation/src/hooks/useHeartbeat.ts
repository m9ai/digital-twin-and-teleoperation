import { useEffect, useRef } from 'react';
import { useRobotStore } from '@/store/robotStore';
import { rosClientRef } from '@/lib/rosRef';
import type { Twist } from '@/types';

const HEARTBEAT_INTERVAL = 100;

const zeroTwist: Twist = {
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
};

export function useHeartbeat() {
  const eStopRef = useRef(false);
  const { eStop, addLog } = useRobotStore();

  useEffect(() => {
    eStopRef.current = eStop;
  }, [eStop]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (eStopRef.current) {
        try {
          rosClientRef.current?.publishTwist(zeroTwist);
        } catch {
          // ignore
        }
      }
    }, HEARTBEAT_INTERVAL);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (eStop) {
      try {
        rosClientRef.current?.publishTwist(zeroTwist);
      } catch {
        // ignore
      }
      addLog('E-Stop triggered: zero velocity published');
    }
  }, [eStop, addLog]);
}
