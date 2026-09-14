import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Box,
  Crosshair,
  Move3d,
  Rotate3d,
  Video,
  Scan,
  AlertTriangle,
} from 'lucide-react';
import {
  createFallbackScene,
  createURDFScene,
  type SceneHandles,
} from '@/lib/urdfScene';
import { JointStateStream } from '@/lib/jointStream';
import { subscribeJointState } from '@/lib/jointBus';
import { detectLinkProximity, evaluateJointLimits } from '@/lib/safetyMonitor';
import type { SafetyHighlightEntry } from '@/lib/scene/safetyHighlight';
import type { CameraPresetId, GizmoMode, Pose, SafetyReport } from '@/types';
import type { URDFJointDefinition } from '@/lib/urdfJoints';

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
  /** End-effector polyline to overlay, or null to clear it. */
  trajectoryPath?: THREE.Vector3[] | null;
  /** Playhead marker position along the trajectory. */
  playhead?: THREE.Vector3 | null;
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
  { id: 'top', label: 'Top-Down', icon: Scan },
  { id: 'tcp', label: 'TCP-Follow', icon: Crosshair },
];

export function RobotTwin({
  urdfUrl,
  joints = [],
  trajectoryPath,
  playhead,
  onPoseChange,
  onSafety,
  interpolationDelayMs = 80,
  showToolbar = true,
  onReady,
  className = 'relative h-full w-full',
}: RobotTwinProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gizmoOn, setGizmoOn] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [preset, setPreset] = useState<CameraPresetId>('perspective');
  const [following, setFollowing] = useState(false);
  const [inputRateHz, setInputRateHz] = useState(0);

  // Keep callbacks out of effect dependencies: the render loop must not be
  // torn down just because a parent re-created an inline handler.
  const poseHandlerRef = useRef(onPoseChange);
  poseHandlerRef.current = onPoseChange;
  const safetyHandlerRef = useRef(onSafety);
  safetyHandlerRef.current = onSafety;
  const readyHandlerRef = useRef(onReady);
  readyHandlerRef.current = onReady;

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
      setReady(true);
      readyHandlerRef.current?.(handles);

      observer = new ResizeObserver(() => handles.resize());
      observer.observe(container);
      handles.resize();
    };

    const build = urdfUrl
      ? createURDFScene(container, urdfUrl, {
          onPoseChange: (pose, phase) => poseHandlerRef.current?.(pose, phase),
        })
      : Promise.resolve(
          createFallbackScene(container, {
            onPoseChange: (pose, phase) => poseHandlerRef.current?.(pose, phase),
          })
        );

    build
      .then(attach)
      .catch((err: unknown) => {
        console.warn('[RobotTwin] URDF load failed, using fallback scene:', err);
        if (disposed) return;
        setError('URDF unavailable; fallback model in use');
        attach(
          createFallbackScene(container, {
            onPoseChange: (pose, phase) => poseHandlerRef.current?.(pose, phase),
          })
        );
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      handlesRef.current?.dispose();
      handlesRef.current = null;
      setReady(false);
    };
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
      const proximity = detectLinkProximity({
        links: runtime.getLinkNodes(),
        adjacent: runtime.getAdjacentPairs(),
      });

      const entries: SafetyHighlightEntry[] = [
        ...jointWarnings.map((warning) => ({ joint: warning.joint, level: warning.level })),
        ...proximity.flatMap((pair) => {
          const level = pair.level;
          return [
            { link: pair.a, level } as SafetyHighlightEntry,
            { link: pair.b, level } as SafetyHighlightEntry,
          ];
        }),
      ];
      runtime.setSafetyWarnings(entries);

      safetyHandlerRef.current?.({ joints: jointWarnings, proximity, at: Date.now() });
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

  const applyPreset = (id: CameraPresetId) => {
    setPreset(id);
    handlesRef.current?.runtime?.applyCameraPreset(id, true);
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
    </div>
  );
}

export default RobotTwin;
