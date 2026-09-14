import * as ROSLIB from 'roslib';
import type { JointState, Pose, RobotTelemetry, Twist } from '@/types';
import { buildMockJointState, buildMockTelemetry } from '@/lib/mockRobot';
import type { URDFJointDefinition } from '@/lib/urdfJoints';

export type MessageHandler<T> = (msg: T) => void;

/** Default ROS interface names; overridable from the UI if a stack differs. */
export const ROS_TOPICS = {
  jointStates: '/joint_states',
  jointCommand: '/joint_command',
  telemetry: '/robot_telemetry',
  cmdVel: '/cmd_vel',
  eStop: '/emergency_stop',
  ikTarget: '/ik_target',
} as const;

export class ROSClient {
  private ros: ROSLIB.Ros | null = null;
  private topics: Map<string, ROSLIB.Topic> = new Map();
  private publishers: Map<string, ROSLIB.Topic> = new Map();
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
    this.publishers.clear();
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

  /**
   * Publish on a topic, reusing a single advertiser per name. Creating a fresh
   * `ROSLIB.Topic` per message (as a naive implementation does) re-advertises
   * the topic on the bridge every time and leaks handles.
   */
  publish(topicName: string, messageType: string, payload: Record<string, unknown>): void {
    if (!this.ros) {
      throw new Error('ROS not connected');
    }

    const key = `${topicName}|${messageType}`;
    let topic = this.publishers.get(key);
    if (!topic) {
      topic = new ROSLIB.Topic({ ros: this.ros, name: topicName, messageType });
      this.publishers.set(key, topic);
    }

    topic.publish(new ROSLIB.Message(payload));
  }

  publishTwist(cmd: Twist): void {
    this.publish(ROS_TOPICS.cmdVel, 'geometry_msgs/Twist', cmd as unknown as Record<string, unknown>);
  }

  /** Publish a manual jog target as a `sensor_msgs/JointState` on /joint_command. */
  publishJointCommand(names: string[], positions: number[]): void {
    this.publish(ROS_TOPICS.jointCommand, 'sensor_msgs/JointState', {
      header: rosHeader(''),
      name: names,
      position: positions,
      velocity: [],
      effort: [],
    });
  }

  /** Emergency stop latch: `std_msgs/Bool` on /emergency_stop. */
  publishEStop(active: boolean): void {
    this.publish(ROS_TOPICS.eStop, 'std_msgs/Bool', { data: active });
  }

  /**
   * Cartesian target for the IK solver: `geometry_msgs/PoseStamped` on
   * /ik_target, expressed in the robot base frame.
   */
  publishPoseStamped(pose: Pose, frameId = 'base_link'): void {
    this.publish(ROS_TOPICS.ikTarget, 'geometry_msgs/PoseStamped', {
      header: rosHeader(frameId),
      pose: {
        position: pose.position,
        orientation: pose.orientation,
      },
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

/** `std_msgs/Header` built from wall clock time. */
function rosHeader(frameId: string) {
  const now = Date.now() / 1000;
  return {
    stamp: { secs: Math.floor(now), nsecs: Math.floor((now % 1) * 1e9) },
    frame_id: frameId,
  };
}

export { rosHeader };

const FALLBACK_JOINTS: URDFJointDefinition[] = [
  'joint1',
  'joint2',
  'joint3',
  'joint4',
  'joint5',
].map((name) => ({
  name,
  type: 'revolute' as const,
  lower: -Math.PI,
  upper: Math.PI,
  velocity: 1,
  effort: 10,
  axis: [0, 0, 1] as [number, number, number],
}));

/**
 * Build the simulated /joint_states message.
 *
 * Joint names come from the loaded URDF so the twin stays in sync with the
 * model. When manual jog is active, the operator's targets win over the
 * generated animation for the joints they are driving.
 */
export function buildJointStateMessage(
  joints: URDFJointDefinition[] | string[] = FALLBACK_JOINTS,
  targets: Record<string, number> = {},
  jogActive = false
): JointState {
  const definitions: URDFJointDefinition[] =
    joints.length > 0 && typeof joints[0] === 'string'
      ? (joints as string[]).map((name) => FALLBACK_JOINTS.find((j) => j.name === name) ?? { ...FALLBACK_JOINTS[0], name })
      : (joints as URDFJointDefinition[]);

  return buildMockJointState(definitions.length > 0 ? definitions : FALLBACK_JOINTS, targets, jogActive);
}

export function buildTelemetryMessage(): RobotTelemetry {
  return buildMockTelemetry();
}
