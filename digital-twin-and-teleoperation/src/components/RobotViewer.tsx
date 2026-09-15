import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Spline, ShieldAlert, Radio } from 'lucide-react';
import * as THREE from 'three';
import { SceneQuickSettings } from '@/components/SceneQuickSettings';
import { useSceneStore } from '@/store/sceneStore';
import { RobotTwin } from '@/components/RobotTwin';
import { useRobotStore } from '@/store/robotStore';
import { useURDFStore } from '@/store/urdfStore';
import { useRecordingStore } from '@/store/recordingStore';
import { useConnectionStore } from '@/store/connectionStore';
import { sampleTrajectory } from '@/lib/trajectory';
import { rosClientRef } from '@/lib/rosRef';
import type { EnvironmentSettings, Pose, SafetyReport } from '@/types';

/** Cap FK samples so a long recording cannot stall the UI thread. */
const MAX_PATH_POINTS = 300;

export function RobotViewer() {
  const [showPath, setShowPath] = useState(true);
  const [pathStats, setPathStats] = useState<{ points: number; length: number } | null>(null);
  const [safety, setSafety] = useState<SafetyReport | null>(null);

  const { blobUrl, joints, links } = useURDFStore();
  const eStop = useRobotStore((s) => s.eStop);
  const addLog = useRobotStore((s) => s.addLog);
  const useSimulation = useConnectionStore((s) => s.useSimulation);

  // Scene store snapshot → a stable settings object for the environment rig.
  // Primitive dependencies keep the identity stable across unrelated edits.
  const preset = useSceneStore((s) => s.preset);
  const gridVisible = useSceneStore((s) => s.gridVisible);
  const gridSize = useSceneStore((s) => s.gridSize);
  const gridDivisions = useSceneStore((s) => s.gridDivisions);
  const axesVisible = useSceneStore((s) => s.axesVisible);
  const background = useSceneStore((s) => s.background);
  const lighting = useSceneStore((s) => s.lighting);
  const sceneSafety = useSceneStore((s) => s.safety);
  const customScenes = useSceneStore((s) => s.scenes);

  const environment = useMemo<EnvironmentSettings>(
    () => ({
      preset,
      grid: { visible: gridVisible, size: gridSize, divisions: gridDivisions },
      axes: axesVisible,
      background,
      lighting,
      safety: sceneSafety,
    }),
    [preset, gridVisible, gridSize, gridDivisions, axesVisible, background, lighting, sceneSafety]
  );

  const library = useRecordingStore((s) => s.library);
  const selectedId = useRecordingStore((s) => s.selectedId);
  const playheadMs = useRecordingStore((s) => s.playheadMs);

  const selected = useMemo(
    () => library.find((item) => item.id === selectedId) ?? null,
    [library, selectedId]
  );

  const handlesRef = useRef<{ computeEndEffectorPath: (s: number[][], n: string[]) => THREE.Vector3[] } | null>(
    null
  );
  const [ready, setReady] = useState(false);

  const [trajectoryPath, setTrajectoryPath] = useState<THREE.Vector3[] | null>(null);
  const [playheadPoint, setPlayheadPoint] = useState<THREE.Vector3 | null>(null);
  const [pointCloud, setPointCloud] = useState<Float32Array | null>(null);

  /** Mock LiDAR point cloud in ROS Z-up coordinates; replace with ROS topic. */
  useEffect(() => {
    setPointCloud(generateMockPointCloud());
    const id = window.setInterval(() => {
      setPointCloud(generateMockPointCloud());
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  /** Rebuild the end-effector polyline whenever the selection or model changes. */
  useEffect(() => {
    const compute = handlesRef.current;
    if (!compute) return;

    if (!showPath || !selected || selected.frames.length < 2) {
      setTrajectoryPath(null);
      setPathStats(null);
      return;
    }

    const stride = Math.max(1, Math.ceil(selected.frames.length / MAX_PATH_POINTS));
    const samples = selected.frames
      .filter((_, index) => index % stride === 0 || index === selected.frames.length - 1)
      .map((frame) => frame.position);

    const points = compute.computeEndEffectorPath(samples, selected.jointNames);
    setTrajectoryPath(points);

    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    setPathStats({ points: points.length, length });
  }, [selected, showPath, ready]);

  /** Park a marker at the playhead so scrubbing maps to a pose in the scene. */
  useEffect(() => {
    const compute = handlesRef.current;
    if (!compute) return;

    if (!showPath || !selected) {
      setPlayheadPoint(null);
      return;
    }

    const positions = sampleTrajectory(selected, playheadMs);
    const [point] = compute.computeEndEffectorPath([positions], selected.jointNames);
    setPlayheadPoint(point ?? null);
  }, [selected, showPath, playheadMs, ready]);

  /** Dragging the TCP gizmo publishes a Cartesian target for the IK solver. */
  const handlePoseChange = useCallback(
    (pose: Pose, phase: 'drag' | 'end') => {
      if (eStop) return;

      if (!useSimulation) {
        try {
          rosClientRef.current?.publishPoseStamped(pose);
        } catch {
          // Bridge down: the twin still previews the target, so stay quiet.
        }
      }

      if (phase === 'end') {
        const { x, y, z } = pose.position;
        addLog(
          `IK target → (${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)})${
            useSimulation ? ' [sim]' : ' → /ik_target'
          }`
        );
      }
    },
    [eStop, useSimulation, addLog]
  );

  const handleSafety = useCallback((report: SafetyReport) => {
    setSafety(report);
  }, []);

  const violations = safety
    ? safety.joints.filter((j) => j.level === 'violation').length +
      safety.proximity.filter((p) => p.level === 'violation').length +
      safety.obstacles.filter((p) => p.level === 'violation').length
    : 0;
  const warnings = safety
    ? safety.joints.filter((j) => j.level === 'warn').length +
      safety.proximity.filter((p) => p.level === 'warn').length +
      safety.obstacles.filter((p) => p.level === 'warn').length
    : 0;

  return (
    <div className="panel flex flex-1 flex-col min-h-[320px]">
      <div className="panel-title justify-between">
        <div className="flex items-center gap-2">
          <Maximize2 className="h-4 w-4" />
          <span>Digital Twin</span>
        </div>
        <button
          onClick={() => setShowPath((value) => !value)}
          disabled={!selected}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-40 ${
            showPath && selected
              ? 'bg-cyan-600/20 text-cyan-300 ring-1 ring-cyan-500/40'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
          title={selected ? '显示 / 隐藏末端轨迹' : '请先在 Motion Recorder 中选择一条轨迹'}
        >
          <Spline className="h-3 w-3" />
          轨迹
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <RobotTwin
          urdfUrl={blobUrl}
          joints={joints}
          links={links}
          trajectoryPath={trajectoryPath}
          playhead={playheadPoint}
          pointCloud={pointCloud}
          onPoseChange={handlePoseChange}
          onSafety={handleSafety}
          environment={environment}
          customScenes={customScenes}
          onSceneReady={(id, stats) => useSceneStore.getState().markSceneReady(id, stats)}
          onSceneError={(id, message) => useSceneStore.getState().markSceneError(id, message)}
          className="absolute inset-0"
          onReady={(handles) => {
            handlesRef.current = handles;
            setReady(true);
          }}
        />

        <SceneQuickSettings />

        {showPath && pathStats && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-slate-900/80 px-2 py-1 text-[10px] text-cyan-300 ring-1 ring-cyan-500/30">
            末端路径 {pathStats.points} 点 · 长度 {(pathStats.length * 1000).toFixed(0)} mm
          </div>
        )}

        {(violations > 0 || warnings > 0) && (
          <div
            className={`pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded px-2 py-1 text-[10px] ring-1 ${
              violations > 0
                ? 'bg-red-500/15 text-red-300 ring-red-500/40'
                : 'bg-amber-500/15 text-amber-300 ring-amber-500/40'
            }`}
            title={safety
              ? [
                  ...safety.joints.map((j) => `${j.joint} ${j.value.toFixed(2)} ∉ [${j.lower.toFixed(2)}, ${j.upper.toFixed(2)}]`),
                  ...safety.proximity.map((p) => `自碰 ${p.a} ↔ ${p.b} 间距 ${(p.distance * 1000).toFixed(0)} mm`),
                  ...safety.obstacles.map((p) => `场景 ${p.a} ↔ ${p.b} 间距 ${(p.distance * 1000).toFixed(0)} mm`),
                ].join('\n')
              : undefined}
          >
            <ShieldAlert className="h-3 w-3" />
            {violations > 0 ? `${violations} 处越限 / 碰撞` : `${warnings} 处接近限界`}
            {safety && safety.obstacles.length > 0 && (
              <span className="ml-1 opacity-70">· 场景 {safety.obstacles.length}</span>
            )}
          </div>
        )}

        {eStop && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
            <span className="rounded bg-red-600/90 px-3 py-1 text-xs font-black uppercase tracking-widest text-white">
              Motion Locked
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <Radio className="h-3 w-3" />
          /joint_states → 环形缓冲 + 帧内插值
        </span>
        <span>点击模型关节可拖动 · 点击末端小球召唤 Gizmo</span>
      </div>
    </div>
  );
}

const MOCK_POINT_COUNT = 5000;

function generateMockPointCloud(): Float32Array {
  const points = new Float32Array(MOCK_POINT_COUNT * 3);
  for (let i = 0; i < MOCK_POINT_COUNT; i++) {
    if (Math.random() < 0.8) {
      // Ground plane in ROS Z-up coordinates (Z ~= 0).
      points[i * 3] = (Math.random() - 0.5) * 6;
      points[i * 3 + 1] = (Math.random() - 0.5) * 6;
      points[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    } else {
      // Clutter / obstacles above ground.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 1.2 + Math.random() * 1.8;
      points[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      points[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      points[i * 3 + 2] = r * Math.cos(phi) + 0.5;
    }
  }
  return points;
}
