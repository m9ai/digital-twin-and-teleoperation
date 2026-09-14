import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Spline, ShieldAlert, Radio } from 'lucide-react';
import * as THREE from 'three';
import { RobotTwin } from '@/components/RobotTwin';
import { useRobotStore } from '@/store/robotStore';
import { useURDFStore } from '@/store/urdfStore';
import { useRecordingStore } from '@/store/recordingStore';
import { useConnectionStore } from '@/store/connectionStore';
import { sampleTrajectory } from '@/lib/trajectory';
import { rosClientRef } from '@/lib/rosRef';
import type { Pose, SafetyReport } from '@/types';

/** Cap FK samples so a long recording cannot stall the UI thread. */
const MAX_PATH_POINTS = 300;

export function RobotViewer() {
  const [showPath, setShowPath] = useState(true);
  const [pathStats, setPathStats] = useState<{ points: number; length: number } | null>(null);
  const [safety, setSafety] = useState<SafetyReport | null>(null);

  const { blobUrl, joints } = useURDFStore();
  const eStop = useRobotStore((s) => s.eStop);
  const addLog = useRobotStore((s) => s.addLog);
  const useSimulation = useConnectionStore((s) => s.useSimulation);

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
      safety.proximity.filter((p) => p.level === 'violation').length
    : 0;
  const warnings = safety
    ? safety.joints.filter((j) => j.level === 'warn').length +
      safety.proximity.filter((p) => p.level === 'warn').length
    : 0;

  return (
    <div className="panel flex flex-1 flex-col min-h-[320px]">
      <div className="panel-title justify-between">
        <div className="flex items-center gap-2">
          <Maximize2 className="h-4 w-4" />
          <span>Digital Twin (URDF / Three.js)</span>
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
          trajectoryPath={trajectoryPath}
          playhead={playheadPoint}
          onPoseChange={handlePoseChange}
          onSafety={handleSafety}
          className="absolute inset-0"
          onReady={(handles) => {
            handlesRef.current = handles;
            setReady(true);
          }}
        />

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
                  ...safety.proximity.map((p) => `${p.a} ↔ ${p.b} 间距 ${(p.distance * 1000).toFixed(0)} mm`),
                ].join('\n')
              : undefined}
          >
            <ShieldAlert className="h-3 w-3" />
            {violations > 0 ? `${violations} 处越限 / 碰撞` : `${warnings} 处接近限界`}
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
        <span>点击末端小球召唤 Gizmo</span>
      </div>
    </div>
  );
}
