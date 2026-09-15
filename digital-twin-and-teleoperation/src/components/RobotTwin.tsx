import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Box,
  Cloud,
  Crosshair,
  Move3d,
  Rotate3d,
  Video,
  AlertTriangle,
  Axis3D,
  Check,
} from 'lucide-react';
import {
  createFallbackScene,
  createURDFScene,
  type SceneHandles,
} from '@/lib/urdfScene';
import { JointStateStream } from '@/lib/jointStream';
import { subscribeJointState } from '@/lib/jointBus';
import {
  detectLinkProximity,
  detectObstacleProximity,
  evaluateJointLimits,
} from '@/lib/safetyMonitor';
import type { SafetyHighlightEntry } from '@/lib/scene/safetyHighlight';
import type { JointSelectionInfo } from '@/lib/scene/jointInteraction';
import type { StandardViewAxis } from '@/lib/scene/cameraDirector';
import type {
  CameraPresetId,
  CustomScene,
  CustomSceneStats,
  EnvironmentSettings,
  GizmoMode,
  Pose,
  SafetyReport,
} from '@/types';
import type { URDFJointDefinition } from '@/lib/urdfJoints';
import { useRobotStore } from '@/store/robotStore';
import { useConnectionStore } from '@/store/connectionStore';
import { rosClientRef } from '@/lib/rosRef';

/**
 * `RobotTwin` — reusable Web URDF viewer with ROS 2 data sync.
 *
 * The component owns the Three.js lifecycle and the high-frequency data path:
 *
 *  - `/joint_states` are written to a ring buffer outside React and sampled
 *    with linear interpolation inside the render loop, so a 100 Hz feed
 *    renders smoothly at 60 FPS without re-rendering React.
 *  - Clicking the TCP summons a `TransformControls` gizmo; dragging publishes
 *    an IK target pose expressed in the robot base frame.
 *  - Camera presets (perspective / head / top / TCP-follow) transition with an
 *    eased tween driven by the same render loop.
 *  - Joint limit and link proximity faults tint the affected links.
 */

export interface RobotTwinProps {
  /** URL of the URDF to render; `null` renders the procedural fallback arm. */
  urdfUrl: string | null;
  /** URDF joint definitions: drive safety checks and wrap-aware interpolation. */
  joints?: URDFJointDefinition[];
  /** Parsed link metadata for the interactive inspector. */
  links?: import('@/lib/urdfJoints').URDFLinkDefinition[];
  /** End-effector polyline to overlay, or null to clear it. */
  trajectoryPath?: THREE.Vector3[] | null;
  /** Playhead marker position along the trajectory. */
  playhead?: THREE.Vector3 | null;
  /** World-coordinate point cloud (XYZ) to overlay on the twin, or null to clear. */
  pointCloud?: Float32Array | null;
  /** IK target sampled while dragging the TCP gizmo. */
  onPoseChange?: (pose: Pose, phase: 'drag' | 'end') => void;
  /** Safety evaluation result, emitted at ~8 Hz. */
  onSafety?: (report: SafetyReport) => void;
  /** Playback delay for interpolation, in ms. */
  interpolationDelayMs?: number;
  /** Render the built-in view toolbar (camera presets + gizmo controls). */
  showToolbar?: boolean;
  /** Access to the underlying scene handles once the model is ready. */
  onReady?: (handles: SceneHandles) => void;
  /** Decorative + lighting environment; applied without rebuilding the robot. */
  environment?: EnvironmentSettings;
  /** User uploaded scene models placed around the robot. */
  customScenes?: CustomScene[];
  /** Report a decoded scene model back to the store (size, triangle count). */
  onSceneReady?: (id: string, stats: CustomSceneStats) => void;
  /** Report a scene model that failed to parse. */
  onSceneError?: (id: string, message: string) => void;
  /**
   * Layout classes for the root element. It must define a height — either
   * `absolute inset-0` inside a positioned parent, or `relative h-full w-full`.
   * No positioning class is added by default so `absolute` never conflicts.
   */
  className?: string;
}

const SAFETY_INTERVAL_MS = 120;
const STREAM_CAPACITY = 160;

const CAMERA_PRESETS: Array<{ id: CameraPresetId; label: string; icon: typeof Box }> = [
  { id: 'perspective', label: 'Perspective', icon: Box },
  { id: 'head', label: 'Head-Cam', icon: Video },
  { id: 'tcp', label: 'TCP-Follow', icon: Crosshair },
];

