import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createTCPGizmo, type TCPGizmoHandles } from '@/lib/scene/tcpGizmo';
import { createCameraDirector, type CameraDirectorHandles } from '@/lib/scene/cameraDirector';
import { createSafetyHighlighter, type SafetyHighlightEntry } from '@/lib/scene/safetyHighlight';
import {
  collectAdjacentPairs,
  collectLinkNodes,
  collectRestPoseOverlaps,
  type LinkNode,
} from '@/lib/safetyMonitor';
import type { CameraPresetId, GizmoMode, Pose } from '@/types';

/**
 * Shared scene runtime.
 *
 * Owns the single `requestAnimationFrame` loop and everything that must be
 * advanced per frame (gizmo anchoring, camera tweens/follow, safety pulse).
 * Both the URDF scene and the procedural fallback scene delegate here so the
 * two never drift apart.
 */

/** Invoked once per rendered frame with the frame timestamp and delta. */
export type FrameCallback = (nowMs: number, deltaMs: number) => void;

export interface SceneRuntimeOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  container: HTMLElement;
  /** Robot root: reference frame for IK targets and source of model bounds. */
  root: THREE.Object3D;
  /** Object defining the TCP (usually the last link). */
  tcp: THREE.Object3D | null;
  jointLinkMap?: Record<string, string>;
  /** Override for procedural models that are not URDF robots. */
  linkNodes?: LinkNode[];
  adjacentPairs?: Set<string>;
  onPoseChange?: (pose: Pose, phase: 'drag' | 'end') => void;
}

export interface SceneRuntime {
  start: () => void;
  setFrameCallback: (cb: FrameCallback | null) => void;
  setGizmoEnabled: (enabled: boolean) => void;
  toggleGizmo: () => void;
  setGizmoMode: (mode: GizmoMode) => void;
  setGizmoSpace: (space: 'world' | 'local') => void;
  isGizmoEnabled: () => boolean;
  applyCameraPreset: (preset: CameraPresetId, animate?: boolean) => void;
  setCameraFollow: (follow: boolean) => void;
  isCameraFollowing: () => boolean;
  setFollowChangeHandler: (cb: ((following: boolean) => void) | null) => void;
  setSafetyWarnings: (entries: SafetyHighlightEntry[]) => void;
  getTCPPose: () => Pose | null;
  getLinkNodes: () => LinkNode[];
  getAdjacentPairs: () => Set<string>;
  getBounds: () => { center: THREE.Vector3; radius: number };
  resize: () => void;
  dispose: () => void;
}

const boundsBox = new THREE.Box3();
const boundsSphere = new THREE.Sphere();

export function createSceneRuntime(options: SceneRuntimeOptions): SceneRuntime {
  const { scene, camera, renderer, controls, container, root, tcp, jointLinkMap, onPoseChange } = options;
  const linkNodes = options.linkNodes ?? collectLinkNodes(root);
  const adjacentPairs = options.adjacentPairs ?? collectAdjacentPairs(root);

  // Self-collision calibration: pairs that overlap in the rest pose are
  // designed to touch (joint housings, flanges, fingers) and are disabled once,
  // at model load, so the live scan only reports new contacts.
  root.updateMatrixWorld(true);
  for (const pair of collectRestPoseOverlaps({ links: linkNodes, adjacent: adjacentPairs })) {
    adjacentPairs.add(pair);
  }

  let frameCallback: FrameCallback | null = null;
  let animationId: number | null = null;
  let lastFrameAt = performance.now();
  let followChangeHandler: ((following: boolean) => void) | null = null;

  const gizmo: TCPGizmoHandles | null = tcp
    ? createTCPGizmo({
        scene,
        camera,
        domElement: renderer.domElement,
        orbit: controls,
        tcp,
        reference: root,
        onPoseChange,
      })
    : null;

  const director: CameraDirectorHandles = createCameraDirector({
    camera,
    controls,
    getTCP: () => tcp,
    getBounds: () => {
      boundsBox.setFromObject(root);
      if (boundsBox.isEmpty()) return { center: new THREE.Vector3(0, 0.5, 0), radius: 1 };
      boundsBox.getBoundingSphere(boundsSphere);
      return {
        center: boundsSphere.center.clone(),
        radius: Math.max(boundsSphere.radius, 0.05),
      };
    },
    onFollowChange: (following) => followChangeHandler?.(following),
  });

  const highlighter = createSafetyHighlighter({ root, jointLinkMap });

  const animate = () => {
    animationId = requestAnimationFrame(animate);

    const now = performance.now();
    // Clamp: a backgrounded tab must not produce a huge interpolation jump.
    const deltaMs = Math.min(now - lastFrameAt, 100);
    lastFrameAt = now;

    frameCallback?.(now, deltaMs);

    gizmo?.update();
    director.update(deltaMs);
    highlighter.update(deltaMs);

    controls.update();
    renderer.render(scene, camera);
  };

  const getLinkNodes = (): LinkNode[] => linkNodes;
  const getAdjacentPairs = (): Set<string> => adjacentPairs;

  return {
    start: () => {
      if (animationId === null) {
        lastFrameAt = performance.now();
        animate();
      }
    },
    setFrameCallback: (cb) => {
      frameCallback = cb;
    },
    setGizmoEnabled: (enabled) => gizmo?.setEnabled(enabled),
    toggleGizmo: () => gizmo?.toggle(),
    setGizmoMode: (mode) => gizmo?.setMode(mode),
    setGizmoSpace: (space) => gizmo?.setSpace(space),
    isGizmoEnabled: () => gizmo?.isEnabled() ?? false,
    applyCameraPreset: (preset, animate = true) => director.applyPreset(preset, animate),
    setCameraFollow: (follow) => director.setFollow(follow),
    isCameraFollowing: () => director.isFollowing(),
    setFollowChangeHandler: (cb) => {
      followChangeHandler = cb;
    },
    setSafetyWarnings: (entries) => highlighter.setWarnings(entries),
    getTCPPose: () => {
      if (!tcp) return null;
      tcp.updateWorldMatrix(true, false);
      const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();

      const position = tcp.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);
      const rootQuaternion = new THREE.Quaternion();
      root.getWorldQuaternion(rootQuaternion);
      const orientation = rootQuaternion
        .clone()
        .invert()
        .multiply(tcp.getWorldQuaternion(new THREE.Quaternion()));

      return {
        position: { x: position.x, y: position.y, z: position.z },
        orientation: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
      };
    },
    getLinkNodes,
    getAdjacentPairs,
    getBounds: () => {
      boundsBox.setFromObject(root);
      if (boundsBox.isEmpty()) return { center: new THREE.Vector3(0, 0.5, 0), radius: 1 };
      boundsBox.getBoundingSphere(boundsSphere);
      return { center: boundsSphere.center.clone(), radius: Math.max(boundsSphere.radius, 0.05) };
    },
    resize: () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    },
    dispose: () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
      frameCallback = null;
      gizmo?.dispose();
      director.dispose();
      highlighter.dispose();
    },
  };
}
