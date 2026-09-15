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
import {
  createJointInteraction,
  type JointInteractionHandles,
  type JointSelectionInfo,
} from '@/lib/scene/jointInteraction';
import type { SafetyHighlightEntry } from '@/lib/scene/safetyHighlight';
import type { LinkNode } from '@/lib/safetyMonitor';
import type { URDFJointDefinition, URDFLinkDefinition } from '@/lib/urdfJoints';
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
  /** Click-a-link joint inspection / jog controller. */
  jointInteraction: JointInteractionHandles | null;
  /** Parsed movable joints and link metadata from the URDF. */
  jointDefinitions: URDFJointDefinition[];
  linkDefinitions: URDFLinkDefinition[];
  /** Highlight the axis gizmo of the given joint, or hide all with null. */
  setActiveJointGizmo: (jointName: string | null) => void;
  /** Show / hide every joint axis gizmo at once. */
  setAllJointGizmosVisible: (visible: boolean) => void;
  /** Replace the displayed point cloud (world-coordinate XYZ array) or clear it. */
  setPointCloud: (points: Float32Array | null) => void;
  /** Show / hide the point cloud overlay. */
  setPointCloudVisible: (visible: boolean) => void;
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

/**
 * Visual gizmo for a joint: a red arrow along the axis and a green ring + arrow
 * indicating the positive rotation direction. Added as a child of the joint node
 * so it lives in the joint frame.
 */
function createJointAxisGizmo(axis: THREE.Vector3): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'joint_axis_gizmo';
  group.renderOrder = 999;

  const dir = axis.clone().normalize();
  const len = 0.15;

  // Red arrow along the joint axis (normal). Always draw on top of the mesh.
  const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), len, 0xff3333, len * 0.15, len * 0.1);
  arrow.traverse((child) => {
    const material = (child as THREE.Mesh | THREE.Line).material;
    if (material) {
      if (Array.isArray(material)) material.forEach((m) => (m.depthTest = false));
      else material.depthTest = false;
    }
  });
  group.add(arrow);

  // Green ring perpendicular to the axis.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.003, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9, depthTest: false })
  );
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  group.add(ring);

  // Small green arrow on the ring showing the positive rotation direction.
  const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(dir, up).normalize();
  const binormal = new THREE.Vector3().crossVectors(dir, tangent).normalize();
  const rotArrow = new THREE.ArrowHelper(tangent, binormal.clone().multiplyScalar(0.08), 0.06, 0x22c55e, 0.02, 0.015);
  rotArrow.traverse((child) => {
    const material = (child as THREE.Mesh | THREE.Line).material;
    if (material) {
      if (Array.isArray(material)) material.forEach((m) => (m.depthTest = false));
      else material.depthTest = false;
    }
  });
  group.add(rotArrow);

  group.visible = false;
  return group;
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

