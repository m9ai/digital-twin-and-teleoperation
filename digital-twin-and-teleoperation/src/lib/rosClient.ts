import * as ROSLIB from 'roslib';
import type { JointState, RobotTelemetry, Twist } from '@/types';

export type MessageHandler<T> = (msg: T) => void;

export class ROSClient {
  private ros: ROSLIB.Ros | null = null;
  private topics: Map<string, ROSLIB.Topic> = new Map();
  private services: Map<string, ROSLIB.Service> = new Map();
  private pingInterval: number | null = null;

  constructor(private url: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ros) {
        this.disconnect();
      }

      this.ros = new ROSLIB.Ros({ url: this.url });

      this.ros.on('connection', () => {
        console.log('[ROS] Connected to', this.url);
        this.startPing();
        resolve();
      });

      this.ros.on('error', (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ROS] Connection error:', message);
        reject(new Error(message));
      });

      this.ros.on('close', () => {
        console.warn('[ROS] Connection closed');
        this.stopPing();
      });
    });
  }

  disconnect(): void {
    this.stopPing();
    this.topics.forEach((topic) => topic.unsubscribe());
    this.topics.clear();
    if (this.ros) {
      this.ros.close();
      this.ros = null;
    }
  }

  subscribe<T>(topicName: string, messageType: string, handler: MessageHandler<T>): () => void {
    if (!this.ros) {
      throw new Error('ROS not connected');
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType,
    });

    topic.subscribe(handler as (msg: unknown) => void);
    this.topics.set(topicName, topic);

    return () => {
      topic.unsubscribe();
      this.topics.delete(topicName);
    };
  }

  publish(topicName: string, messageType: string, payload: Record<string, unknown>): void {
    if (!this.ros) {
      throw new Error('ROS not connected');
    }

    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType,
    });

    const message = new ROSLIB.Message(payload);
    topic.publish(message);
  }

  publishTwist(cmd: Twist): void {
    this.publish('/cmd_vel', 'geometry_msgs/Twist', cmd as unknown as Record<string, unknown>);
  }

  /** Publish a manual jog target as a `sensor_msgs/JointState` on /joint_command. */
  publishJointCommand(names: string[], positions: number[]): void {
    const now = Date.now() / 1000;
    this.publish('/joint_command', 'sensor_msgs/JointState', {
      header: {
        stamp: { secs: Math.floor(now), nsecs: Math.floor((now % 1) * 1e9) },
        frame_id: '',
      },
      name: names,
      position: positions,
      velocity: [],
      effort: [],
    });
  }

  callService<TReq extends Record<string, unknown>, TRes>(serviceName: string, request: TReq): Promise<TRes> {
    if (!this.ros) {
      return Promise.reject(new Error('ROS not connected'));
    }

    const service = new ROSLIB.Service({
      ros: this.ros,
      name: serviceName,
      serviceType: 'std_srvs/Trigger',
    });

    this.services.set(serviceName, service);

    return new Promise((resolve, reject) => {
      service.callService(
        new ROSLIB.ServiceRequest(request),
        (result: unknown) => resolve(result as TRes),
        (error: unknown) => reject(error)
      );
    });
  }

  private startPing(): void {
    if (this.pingInterval) return;
    this.pingInterval = window.setInterval(() => {
      this.ros?.callOnConnection('{"op": "ping"}');
    }, 5000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  isConnected(): boolean {
    return this.ros?.isConnected ?? false;
  }
}

const FALLBACK_JOINTS = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5'];

/**
 * Build the simulated /joint_states message.
 *
 * Joint names come from the loaded URDF so the twin stays in sync with the
 * model. When manual jog is active, the operator's targets win over the
 * generated animation for the joints they are driving.
 */
export function buildJointStateMessage(
  jointNames: string[] = FALLBACK_JOINTS,
  targets: Record<string, number> = {},
  jogActive = false
): JointState {
  const names = jointNames.length > 0 ? jointNames : FALLBACK_JOINTS;
  const time = Date.now() / 1000;

  return {
    name: names,
    position: names.map((name, i) => {
      if (jogActive && targets[name] !== undefined) return targets[name];
      return Math.sin(time * 0.8 + i) * 0.6;
    }),
    velocity: names.map((name, i) => {
      if (jogActive && targets[name] !== undefined) return 0;
      return Math.cos(time * 0.8 + i) * 0.3;
    }),
    effort: names.map(() => Math.random() * 2),
  };
}

export function buildTelemetryMessage(): RobotTelemetry {
  return {
    batteryPercent: 70 + Math.random() * 25,
    batteryVoltage: 22 + Math.random() * 4,
    linearVelocity: Math.random() * 2,
    angularVelocity: (Math.random() - 0.5) * 3,
    cpuTemp: 35 + Math.random() * 25,
    timestamp: Date.now(),
  };
}