const STANDARD_VIEWS: Array<{ axis: StandardViewAxis; label: string }> = [
  { axis: '+Z', label: '+Z' },
  { axis: '-Z', label: '-Z' },
  { axis: '+Y', label: '+Y' },
  { axis: '-Y', label: '-Y' },
  { axis: '+X', label: '+X' },
  { axis: '-X', label: '-X' },
];

export function RobotTwin({
  urdfUrl,
  joints = [],
  links = [],
  trajectoryPath,
  playhead,
  pointCloud,
  onPoseChange,
  onSafety,
  interpolationDelayMs = 80,
  showToolbar = true,
  onReady,
  environment,
  customScenes,
  onSceneReady,
  onSceneError,
  className = 'relative h-full w-full',
}: RobotTwinProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gizmoOn, setGizmoOn] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [preset, setPreset] = useState<CameraPresetId>('perspective');
  const [standardView, setStandardView] = useState<StandardViewAxis | null>(null);
  const [showStandardViews, setShowStandardViews] = useState(false);
  const [pointCloudVisible, setPointCloudVisible] = useState(false);
  const [following, setFollowing] = useState(false);
  const [inputRateHz, setInputRateHz] = useState(0);
  const [hoverInfo, setHoverInfo] = useState<JointSelectionInfo | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [dragInfo, setDragInfo] = useState<JointSelectionInfo | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const setJointTarget = useRobotStore((s) => s.setJointTarget);
  const setJogActive = useRobotStore((s) => s.setJogActive);
  const { useSimulation } = useConnectionStore();
  const useSimulationRef = useRef(useSimulation);
  useSimulationRef.current = useSimulation;

  // Keep callbacks out of effect dependencies: the render loop must not be
  // torn down just because a parent re-created an inline handler.
  const poseHandlerRef = useRef(onPoseChange);
  poseHandlerRef.current = onPoseChange;
  const safetyHandlerRef = useRef(onSafety);
  safetyHandlerRef.current = onSafety;
  const readyHandlerRef = useRef(onReady);
  readyHandlerRef.current = onReady;
  const sceneReadyRef = useRef(onSceneReady);
  sceneReadyRef.current = onSceneReady;
  const sceneErrorRef = useRef(onSceneError);
  sceneErrorRef.current = onSceneError;
  // The rig reads the latest snapshot when it is rebuilt, keeping the scene
  // lifecycle dependent on `urdfUrl` alone.
  const environmentRef = useRef(environment);
  environmentRef.current = environment;
  const customScenesRef = useRef(customScenes);
  customScenesRef.current = customScenes;

  const continuousJoints = useMemo(
    () => new Set(joints.filter((j) => j.type === 'continuous').map((j) => j.name)),
    [joints]
  );

  const streamRef = useRef<JointStateStream | null>(null);
  if (!streamRef.current) {
    streamRef.current = new JointStateStream({
      capacity: STREAM_CAPACITY,
      interpolationDelayMs,
      continuous: (name) => continuousJoints.has(name),
    });
  }
  const stream = streamRef.current;

  useEffect(() => {
    stream.setPlaybackDelay(interpolationDelayMs);
  }, [interpolationDelayMs, stream]);

  // ---- scene lifecycle ---------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;
    setReady(false);
    setError(null);

    const attach = (handles: SceneHandles) => {
      if (disposed) {
        handles.dispose();
        return;
      }
      handlesRef.current = handles;
      handles.runtime?.setFollowChangeHandler(setFollowing);
      // Restore the workspace before the first frame so the robot is never
      // briefly rendered in an empty void.
      if (environmentRef.current) handles.environment.apply(environmentRef.current);
      handles.environment.syncCustomScenes(customScenesRef.current ?? []);
      setReady(true);
      readyHandlerRef.current?.(handles);

      observer = new ResizeObserver(() => handles.resize());
      observer.observe(container);
      handles.resize();
    };

    const sceneCallbacks = {
      onSceneReady: (id: string, stats: CustomSceneStats) => sceneReadyRef.current?.(id, stats),
      onSceneError: (id: string, message: string) => sceneErrorRef.current?.(id, message),
    };
    const poseCallback = {
      onPoseChange: (pose: Pose, phase: 'drag' | 'end') => poseHandlerRef.current?.(pose, phase),
    };

    const handleJointHover = (info: JointSelectionInfo | null) => {
      setHoverInfo(info);
      if (info) {
        setHoverPos(clampCardPos(container, info.screenX, info.screenY));
        setJogActive(true);
      } else {
        setHoverPos(null);
      }
      handlesRef.current?.setActiveJointGizmo?.(info?.jointName ?? null);
    };

    const handleJointSelect = (info: JointSelectionInfo | null) => {
      setDragInfo(info);
      if (info) {
        setDragPos(clampCardPos(container, info.screenX, info.screenY));
        setJogActive(true);
      } else {
        setDragPos(null);
      }
    };

    const handleJointChange = (name: string, value: number) => {
      setJointTarget(name, value);
    };

    const handleJointDragEnd = (name: string, value: number) => {
      setJointTarget(name, value);
      if (!useSimulationRef.current) {
        const names = joints.map((j) => j.name);
        const positions = names.map((n) => useRobotStore.getState().jointTargets[n] ?? 0);
        try {
          rosClientRef.current?.publishJointCommand(names, positions);
        } catch {
          // ROS not connected; ignore.
        }
      }
    };

    const build = urdfUrl
      ? createURDFScene(container, urdfUrl, {
          ...poseCallback,
          environment: sceneCallbacks,
          joints,
          links,
          onJointHover: handleJointHover,
          onJointSelect: handleJointSelect,
          onJointChange: handleJointChange,
          onJointDragEnd: handleJointDragEnd,
        })
      : Promise.resolve(
          createFallbackScene(container, { ...poseCallback, environment: sceneCallbacks })
        );

    build
      .then(attach)
      .catch((err: unknown) => {
        console.warn('[RobotTwin] URDF load failed, using fallback scene:', err);
        if (disposed) return;
        setError('URDF unavailable; fallback model in use');
        attach(createFallbackScene(container, { ...poseCallback, environment: sceneCallbacks }));
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      handlesRef.current?.dispose();
      handlesRef.current = null;
      setReady(false);
    };
    // The scene lifecycle is intentionally tied only to the URDF source.
    // Joint/link metadata come from the same URDF and arrive together with urdfUrl.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urdfUrl]);

  // ---- high frequency data path (no React state) -------------------------
  useEffect(() => {
    return subscribeJointState((state) => stream.push(state));
  }, [stream]);

  useEffect(() => {
    const handles = handlesRef.current;
    const runtime = handles?.runtime;
    if (!handles || !runtime) return;

    const buffer: number[] = [];
    runtime.setFrameCallback((nowMs) => {
      if (!stream.sampleInto(nowMs, buffer)) return;
      handles.applyJointPositions(stream.jointNames, buffer);
    });

    return () => runtime.setFrameCallback(null);
  }, [ready, stream]);

  // Report the measured input rate once per second (display only).
  useEffect(() => {
    const id = window.setInterval(() => setInputRateHz(stream.inputRateHz), 1000);
    return () => window.clearInterval(id);
  }, [stream]);

  // ---- environment reconciliation ---------------------------------------
  useEffect(() => {
    if (!ready || !environment) return;
    handlesRef.current?.environment.apply(environment);
  }, [environment, ready]);

  useEffect(() => {
    if (!ready) return;
    handlesRef.current?.environment.syncCustomScenes(customScenes ?? []);
  }, [customScenes, ready]);

  // ---- safety evaluation -------------------------------------------------
  useEffect(() => {
    if (!ready) return;

    const id = window.setInterval(() => {
      const handles = handlesRef.current;
      const runtime = handles?.runtime;
      if (!handles || !runtime) return;

      const names = stream.jointNames;
      const positions = stream.latest();
      if (!positions || names.length === 0) return;

      const byName: Record<string, number> = {};
      names.forEach((name, index) => {
        byName[name] = positions[index];
      });

      const jointWarnings = evaluateJointLimits(joints, byName);
      const links = runtime.getLinkNodes();
      const proximity = detectLinkProximity({
        links,
        adjacent: runtime.getAdjacentPairs(),
      });

      // Scene contacts are opt-in: scanning the whole environment every pass
      // costs nothing for a human but plenty for untrusted uploaded models.
      const obstacles = environmentRef.current?.safety.obstacleCheck
        ? detectObstacleProximity({
            links,
            obstacles: handles.environment.getObstacleNodes(),
            warnDistance: environmentRef.current.safety.warnDistance,
          })
        : [];

      const entries: SafetyHighlightEntry[] = [
        ...jointWarnings.map((warning) => ({ joint: warning.joint, level: warning.level })),
        ...proximity.flatMap((pair) => {
          const level = pair.level;
          return [
            { link: pair.a, level } as SafetyHighlightEntry,
            { link: pair.b, level } as SafetyHighlightEntry,
          ];
        }),
        // Only the robot side of an obstacle contact can be tinted.
        ...obstacles.map((pair) => ({ link: pair.a, level: pair.level }) as SafetyHighlightEntry),
      ];
      runtime.setSafetyWarnings(entries);

      safetyHandlerRef.current?.({ joints: jointWarnings, proximity, obstacles, at: Date.now() });
    }, SAFETY_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [ready, joints, stream]);

  // ---- overlays ----------------------------------------------------------
  useEffect(() => {
    handlesRef.current?.setTrajectoryPath(trajectoryPath ?? null);
  }, [trajectoryPath, ready]);

  useEffect(() => {
    handlesRef.current?.setPathPlayhead(playhead ?? null);
  }, [playhead, ready]);

  useEffect(() => {
    handlesRef.current?.setPointCloud(pointCloud ?? null);
    handlesRef.current?.setPointCloudVisible(pointCloudVisible);
  }, [pointCloud, pointCloudVisible, ready]);

  const applyPreset = (id: CameraPresetId) => {
    setPreset(id);
    setStandardView(null);
    handlesRef.current?.runtime?.applyCameraPreset(id, true);
  };

  const applyStandardView = (axis: StandardViewAxis) => {
    setStandardView(axis);
    setPreset('perspective');
    setShowStandardViews(false);
    handlesRef.current?.runtime?.applyStandardView(axis, true);
  };

  const togglePointCloud = () => {
    const next = !pointCloudVisible;
    setPointCloudVisible(next);
    handlesRef.current?.setPointCloudVisible(next);
  };

  const toggleGizmo = () => {
    const next = !gizmoOn;
    handlesRef.current?.runtime?.setGizmoEnabled(next);
    setGizmoOn(next);
  };

  const changeGizmoMode = (mode: GizmoMode) => {
    setGizmoMode(mode);
    handlesRef.current?.runtime?.setGizmoMode(mode);
  };

  return (
    <div className={`flex flex-col ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          Loading robot model...
        </div>
      )}

      {showToolbar && ready && (
        <div className="absolute left-2 bottom-2 flex flex-wrap items-center gap-1 rounded-lg bg-slate-900/85 p-1 ring-1 ring-slate-700 backdrop-blur">
          {CAMERA_PRESETS.map(({ id, label, icon: Icon }) => {
            const active = id === 'tcp' ? following : preset === id && !following;
            return (
              <button
                key={id}
                onClick={() => applyPreset(id)}
                title={`${label} 视角`}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                  active
                    ? 'bg-cyan-600/25 text-cyan-300 ring-1 ring-cyan-500/40'
                    : 'text-slate-400 hover:bg-slate-700/70 hover:text-slate-200'
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}

          <span className="mx-1 h-4 w-px bg-slate-700" />

          <div className="relative">
            <button
              onClick={() => setShowStandardViews((v) => !v)}
              title="标准正交视图"
              className={`flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                standardView
                  ? 'bg-cyan-600/25 text-cyan-300 ring-1 ring-cyan-500/40'
                  : 'text-slate-400 hover:bg-slate-700/70 hover:text-slate-200'
              }`}
            >
              <Axis3D className="h-3 w-3" />
              {standardView ?? '视图'}
            </button>
            {showStandardViews && (
              <div className="absolute bottom-full left-0 mb-1 flex flex-col rounded-lg bg-slate-900/95 p-1 ring-1 ring-slate-700 shadow-xl backdrop-blur">
                {STANDARD_VIEWS.map(({ axis, label }) => (
                  <button
                    key={axis}
                    onClick={() => applyStandardView(axis)}
                    className={`flex items-center justify-between gap-3 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                      standardView === axis
                        ? 'bg-cyan-600/25 text-cyan-300'
                        : 'text-slate-300 hover:bg-slate-700/70 hover:text-slate-100'
                    }`}
                  >
                    <span className="whitespace-nowrap">{label}</span>
                    {standardView === axis && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="mx-1 h-4 w-px bg-slate-700" />

          <button
            onClick={togglePointCloud}
            disabled={!pointCloud}
            title={pointCloud ? '显示 / 隐藏 LiDAR 点云' : '暂无点云数据'}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-40 ${
              pointCloudVisible
                ? 'bg-cyan-600/25 text-cyan-300 ring-1 ring-cyan-500/40'
                : 'text-slate-400 hover:bg-slate-700/70 hover:text-slate-200'
            }`}
          >
            <Cloud className="h-3 w-3" />
            点云
          </button>

          <span className="mx-1 h-4 w-px bg-slate-700" />

          <button
            onClick={toggleGizmo}
            title="点击 TCP 或此处召唤三维姿态轴"
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              gizmoOn
                ? 'bg-amber-500/25 text-amber-300 ring-1 ring-amber-500/40'
                : 'text-slate-400 hover:bg-slate-700/70 hover:text-slate-200'
            }`}
          >
            <Move3d className="h-3 w-3" />
            Gizmo
          </button>

          {gizmoOn && (
            <>
              <button
                onClick={() => changeGizmoMode('translate')}
                title="平移目标位姿"
                className={`rounded px-1.5 py-1 text-[10px] transition-colors ${
                  gizmoMode === 'translate' ? 'text-cyan-300' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Move3d className="h-3 w-3" />
              </button>
              <button
                onClick={() => changeGizmoMode('rotate')}
                title="旋转目标位姿"
                className={`rounded px-1.5 py-1 text-[10px] transition-colors ${
                  gizmoMode === 'rotate' ? 'text-cyan-300' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Rotate3d className="h-3 w-3" />
              </button>
            </>
          )}

          {inputRateHz > 0 && (
            <span className="ml-1 rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-400">
              {inputRateHz.toFixed(0)} Hz
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400 ring-1 ring-amber-500/30">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </div>
      )}

      {hoverInfo && hoverPos && !dragInfo && (
        <JointInspectorCard
          info={hoverInfo}
          style={{ left: hoverPos.x, top: hoverPos.y }}
        />
      )}
      {dragInfo && dragPos && (
        <JointInspectorCard
          info={dragInfo}
          style={{ left: dragPos.x, top: dragPos.y }}
        />
      )}
    </div>
  );
}

function clampCardPos(container: HTMLElement, screenX: number, screenY: number) {
  const rect = container.getBoundingClientRect();
  const CARD_W = 260;
  const CARD_H = 210;
  const margin = 8;
  const x = Math.min(
    Math.max(screenX - rect.left + 12, margin),
    Math.max(rect.width - CARD_W - margin, margin)
  );
  const y = Math.min(
    Math.max(screenY - rect.top + 12, margin),
    Math.max(rect.height - CARD_H - margin, margin)
  );
  return { x, y };
}

function toRPY(q: THREE.Quaternion, degrees = false) {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const scale = degrees ? 180 / Math.PI : 1;
  return {
    r: e.x * scale,
    p: e.y * scale,
    y: e.z * scale,
  };
}

function JointInspectorCard({
  info,
  style,
}: {
  info: JointSelectionInfo;
  style: React.CSSProperties;
}) {
  const rpyRad = toRPY(info.orientation, false);
  const rpyDeg = toRPY(info.orientation, true);
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg bg-slate-900/90 p-3 text-xs shadow-xl ring-1 ring-slate-700 backdrop-blur"
      style={style}
    >
      <div className="mb-2">
        <div className="font-semibold text-sky-400">Link: {info.linkName}</div>
      </div>
      <div className="space-y-1 text-slate-300">
        <div>
          Joint: <span className="text-slate-200">{info.jointName}</span>{' '}
          <span className="text-slate-500">({info.jointType})</span>
        </div>
        <div>Mass: {info.mass.toFixed(4)} kg</div>
        <div>Position:</div>
        <div className="pl-2 font-mono text-[10px] text-slate-400">
          x={info.position.x.toFixed(4)} m · y={info.position.y.toFixed(4)} m · z=
          {info.position.z.toFixed(4)} m
        </div>
        <div>Orientation:</div>
        <div className="pl-2 font-mono text-[10px] text-slate-400">
          Quat: x={info.orientation.x.toFixed(4)} y={info.orientation.y.toFixed(4)} z=
          {info.orientation.z.toFixed(4)} w={info.orientation.w.toFixed(4)}
        </div>
        <div className="pl-2 font-mono text-[10px] text-slate-400">
          RPY (rad): r={rpyRad.r.toFixed(4)} p={rpyRad.p.toFixed(4)} y={rpyRad.y.toFixed(4)}
        </div>
        <div className="pl-2 font-mono text-[10px] text-slate-400">
          RPY (deg): r={rpyDeg.r.toFixed(4)} p={rpyDeg.p.toFixed(4)} y={rpyDeg.y.toFixed(4)}
        </div>
        <div>
          Value:{' '}
          <span className="font-mono text-cyan-400">
            {info.value.toFixed(4)} {info.unit}
          </span>
        </div>
        <div className="pt-1 text-[10px] text-slate-500">水平拖动控制关节角度</div>
      </div>
    </div>
  );
}

export default RobotTwin;
