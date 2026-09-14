import { useEffect, useRef, useCallback } from 'react';
import { useRobotStore } from '@/store/robotStore';
import { useConnectionStore } from '@/store/connectionStore';
import { rosClientRef } from '@/lib/rosRef';
import type { Twist, GamepadAxes } from '@/types';

const DEADZONE = 0.12;
const PUBLISH_INTERVAL = 100;

function applyDeadzone(value: number): number {
  if (Math.abs(value) < DEADZONE) return 0;
  return value > 0 ? (value - DEADZONE) / (1 - DEADZONE) : (value + DEADZONE) / (1 - DEADZONE);
}

export function useGamepad() {
  const axesRef = useRef<GamepadAxes>({ x: 0, y: 0 });
  const eStopRef = useRef(false);
  const { eStop } = useRobotStore();
  const { status } = useConnectionStore();

  useEffect(() => {
    eStopRef.current = eStop;
  }, [eStop]);

  const handleGamepadInput = useCallback(() => {
    const gamepad = navigator.getGamepads ? navigator.getGamepads()[0] : null;
    if (!gamepad) return;

    const x = applyDeadzone(gamepad.axes[0] ?? 0);
    const y = applyDeadzone(gamepad.axes[1] ?? 0);
    axesRef.current = { x, y };

    if (gamepad.buttons[0]?.pressed && !eStopRef.current) {
      useRobotStore.getState().setEStop(true);
    }
    if (gamepad.buttons[1]?.pressed && eStopRef.current) {
      useRobotStore.getState().setEStop(false);
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      handleGamepadInput();

      if (eStopRef.current || !status.connected) return;

      const twist: Twist = {
        linear: { x: -axesRef.current.y * 1.5, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: -axesRef.current.x * 1.5 },
      };

      try {
        rosClientRef.current?.publishTwist(twist);
      } catch (err) {
        // ignore publish errors
      }
    }, PUBLISH_INTERVAL);

    return () => window.clearInterval(interval);
  }, [handleGamepadInput, status.connected]);

  return axesRef;
}
