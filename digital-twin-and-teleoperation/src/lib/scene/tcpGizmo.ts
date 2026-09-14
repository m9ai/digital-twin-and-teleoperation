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
/** A pointer gesture shorter than this (px) counts as a click, not an orbit. */
const CLICK_SLOP_PX = 4;

const HANDLE_COLOR = 0x22d3ee;
const HANDLE_COLOR_ACTIVE = 0xf59e0b;

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

  /**
   * Small pickable marker parented to the TCP so the operator can click the
   * tool itself to summon the gizmo.
   */
  const handleGeometry = new THREE.SphereGeometry(1, 16, 16);
  const handleMaterial = new THREE.MeshBasicMaterial({
    color: HANDLE_COLOR,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const handle = new THREE.Mesh(handleGeometry, handleMaterial);
  handle.name = 'tcp-pick-handle';
  handle.renderOrder = 999;
  handle.userData.isTCPHandle = true;
  tcp.add(handle);

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
    handleMaterial.color.setHex(next ? HANDLE_COLOR_ACTIVE : HANDLE_COLOR);
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

  // ---- click-to-summon -------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number; t: number } | null = null;

  const updatePointer = (event: PointerEvent) => {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const onPointerDown = (event: PointerEvent) => {
    downAt = { x: event.clientX, y: event.clientY, t: performance.now() };
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    const elapsed = performance.now() - downAt.t;
    downAt = null;

    if (moved > CLICK_SLOP_PX || elapsed > 500) return;
    if (gizmo.dragging) return;

    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(handle, false);
    if (hits.length > 0) {
      setEnabled(!enabled);
    }
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerup', onPointerUp);

  const dispose = () => {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointerup', onPointerUp);
    gizmo.removeEventListener('objectChange', onObjectChange);
    gizmo.removeEventListener('dragging-changed', onDraggingChanged);
    gizmo.detach();
    gizmo.dispose();
    scene.remove(gizmo);
    scene.remove(proxy);

    if (handle.parent) handle.parent.remove(handle);
    handleGeometry.dispose();
    handleMaterial.dispose();

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
      // Keep the pick marker at a constant on-screen size.
      const distance = camera.getWorldPosition(new THREE.Vector3()).distanceTo(
        tcp.getWorldPosition(new THREE.Vector3())
      );
      handle.scale.setScalar(Math.max(0.004, distance * 0.012));
    },
    dispose,
  };
}
