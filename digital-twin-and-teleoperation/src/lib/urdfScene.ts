import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import { loadRobotMesh } from '@/lib/scene/modelLoader';
import {
  createEnvironmentRig,
  type EnvironmentRig,
  type EnvironmentRigCallbacks,
} from '@/lib/scene/environmentRig';
import {
  createSceneRuntime,
  type FrameCallback,
  type SceneRuntime,
} from '@/lib/scene/runtime';
import {
  colorForLinkName,
  createDefaultPBRMaterial,
  ensurePBRMaterial,
  findLinkName,
} from '@/lib/scene/materials';
import type { SafetyHighlightEntry } from '@/lib/scene/safetyHighlight';
import type { LinkNode } from '@/lib/safetyMonitor';
import type { CameraPresetId, GizmoMode, JointState, Pose } from '@/types';

export interface SceneHandles {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  robot: THREE.Object3D | null;
  /** Object defining the TCP (tool0), or null when the model has no links. */
  tcp: THREE.Object3D | null;
  applyJointState: (state: JointState) => void;
  /** Low-level setter used by the interpolated render loop. */
  applyJointPositions: (names: string[], values: number[]) => void;
  dispose: () => void;
  resize: () => void;
  /**
   * Forward kinematics: map joint-position samples to end-effector world
   * coordinates. Joint values are temporarily overwritten and restored, so
   * the live pose driven by telemetry is never left modified.
   */
  computeEndEffectorPath: (samples: number[][], jointNames: string[]) => THREE.Vector3[];
  /** Draw (or clear, with null) the end-effector path polyline. */
  setTrajectoryPath: (points: THREE.Vector3[] | null) => void;
  /** Move the playhead marker along the drawn path. */
  setPathPlayhead: (point: THREE.Vector3 | null) => void;
  /** Render loop, gizmo, camera presets and safety highlighting. */
  runtime: SceneRuntime | null;
  /** Scene in which the robot operates: lights, backdrop and static props. */
  environment: EnvironmentRig;
}

/** The last link of the kinematic chain: a link that is no joint's parent. */
function findEndEffectorLink(robot: THREE.Object3D): THREE.Object3D | null {
  const urdf = robot as unknown as {
    joints?: Record<string, { parent?: THREE.Object3D; child?: THREE.Object3D }>;
    links?: Record<string, THREE.Object3D>;
  };
  if (!urdf.links) return null;

  const parentNames = new Set<string>();
  for (const joint of Object.values(urdf.joints ?? {})) {
    if (joint.parent?.name) parentNames.add(joint.parent.name);
  }

  const leaves = Object.values(urdf.links).filter((link) => !parentNames.has(link.name));
  return leaves[leaves.length - 1] ?? null;
}

export function createTrajectoryPathOverlay(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.name = 'trajectory-path';
  scene.add(group);

  const playhead = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  playhead.visible = false;
  group.add(playhead);

  const clearGroup = () => {
    // Keep the playhead marker; drop everything else from the previous path.
    for (const child of group.children) {
      if (child === playhead) continue;
      group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose?.();
    }
  };

  const setTrajectoryPath = (points: THREE.Vector3[] | null) => {
    clearGroup();
    if (!points || points.length < 2) return;

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 })
    );
    group.add(line);

    const marker = (point: THREE.Vector3, color: number) => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 12, 12),
        new THREE.MeshBasicMaterial({ color })
      );
      dot.position.copy(point);
      group.add(dot);
    };
    marker(points[0], 0x34d399);
    marker(points[points.length - 1], 0xf97316);
  };

  const setPathPlayhead = (point: THREE.Vector3 | null) => {
    playhead.visible = Boolean(point);
    if (point) playhead.position.copy(point);
  };

  const dispose = () => {
    setTrajectoryPath(null);
    scene.remove(group);
    playhead.geometry.dispose();
    (playhead.material as THREE.Material).dispose();
  };

  return { setTrajectoryPath, setPathPlayhead, dispose };
}

interface SceneShell {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Lights, backdrop, grid and generated / uploaded scenery. */
  environment: EnvironmentRig;
}

/**
 * Renderer + camera + orbit controls, plus the environment rig.
 *
 * Lighting deliberately lives in the rig rather than here: scene presets must
 * be swappable at runtime without rebuilding the renderer or the URDF.
 */
function createSceneShell(
  container: HTMLElement,
  callbacks: EnvironmentRigCallbacks = {}
): SceneShell {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 200);
  camera.position.set(1.5, 1.2, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0.5, 0);

  const environment = createEnvironmentRig({ scene, renderer, ...callbacks });

  return { scene, camera, renderer, controls, environment };
}

