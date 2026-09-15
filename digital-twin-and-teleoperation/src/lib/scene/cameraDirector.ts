import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraPresetId } from '@/types';

/**
 * Preset camera views with eased transitions.
 *
 * Four views are supported: a framed perspective shot, a first-person
 * "head cam" mounted on the TCP, a top-down inspection view and a continuous
 * TCP-follow mode. Transition timing is driven by the render loop (no extra
 * tween dependency) so playback stays in sync with `requestAnimationFrame`.
 */

export interface CameraDirectorOptions {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Live TCP object, used by the head-cam and follow modes. */
  getTCP: () => THREE.Object3D | null;
  /** Bounding volume of the model so presets scale with any robot. */
  getBounds: () => { center: THREE.Vector3; radius: number };
  onFollowChange?: (following: boolean) => void;
}

export type StandardViewAxis = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

export interface CameraDirectorHandles {
  applyPreset: (preset: CameraPresetId, animate?: boolean) => void;
  applyStandardView: (axis: StandardViewAxis, animate?: boolean) => void;
  setFollow: (follow: boolean) => void;
  isFollowing: () => boolean;
  /** Advance tweens / follow damping. Call once per rendered frame. */
  update: (deltaMs: number) => void;
  dispose: () => void;
}

const TWEEN_DURATION_MS = 620;
/** Per-frame damping factor used by TCP-follow (frame-rate normalized). */
const FOLLOW_SMOOTHING = 0.14;
const MIN_FOLLOW_DISTANCE = 0.25;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createCameraDirector(options: CameraDirectorOptions): CameraDirectorHandles {
  const { camera, controls, getTCP, getBounds, onFollowChange } = options;

  const fromPosition = new THREE.Vector3();
  const fromTarget = new THREE.Vector3();
  const toPosition = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  let tweenElapsed = 0;
  let tweening = false;

  let following = false;
  const followOffset = new THREE.Vector3();
  const scratchPosition = new THREE.Vector3();
  const scratchTarget = new THREE.Vector3();

  const cancelTween = () => {
    tweening = false;
    tweenElapsed = 0;
  };

  const startTween = (position: THREE.Vector3, target: THREE.Vector3, animate: boolean) => {
    if (!animate) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      cancelTween();
      return;
    }
    fromPosition.copy(camera.position);
    fromTarget.copy(controls.target);
    toPosition.copy(position);
    toTarget.copy(target);
    tweenElapsed = 0;
    tweening = true;
    controls.enabled = false;
  };

  const computePreset = (preset: CameraPresetId): { position: THREE.Vector3; target: THREE.Vector3 } | null => {
    const { center, radius } = getBounds();
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;

    if (preset === 'perspective') {
      const direction = new THREE.Vector3(0.85, 0.55, 1).normalize().multiplyScalar(safeRadius * 2.6);
      return {
        position: center.clone().add(direction),
        target: center.clone(),
      };
    }

    if (preset === 'top') {
      // With Z as the vertical axis, the top-down view is the +Z standard view.
      return null;
    }

    // head / tcp are TCP anchored.
    const tcp = getTCP();
    if (!tcp) return null;

    tcp.updateWorldMatrix(true, false);
    const tcpPosition = tcp.getWorldPosition(new THREE.Vector3());
    const tcpQuaternion = tcp.getWorldQuaternion(new THREE.Quaternion());
    // ROS tool conventions usually point the approach axis along local +Z.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(tcpQuaternion).normalize();

    if (preset === 'head') {
      return {
        position: tcpPosition.clone().addScaledVector(forward, -0.08),
        target: tcpPosition.clone().addScaledVector(forward, Math.max(safeRadius, 0.6)),
      };
    }

    return {
      position: tcpPosition.clone().add(new THREE.Vector3(safeRadius * 0.8, safeRadius * 0.6, safeRadius * 0.9)),
      target: tcpPosition.clone(),
    };
  };

  const applyStandardView = (axis: StandardViewAxis, animate = true) => {
    const { center, radius } = getBounds();
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;

    // Map the selected axis to a camera position on that axis looking back
    // toward the origin of the model bounds.
    const direction = new THREE.Vector3(
      axis === '+X' ? 1 : axis === '-X' ? -1 : 0,
      axis === '+Y' ? 1 : axis === '-Y' ? -1 : 0,
      axis === '+Z' ? 1 : axis === '-Z' ? -1 : 0
    );

    // Use a right-handed Z-up convention: +Z / -Z are top/bottom views, so the
    // screen top should point along +Y (a horizontal axis). For all side views
    // (+Y / -Y / +X / -X) the screen top should point along +Z (world up).
    const up = axis === '+Z' || axis === '-Z'
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);

    const position = center.clone().addScaledVector(direction, safeRadius * 2.6);
    const target = center.clone();

    setFollow(false);
    camera.up.copy(up);
    startTween(position, target, animate);
  };

  const applyPreset = (preset: CameraPresetId, animate = true) => {
    if (preset === 'top') {
      applyStandardView('+Z', animate);
      return;
    }

    const view = computePreset(preset);
    if (!view) return;

    camera.up.set(0, 1, 0);

    if (preset === 'tcp') {
      startTween(view.position, view.target, animate);
      // Remember the framing the operator arrived with so follow keeps it.
      followOffset.copy(view.position).sub(view.target);
      if (followOffset.length() < MIN_FOLLOW_DISTANCE) {
        followOffset.set(MIN_FOLLOW_DISTANCE, MIN_FOLLOW_DISTANCE * 0.7, MIN_FOLLOW_DISTANCE);
      }
      setFollow(true);
      return;
    }

    setFollow(false);
    startTween(view.position, view.target, animate);
  };

  function setFollow(next: boolean) {
    if (next === following) return;
    following = next;
    onFollowChange?.(next);
  }

  /** Any manual orbit/zoom releases follow mode so the operator is in control. */
  const onUserInteraction = () => {
    if (following) setFollow(false);
  };
  controls.addEventListener('start', onUserInteraction);

  const update = (deltaMs: number) => {
    if (tweening) {
      tweenElapsed += deltaMs;
      const t = Math.min(1, tweenElapsed / TWEEN_DURATION_MS);
      const k = easeInOutCubic(t);
      camera.position.lerpVectors(fromPosition, toPosition, k);
      controls.target.lerpVectors(fromTarget, toTarget, k);
      if (t >= 1) {
        tweening = false;
        controls.enabled = true;
      }
    }

    if (following && !tweening) {
      const tcp = getTCP();
      if (tcp) {
        tcp.updateWorldMatrix(true, false);
        scratchTarget.copy(tcp.getWorldPosition(scratchPosition));
        scratchPosition.copy(scratchTarget).add(followOffset);
        // Frame-rate independent exponential smoothing.
        const alpha = 1 - Math.pow(1 - FOLLOW_SMOOTHING, Math.max(deltaMs, 1) / 16.67);
        camera.position.lerp(scratchPosition, alpha);
        controls.target.lerp(scratchTarget, alpha);
      }
    }
  };

  const dispose = () => {
    controls.removeEventListener('start', onUserInteraction);
    cancelTween();
    controls.enabled = true;
  };

  return { applyPreset, applyStandardView, setFollow, isFollowing: () => following, update, dispose };
}