export function createPointCloudOverlay(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.name = 'point-cloud';
  group.visible = false;
  scene.add(group);

  let points: THREE.Points | null = null;

  const setPointCloud = (positions: Float32Array | null) => {
    if (points) {
      group.remove(points);
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
      points = null;
    }

    if (!positions || positions.length < 3) return;

    const count = Math.floor(positions.length / 3);
    const geometry = new THREE.BufferGeometry();

    // Expect incoming points in ROS/URDF Z-up coordinates and convert to
    // Three.js Y-up: (x, y, z) -> (x, z, -y).
    const threePositions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      threePositions[i * 3] = positions[i * 3];
      threePositions[i * 3 + 1] = positions[i * 3 + 2];
      threePositions[i * 3 + 2] = -positions[i * 3 + 1];
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(threePositions, 3));

    // Color by height (ROS Z) for immediate depth perception.
    const colors = new Float32Array(count * 3);
    const colorLow = new THREE.Color(0x22d3ee);
    const colorHigh = new THREE.Color(0xf472b6);
    const minZ = -2;
    const maxZ = 2;
    const range = Math.max(maxZ - minZ, 0.001);

    for (let i = 0; i < count; i++) {
      const z = positions[i * 3 + 2];
      const t = Math.min(1, Math.max(0, (z - minZ) / range));
      const c = colorLow.clone().lerp(colorHigh, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.025,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
    });

    points = new THREE.Points(geometry, material);
    group.add(points);
  };

  const setVisible = (visible: boolean) => {
    group.visible = visible;
  };

  const dispose = () => {
    setPointCloud(null);
    scene.remove(group);
  };

  return { setPointCloud, setVisible, dispose };
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
    joints?: URDFJointDefinition[];
    links?: URDFLinkDefinition[];
    onJointHover?: (info: JointSelectionInfo | null) => void;
    onJointSelect?: (info: JointSelectionInfo | null) => void;
    onJointChange?: (jointName: string, value: number) => void;
    onJointDragEnd?: (jointName: string, value: number) => void;
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

  // Mesh loading happens asynchronously after `loader.parse()` returns. We
  // track outstanding loads so the initial camera framing is computed once all
  // geometry is actually present, otherwise the bounding box is too small and
  // the robot appears oversized / clipped.
  let pendingMeshes = 0;
  let hasFramed = false;
  let settleRaf: number | null = null;
  let settleFrame = 0;
  let framingTimeout: number | null = null;

  const MAX_SETTLE_FRAMES = 18;
  const GROUND_EPSILON = 0.02;

  const settleRobotOnGround = () => {
    if (!robot) return;
    // Ensure every asynchronously loaded mesh has contributed to the world
    // matrices before measuring the lowest point.
    robot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(robot);
    if (box.isEmpty()) return;
    // In Three.js y = 0 is the ground plane. Many URDFs (especially humanoids)
    // define base_link above the feet, so after the Z-up -> Y-up rotation the
    // lowest point ends up below y = 0. Shift the root so the model rests on
    // the ground without changing its horizontal placement.
    // A visible epsilon keeps the soles clearly above generated floor planes
    // and avoids z-fighting with the ground grid (which sits at y ≈ 0.003).
    if (box.min.y < GROUND_EPSILON) {
      robot.position.y += GROUND_EPSILON - box.min.y;
      robot.updateMatrixWorld(true);
    }
  };

  const stopScheduledSettle = () => {
    if (settleRaf !== null) {
      cancelAnimationFrame(settleRaf);
      settleRaf = null;
    }
    settleFrame = 0;
  };

  /**
   * Keep re-measuring the model bounds for several frames. URDFLoader sometimes
   * attaches geometry a frame or two after the loader callback fires, so a
   * single measurement can miss late meshes and leave the robot penetrating
   * the ground.
   */
  const scheduleSettle = () => {
    stopScheduledSettle();
    const step = () => {
      settleRobotOnGround();
      settleFrame += 1;
      if (settleFrame < MAX_SETTLE_FRAMES) {
        settleRaf = requestAnimationFrame(step);
      } else {
        settleRaf = null;
      }
    };
    step();
  };

  const applyInitialFraming = () => {
    // Always keep settling; camera framing is only done once.
    scheduleSettle();
    if (!hasFramed && runtime) {
      hasFramed = true;
      runtime.applyCameraPreset('perspective', false);
    }
  };

  loader.loadMeshCb = (path, manager, done) => {
    pendingMeshes += 1;
    loadRobotMesh(path, manager, (mesh, err) => {
      done(mesh, err);
      pendingMeshes -= 1;
      if (pendingMeshes === 0) {
        if (framingTimeout !== null) {
          clearTimeout(framingTimeout);
          framingTimeout = null;
        }
        applyInitialFraming();
      }
    });
  };

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
          joints: Record<
            string,
            THREE.Object3D & {
              axis: THREE.Vector3;
              jointType: string;
              setJointValue: (...values: number[]) => void;
              angle?: number;
            }
          >;
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
        const pointCloudOverlay = createPointCloudOverlay(scene);

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
        // Defer the initial framing until every asynchronous mesh has been
        // loaded, otherwise the bounding box is too small and the camera ends
        // up zoomed in too far. For mesh-less URDFs this fires immediately.
        // A hard timeout prevents a hung mesh from leaving the model forever
        // underground.
        if (pendingMeshes === 0) {
          applyInitialFraming();
        } else {
          framingTimeout = window.setTimeout(() => {
            framingTimeout = null;
            applyInitialFraming();
          }, 6000);
        }

        const jointGizmos = new Map<string, THREE.Object3D>();
        for (const def of options.joints ?? []) {
          const joint = urdfJoints?.[def.name];
          if (!joint || !joint.axis) continue;
          const gizmo = createJointAxisGizmo(joint.axis);
          joint.add(gizmo);
          jointGizmos.set(def.name, gizmo);
        }

        let allJointGizmosVisible = false;

        const setActiveJointGizmo = (name: string | null) => {
          if (allJointGizmosVisible) {
            // In "show all" mode keep every gizmo visible and slightly enlarge
            // the currently hovered / selected one for emphasis.
            for (const [jointName, gizmo] of jointGizmos) {
              gizmo.scale.setScalar(jointName === name ? 1.3 : 1);
            }
            return;
          }
          for (const [jointName, gizmo] of jointGizmos) {
            gizmo.visible = jointName === name;
          }
        };

        const setAllJointGizmosVisible = (visible: boolean) => {
          allJointGizmosVisible = visible;
          for (const gizmo of jointGizmos.values()) {
            gizmo.visible = visible;
            if (!visible) gizmo.scale.setScalar(1);
          }
        };

        const jointInteraction =
          options.joints && options.joints.length > 0
            ? createJointInteraction({
                domElement: renderer.domElement,
                camera,
                robot,
                joints: options.joints,
                links: options.links ?? [],
                controls,
                onHover: (info) => options.onJointHover?.(info),
                onSelect: (info) => options.onJointSelect?.(info),
                onChange: (name, value) => options.onJointChange?.(name, value),
                onDragEnd: (name, value) => options.onJointDragEnd?.(name, value),
              })
            : null;

        const dispose = () => {
          stopScheduledSettle();
          if (framingTimeout !== null) {
            clearTimeout(framingTimeout);
            framingTimeout = null;
          }
          jointInteraction?.dispose();
          runtime?.dispose();
          overlay.dispose();
          pointCloudOverlay.dispose();
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
          setPointCloud: pointCloudOverlay.setPointCloud,
          setPointCloudVisible: pointCloudOverlay.setVisible,
          runtime,
          environment,
          jointInteraction,
          jointDefinitions: options.joints ?? [],
          linkDefinitions: options.links ?? [],
          setActiveJointGizmo,
          setAllJointGizmosVisible,
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
  const pointCloudOverlay = createPointCloudOverlay(scene);

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
  // Same initial framing for the procedural fallback model.
  runtime.applyCameraPreset('perspective', false);

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
    jointInteraction: null,
    jointDefinitions: [],
    linkDefinitions: [],
    setActiveJointGizmo: () => {},
    setAllJointGizmosVisible: () => {},
    setPointCloud: pointCloudOverlay.setPointCloud,
    setPointCloudVisible: pointCloudOverlay.setVisible,
    dispose: () => {
      runtime.dispose();
      overlay.dispose();
      pointCloudOverlay.dispose();
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