export function createURDFScene(
  container: HTMLElement,
  urdfUrl: string,
  options: {
    onPoseChange?: (pose: Pose, phase: 'drag' | 'end') => void;
    environment?: EnvironmentRigCallbacks;
  } = {}
): Promise<SceneHandles> {
  const { scene, camera, renderer, controls, environment } = createSceneShell(
    container,
    options.environment ?? {}
  );

  let robot: THREE.Object3D | null = null;
  let runtime: SceneRuntime | null = null;

  const loader = new URDFLoader() as unknown as {
    loadMeshCb: (
      path: string,
      manager: THREE.LoadingManager,
      done: (mesh: THREE.Object3D | null, err?: unknown) => void
    ) => void;
  };
  loader.loadMeshCb = (path, manager, done) => loadRobotMesh(path, manager, done);

  return new Promise((resolve, reject) => {
    fetch(urdfUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load URDF: ${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((urdfText) => {
        // Pass an empty working path so mesh filenames that are already
        // absolute blob URLs are not prepended with the URDF base URL.
        const parsed = (loader as unknown as { parse: (text: string, path: string) => THREE.Object3D }).parse(urdfText, '');
        robot = parsed;
        robot.scale.set(1, 1, 1);

        // ROS URDF uses Z-up; Three.js uses Y-up. Rotate the root so the
        // robot stands upright in the Three.js scene.
        robot.rotation.x = -Math.PI / 2;

        const linkMaterialCache = new Map<string, THREE.MeshStandardMaterial>();

        robot.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const current = mesh.material;
            const baseMaterial = Array.isArray(current) ? current[0] : current;

            let material: THREE.MeshStandardMaterial;
            const hasURDFMaterial = baseMaterial && baseMaterial.name;
            if (hasURDFMaterial) {
              // Preserve the URDF-defined material color/texture but upgrade
              // the shader to PBR.
              material = ensurePBRMaterial(baseMaterial);
            } else {
              // No URDF <material> tag: assign a per-link PBR color so STL
              // meshes and anonymous primitives don't all render grey.
              const linkName = findLinkName(mesh, robot!) || 'default';
              if (!linkMaterialCache.has(linkName)) {
                material = createDefaultPBRMaterial();
                material.color.setHex(colorForLinkName(linkName));
                linkMaterialCache.set(linkName, material);
              } else {
                material = linkMaterialCache.get(linkName)!;
              }
            }

            mesh.material = material;
          }
        });
        scene.add(robot);

        // Force initial matrix computation now that transforms are set.
        robot.updateMatrix();
        robot.updateMatrixWorld(true);

        const urdfJoints = (robot as unknown as {
          joints: Record<string, { setJointValue: (...values: number[]) => void; angle?: number }>;
        }).joints;

        const applyJointPositions = (names: string[], values: number[]) => {
          if (!robot) return;
          let changed = false;
          names.forEach((name, index) => {
            const joint = urdfJoints?.[name];
            if (joint && typeof joint.setJointValue === 'function') {
              joint.setJointValue(values[index] ?? 0);
              changed = true;
            }
          });
          if (changed) robot.updateMatrixWorld(true);
        };

        const applyJointState = (state: JointState) => {
          applyJointPositions(
            state.name,
            state.name.map((_, index) => state.position[index] ?? 0)
          );
        };

        const endEffector = findEndEffectorLink(robot);
        // tool0 convention: the TCP sits at the end-effector link origin.
        const tcp = new THREE.Object3D();
        tcp.name = 'tcp_frame';
        (endEffector ?? robot).add(tcp);

        const computeEndEffectorPath = (samples: number[][], jointNames: string[]): THREE.Vector3[] => {
          if (!robot || !endEffector || !urdfJoints) return [];

          const saved = jointNames.map((name) => urdfJoints[name]?.angle ?? 0);
          const points: THREE.Vector3[] = [];

          for (const sample of samples) {
            jointNames.forEach((name, i) => urdfJoints[name]?.setJointValue(sample[i] ?? 0));
            robot.updateMatrixWorld(true);
            points.push(tcp.getWorldPosition(new THREE.Vector3()));
          }

          // Restore the live pose; the whole sweep is synchronous so it never
          // reaches the renderer in an intermediate state.
          jointNames.forEach((name, i) => urdfJoints[name]?.setJointValue(saved[i]));
          robot.updateMatrixWorld(true);

          return points;
        };

        const overlay = createTrajectoryPathOverlay(scene);

        runtime = createSceneRuntime({
          scene,
          camera,
          renderer,
          controls,
          container,
          root: robot,
          tcp,
          onPoseChange: options.onPoseChange,
        });
        runtime.start();

        const dispose = () => {
          runtime?.dispose();
          overlay.dispose();
          environment.dispose();
          controls.dispose();
          renderer.dispose();
          if (container.contains(renderer.domElement)) {
            container.removeChild(renderer.domElement);
          }
        };

        const resize = () => runtime?.resize();

        resolve({
          scene,
          camera,
          renderer,
          controls,
          robot,
          tcp,
          applyJointState,
          applyJointPositions,
          dispose,
          resize,
          computeEndEffectorPath,
          setTrajectoryPath: overlay.setTrajectoryPath,
          setPathPlayhead: overlay.setPathPlayhead,
          runtime,
          environment,
        });
      })
      .catch((err: unknown) => reject(err));
  });
}

