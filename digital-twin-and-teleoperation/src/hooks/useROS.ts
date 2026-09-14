import { useEffect, useRef, useCallback } from 'react';
import { ROSClient } from '@/lib/rosClient';
import { rosClientRef } from '@/lib/rosRef';
import { publishJointState } from '@/lib/jointBus';
import { buildMockJointState, buildMockTelemetry, DEFAULT_MOCK_JOINTS } from '@/lib/mockRobot';
import { useConnectionStore } from '@/store/connectionStore';
import { useRobotStore } from '@/store/robotStore';
import { useURDFStore } from '@/store/urdfStore';
import type { JointState, RobotTelemetry } from '@/types';

const JOINT_TOPIC = '/joint_states';
const TELEMETRY_TOPIC = '/robot_telemetry';
const JOINT_MSG_TYPE = 'sensor_msgs/JointState';
const TELEMETRY_MSG_TYPE = 'sensor_msgs/BatteryState';

/** Simulation runs at a realistic controller rate (100 Hz). */
const SIM_TICK_MS = 10;
/** React panels only need ~10 Hz; the 3D view reads the raw stream instead. */
const UI_THROTTLE_MS = 100;

export function useROS() {
  const rosClient = useRef<ROSClient | null>(null);
  const simInterval = useRef<number | null>(null);
  const unsubscribers = useRef<Array<() => void>>([]);
  const lastUiAt = useRef(0);
  const lastTelemetryAt = useRef(0);

  const { status, useSimulation, setConnected, setError, setLatency } = useConnectionStore();
  const { setJointState, setTelemetry, addLog } = useRobotStore();

  /** Push to the out-of-band stream at full rate; refresh React at 10 Hz. */
  const ingestJointState = useCallback(
    (msg: JointState) => {
      publishJointState(msg);
      const now = performance.now();
      if (now - lastUiAt.current >= UI_THROTTLE_MS) {
        lastUiAt.current = now;
        setJointState(msg);
      }
    },
    [setJointState]
  );

  const connect = useCallback(async () => {
    if (rosClient.current) {
      rosClient.current.disconnect();
      rosClient.current = null;
    }

    const client = new ROSClient(status.url);
    rosClient.current = client;
    rosClientRef.current = client;

    try {
      await client.connect();
      setConnected(true);
      setError(null);
      addLog(`Connected to ROS bridge at ${status.url}`);

      const unsub1 = client.subscribe<JointState>(JOINT_TOPIC, JOINT_MSG_TYPE, ingestJointState);

      const unsub2 = client.subscribe<RobotTelemetry>(TELEMETRY_TOPIC, TELEMETRY_MSG_TYPE, (msg) => {
        setTelemetry(msg);
      });

      unsubscribers.current = [unsub1, unsub2];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnected(false);
      setError(message);
      addLog(`Failed to connect: ${message}`);
    }
  }, [status.url, setConnected, setError, ingestJointState, setTelemetry, addLog]);

  const disconnect = useCallback(() => {
    unsubscribers.current.forEach((unsub) => unsub());
    unsubscribers.current = [];
    rosClient.current?.disconnect();
    rosClient.current = null;
    rosClientRef.current = null;
    setConnected(false);
    addLog('Disconnected from ROS bridge');
  }, [setConnected, addLog]);

  useEffect(() => {
    if (useSimulation) {
      disconnect();
      simInterval.current = window.setInterval(() => {
        // Read the latest URDF joints / jog targets without re-subscribing so
        // that the 100 Hz simulation loop is never torn down mid-session.
        const { joints } = useURDFStore.getState();
        const { jointTargets, jogActive } = useRobotStore.getState();
        const definitions = joints.length > 0 ? joints : DEFAULT_MOCK_JOINTS;

        ingestJointState(buildMockJointState(definitions, jointTargets, jogActive));

        const now = performance.now();
        if (now - lastTelemetryAt.current >= UI_THROTTLE_MS) {
          lastTelemetryAt.current = now;
          setTelemetry(buildMockTelemetry());
        }
      }, SIM_TICK_MS);
      addLog('Demo / simulation mode active (100 Hz mock joint stream)');
    } else {
      if (simInterval.current) {
        window.clearInterval(simInterval.current);
        simInterval.current = null;
      }
      connect();
    }

    return () => {
      if (simInterval.current) {
        window.clearInterval(simInterval.current);
      }
      disconnect();
    };
  }, [useSimulation, connect, disconnect, ingestJointState, setTelemetry, addLog]);

  useEffect(() => {
    if (useSimulation) {
      setConnected(true);
      setLatency(12);
    }
  }, [useSimulation, setConnected, setLatency]);

  return { connect, disconnect, rosClient };
}
