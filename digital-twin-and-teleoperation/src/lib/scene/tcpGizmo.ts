import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { GizmoMode, Pose } from '@/types';

/**
 * TCP (Tool Center Point) gizmo.
 *
 * A `TransformControls` is bound to an invisible proxy object that tracks the
 * end-effector's world transform. Because the proxy lives in world space the
 * operator can drag it with the usual three-axis handles, while the pose that
 * is published downstream is converted into the robot base frame — which is
 * what an IK solver (`/ik_target`) expects.
 */

export interface TCPGizmoOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  /** Orbit controls to suspend while the operator is dragging the gizmo. */
  orbit: { enabled: boolean };
  /** Object whose world transform defines the TCP. */
  tcp: THREE.Object3D;
  /** Frame the published pose is expressed in (usually the robot root). */
  reference: THREE.Object3D;
  onPoseChange?: (pose: Pose, phase: 'drag' | 'end') => void;
  onEnabledChange?: (enabled: boolean) => void;
}

export interface TCPGizmoHandles {
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  setMode: (mode: GizmoMode) => void;
  setSpace: (space: 'world' | 'local') => void;
  isEnabled: () => boolean;
  /** Re-anchor the proxy onto the live TCP. Call once per frame. */
  update: () => void;
  dispose: () => void;
}

/** Throttle IK target publishing while dragging (ms). */
const PUBLISH_INTERVAL_MS = 50;

export function createTCPGizmo(options: TCPGizmoOptions): TCPGizmoHandles | null {
  const { scene, camera, domElement, orbit, tcp, reference, onPoseChange, onEnabledChange } = options;

  const proxy = new THREE.Object3D();
  proxy.name = 'tcp-gizmo-proxy';
  scene.add(proxy);

  const gizmo = new TransformControls(camera, domElement);
  gizmo.setMode('translate');
  gizmo.setSpace('world');
  gizmo.setSize(0.75);
  gizmo.enabled = false;
  // TransformControls is an Object3D in three <= r168 and must be in the graph.
  scene.add(gizmo);
  gizmo.attach(proxy);
  gizmo.visible = false;

  let enabled = false;
  let draggingNow = false;
  let lastPublishAt = 0;

  const syncProxyToTCP = () => {
    tcp.updateWorldMatrix(true, false);
    tcp.getWorldPosition(proxy.position);
    tcp.getWorldQuaternion(proxy.quaternion);
  };
  syncProxyToTCP();

  const setEnabled = (next: boolean) => {
    if (next === enabled) return;
    enabled = next;
    gizmo.enabled = next;
    gizmo.visible = next;
    if (!next) syncProxyToTCP();
    onEnabledChange?.(next);
  };

  const readPose = (): Pose => {
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    proxy.getWorldPosition(worldPosition);
    proxy.getWorldQuaternion(worldQuaternion);

    reference.updateWorldMatrix(true, false);
    const inverse = new THREE.Matrix4().copy(reference.matrixWorld).invert();

    // Position -> base frame.
    const position = worldPosition.clone().applyMatrix4(inverse);

    // Orientation -> base frame (drop any scale baked into the reference).
    const referenceQuaternion = new THREE.Quaternion();
    reference.getWorldQuaternion(referenceQuaternion);
    const orientation = referenceQuaternion.clone().invert().multiply(worldQuaternion);

    return {
      position: { x: position.x, y: position.y, z: position.z },
      orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
    };
  };

  const emit = (phase: 'drag' | 'end') => {
    onPoseChange?.(readPose(), phase);
  };

  const onObjectChange = () => {
    const now = performance.now();
    if (draggingNow && now - lastPublishAt >= PUBLISH_INTERVAL_MS) {
      lastPublishAt = now;
      emit('drag');
    }
  };

  const onDraggingChanged = (event: { value?: unknown }) => {
    const dragging = Boolean((event as { value?: boolean }).value);
    draggingNow = dragging;
    // Suspend orbiting so a gizmo drag never spins the camera.
    orbit.enabled = !dragging;
    if (!dragging) {
      emit('end');
      // The twin is joint driven: snap back to the real TCP until the robot
      // actually reaches the commanded pose.
      syncProxyToTCP();
    }
  };

  gizmo.addEventListener('objectChange', onObjectChange);
  gizmo.addEventListener('dragging-changed', onDraggingChanged);

  const dispose = () => {
    gizmo.removeEventListener('objectChange', onObjectChange);
    gizmo.removeEventListener('dragging-changed', onDraggingChanged);
    gizmo.detach();
    gizmo.dispose();
    scene.remove(gizmo);
    scene.remove(proxy);

    orbit.enabled = true;
  };

  return {
    setEnabled,
    toggle: () => setEnabled(!enabled),
    setMode: (mode: GizmoMode) => gizmo.setMode(mode),
    setSpace: (space: 'world' | 'local') => gizmo.setSpace(space),
    isEnabled: () => enabled,
    update: () => {
      if (!enabled || !gizmo.dragging) syncProxyToTCP();
    },
    dispose,
  };
}