export function createFallbackScene(
  container: HTMLElement,
  options: {
    onPoseChange?: (pose: Pose, phase: 'drag' | 'end') => void;
    environment?: EnvironmentRigCallbacks;
  } = {}
): SceneHandles {
  const { scene, camera, renderer, controls, environment } = createSceneShell(
    container,
    options.environment ?? {}
  );

  const robotGroup = new THREE.Group();
  robotGroup.name = 'fallback_robot';
  const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x334155 });
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x1e5aa8 });
  const linkGreyMaterial = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
  const linkSilverMaterial = new THREE.MeshStandardMaterial({ color: 0xc0c5c9 });
  const toolMaterial = new THREE.MeshStandardMaterial({ color: 0xf97316 });

  // Base link
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.15, 0.45), baseMaterial);
  base.name = 'base';
  base.position.y = 0.075;
  base.castShadow = true;
  robotGroup.add(base);

  // Joint 1: waist (rotate around z)
  const joint1Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 24), jointMaterial);
  joint1Housing.name = 'joint1_housing';
  joint1Housing.position.y = 0.15;
  joint1Housing.castShadow = true;
  robotGroup.add(joint1Housing);

  const joint1Pivot = new THREE.Group();
  joint1Pivot.name = 'joint1_pivot';
  joint1Pivot.position.y = 0.15;
  robotGroup.add(joint1Pivot);

  const link1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 16), linkGreyMaterial);
  link1.name = 'link1';
  link1.position.y = 0.25;
  link1.castShadow = true;
  joint1Pivot.add(link1);

  // Joint 2: shoulder (rotate around y)
  const joint2Housing = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 24), jointMaterial);
  joint2Housing.name = 'joint2_housing';
  joint2Housing.position.y = 0.5;
  joint2Housing.castShadow = true;
  joint1Pivot.add(joint2Housing);

  const joint2Pivot = new THREE.Group();
  joint2Pivot.name = 'joint2_pivot';
  joint2Pivot.position.y = 0.5;
  joint1Pivot.add(joint2Pivot);

  // Link 2: upper arm along +x (Three.js cylinder y-up; rotate -90 deg around z)
  const link2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 16), linkSilverMaterial);
  link2.name = 'link2';
  link2.rotation.z = -Math.PI / 2;
  link2.position.x = 0.275;
  link2.castShadow = true;
  joint2Pivot.add(link2);

  // Joint 3: elbow (rotate around y)
  const joint3Housing = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 24), jointMaterial);
  joint3Housing.name = 'joint3_housing';
  joint3Housing.position.x = 0.55;
  joint3Housing.castShadow = true;
  joint2Pivot.add(joint3Housing);

  const joint3Pivot = new THREE.Group();
  joint3Pivot.name = 'joint3_pivot';
  joint3Pivot.position.x = 0.55;
  joint2Pivot.add(joint3Pivot);

  // Link 3: forearm along +x (Three.js cylinder y-up; rotate -90 deg around z)
  const link3 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 16), linkGreyMaterial);
  link3.name = 'link3';
  link3.rotation.z = -Math.PI / 2;
  link3.position.x = 0.225;
  link3.castShadow = true;
  joint3Pivot.add(link3);

  // Joint 4: wrist roll (rotate around z)
  const joint4Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 24), jointMaterial);
  joint4Housing.name = 'joint4_housing';
  joint4Housing.position.x = 0.45;
  joint4Housing.castShadow = true;
  joint3Pivot.add(joint4Housing);

  const joint4Pivot = new THREE.Group();
  joint4Pivot.name = 'joint4_pivot';
  joint4Pivot.position.x = 0.45;
  joint3Pivot.add(joint4Pivot);

  // Link 4: wrist segment along z
  const link4 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 16), linkSilverMaterial);
  link4.name = 'link4';
  link4.position.y = 0.1;
  link4.castShadow = true;
  joint4Pivot.add(link4);

  // Joint 5: wrist bend (rotate around x)
  const joint5Housing = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 24), jointMaterial);
  joint5Housing.name = 'joint5_housing';
  joint5Housing.position.y = 0.2;
  joint5Housing.castShadow = true;
  joint4Pivot.add(joint5Housing);

  const joint5Pivot = new THREE.Group();
  joint5Pivot.name = 'joint5_pivot';
  joint5Pivot.position.y = 0.2;
  joint4Pivot.add(joint5Pivot);

  // Link 5: tool flange along z
  const link5 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), linkGreyMaterial);
  link5.name = 'link5';
  link5.position.y = 0.06;
  link5.castShadow = true;
  joint5Pivot.add(link5);

  // Tool / end effector
  const tool0 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), toolMaterial);
  tool0.name = 'tool0';
  tool0.position.y = 0.16;
  tool0.castShadow = true;
  joint5Pivot.add(tool0);

  scene.add(robotGroup);
  robotGroup.updateMatrixWorld(true);

  const parts: Record<string, THREE.Object3D> = {
    joint1: joint1Pivot,
    joint2: joint2Pivot,
    joint3: joint3Pivot,
    joint4: joint4Pivot,
    joint5: joint5Pivot,
  };

  const axisForJoint = (name: string): 'x' | 'y' | 'z' => {
    if (name === 'joint2' || name === 'joint3') return 'y';
    if (name === 'joint5') return 'x';
    return 'z';
  };

  const setFallbackJoints = (jointNames: string[], values: number[]) => {
    jointNames.forEach((name, i) => {
      const part = parts[name];
      if (part) part.rotation[axisForJoint(name)] = values[i] ?? 0;
    });
    robotGroup.updateMatrixWorld(true);
  };

  const applyJointState = (state: JointState) => {
    setFallbackJoints(
      state.name,
      state.name.map((_, index) => state.position[index] ?? 0)
    );
  };

  const computeEndEffectorPath = (samples: number[][], jointNames: string[]): THREE.Vector3[] => {
    const saved = jointNames.map((name) => parts[name]?.rotation[axisForJoint(name)] ?? 0);
    const points: THREE.Vector3[] = [];

    for (const sample of samples) {
      setFallbackJoints(jointNames, sample);
      points.push(tool0.getWorldPosition(new THREE.Vector3()));
    }

    setFallbackJoints(jointNames, saved);
    return points;
  };

  const overlay = createTrajectoryPathOverlay(scene);

  /** Which link each joint drives, so safety highlighting can find a mesh. */
  const jointLinkMap: Record<string, string> = {
    joint1: 'link1',
    joint2: 'link2',
    joint3: 'link3',
    joint4: 'link4',
    joint5: 'link5',
  };

  const linkNodes: LinkNode[] = [base, link1, link2, link3, link4, link5, tool0].map((mesh) => ({
    name: mesh.name,
    object: mesh,
  }));

  const chain = ['base', 'link1', 'link2', 'link3', 'link4', 'link5', 'tool0'];
  const adjacentPairs = new Set<string>();
  for (let i = 0; i < chain.length - 1; i++) {
    adjacentPairs.add(`${chain[i]} ${chain[i + 1]}`);
    adjacentPairs.add(`${chain[i + 1]} ${chain[i]}`);
  }

  const runtime = createSceneRuntime({
    scene,
    camera,
    renderer,
    controls,
    container,
    root: robotGroup,
    tcp: tool0,
    jointLinkMap,
    linkNodes,
    adjacentPairs,
    onPoseChange: options.onPoseChange,
  });
  runtime.start();

  return {
    scene,
    camera,
    renderer,
    controls,
    robot: robotGroup,
    tcp: tool0,
    applyJointState,
    applyJointPositions: setFallbackJoints,
    computeEndEffectorPath,
    setTrajectoryPath: overlay.setTrajectoryPath,
    setPathPlayhead: overlay.setPathPlayhead,
    runtime,
    environment,
    dispose: () => {
      runtime.dispose();
      overlay.dispose();
      environment.dispose();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
    resize: () => runtime.resize(),
  };
}

/** Re-exported so consumers can type gizmo / camera controls without deep imports. */
export type { FrameCallback, SceneRuntime, CameraPresetId, GizmoMode, SafetyHighlightEntry, Pose };
