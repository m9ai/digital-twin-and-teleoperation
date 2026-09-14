import { useEffect, useRef, useCallback } from 'react';
import { ROSClient, buildJointStateMessage, buildTelemetryMessage } from '@/lib/rosClient';
import { rosClientRef } from '@/lib/rosRef';
import { useConnectionStore } from '@/store/connectionStore';
import { useRobotStore } from '@/store/robotStore';
import { useURDFStore } from '@/store/urdfStore';
import type { JointState, RobotTelemetry } from '@/types';

const JOINT_TOPIC = '/joint_states';
const TELEMETRY_TOPIC = '/robot_telemetry';
const JOINT_MSG_TYPE = 'sensor_msgs/JointState';
const TELEMETRY_MSG_TYPE = 'sensor_msgs/BatteryState';

export function useROS() {
  const rosClient = useRef<ROSClient | null>(null);
  const simInterval = useRef<number | null>(null);
  const unsubscribers = useRef<Array<() => void>>([]);

  const { status, useSimulation, setConnected, setError, setLatency } = useConnectionStore();
  const { setJointState, setTelemetry, addLog } = useRobotStore();

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

      const unsub1 = client.subscribe<JointState>(
        JOINT_TOPIC,
        JOINT_MSG_TYPE,
        (msg) => {
          setJointState(msg);
        }
      );

      const unsub2 = client.subscribe<RobotTelemetry>(
        TELEMETRY_TOPIC,
        TELEMETRY_MSG_TYPE,
        (msg) => {
          setTelemetry(msg);
        }
      );

      unsubscribers.current = [unsub1, unsub2];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConnected(false);
      setError(message);
      addLog(`Failed to connect: ${message}`);
    }
  }, [status.url, setConnected, setError, setJointState, setTelemetry, addLog]);

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
        // that the 100 ms simulation loop is never torn down mid-session.
        const { joints } = useURDFStore.getState();
        const { jointTargets, jogActive } = useRobotStore.getState();
        const jointState = buildJointStateMessage(
          joints.map((j) => j.name),
          jointTargets,
          jogActive
        );
        const telemetry = buildTelemetryMessage();
        setJointState(jointState);
        setTelemetry(telemetry);
      }, 100);
      addLog('Simulation mode active');
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
  }, [useSimulation, connect, disconnect, setJointState, setTelemetry, addLog]);

  useEffect(() => {
    if (useSimulation) {
      setConnected(true);
      setLatency(12);
    }
  }, [useSimulation, setConnected, setLatency]);

  return { connect, disconnect, rosClient };
}
