import { useEffect, useMemo, useRef, useState } from 'react';
import { createURDFScene, createFallbackScene, type SceneHandles } from '@/lib/urdfScene';
import { useRobotStore } from '@/store/robotStore';
import { useURDFStore } from '@/store/urdfStore';
import { useRecordingStore } from '@/store/recordingStore';
import { sampleTrajectory } from '@/lib/trajectory';
import { Maximize2, RotateCcw, Spline } from 'lucide-react';

/** Cap FK samples so a long recording cannot stall the UI thread. */
const MAX_PATH_POINTS = 300;

export function RobotViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showPath, setShowPath] = useState(true);
  const [pathStats, setPathStats] = useState<{ points: number; length: number } | null>(null);
  const { jointState } = useRobotStore();
  const { blobUrl } = useURDFStore();

  const library = useRecordingStore((s) => s.library);
  const selectedId = useRecordingStore((s) => s.selectedId);
  const playheadMs = useRecordingStore((s) => s.playheadMs);

  const selected = useMemo(
    () => library.find((item) => item.id === selectedId) ?? null,
    [library, selectedId]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !blobUrl) return;

    let mounted = true;
    setLoaded(false);
    setError(null);

    createURDFScene(container, blobUrl)
      .then((handles) => {
        if (!mounted) {
          handles.dispose();
          return;
        }
        sceneRef.current = handles;
        setLoaded(true);
        setError(null);

        const resizeObserver = new ResizeObserver(() => handles.resize());
        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
          handles.dispose();
        };
      })
      .catch((err) => {
        console.warn('[RobotViewer] URDF load failed, using fallback scene:', err);
        if (!mounted) return;
        const fallback = createFallbackScene(container);
        sceneRef.current = fallback;
        setLoaded(true);
        setError('URDF unavailable; fallback model in use');

        const resizeObserver = new ResizeObserver(() => fallback.resize());
        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
          fallback.dispose();
        };
      });

    return () => {
      mounted = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [blobUrl]);

  useEffect(() => {
    if (sceneRef.current && jointState.name.length > 0) {
      sceneRef.current.applyJointState(jointState);
    }
  }, [jointState]);

  /** Rebuild the end-effector polyline whenever the selection or model changes. */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (!showPath || !selected || selected.frames.length < 2) {
      scene.setTrajectoryPath(null);
      setPathStats(null);
      return;
    }

    const stride = Math.max(1, Math.ceil(selected.frames.length / MAX_PATH_POINTS));
    const samples = selected.frames
      .filter((_, index) => index % stride === 0 || index === selected.frames.length - 1)
      .map((frame) => frame.position);

    const points = scene.computeEndEffectorPath(samples, selected.jointNames);
    scene.setTrajectoryPath(points);

    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    setPathStats({ points: points.length, length });
  }, [selected, showPath, loaded]);

  /** Park a marker at the playhead so scrubbing maps to a pose in the scene. */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (!showPath || !selected) {
      scene.setPathPlayhead(null);
      return;
    }

    const positions = sampleTrajectory(selected, playheadMs);
    const [point] = scene.computeEndEffectorPath([positions], selected.jointNames);
    scene.setPathPlayhead(point ?? null);
  }, [selected, showPath, playheadMs, loaded]);

  const handleResetCamera = () => {
    if (sceneRef.current) {
      sceneRef.current.camera.position.set(1.5, 1.2, 2);
      sceneRef.current.controls.target.set(0, 0.5, 0);
      sceneRef.current.controls.update();
    }
  };

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
        <div ref={containerRef} className="absolute inset-0" />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Loading robot model...
          </div>
        )}
        {showPath && pathStats && (
          <div className="absolute left-2 top-2 rounded bg-slate-900/80 px-2 py-1 text-[10px] text-cyan-300 ring-1 ring-cyan-500/30">
            末端路径 {pathStats.points} 点 · 长度 {(pathStats.length * 1000).toFixed(0)} mm
          </div>
        )}
        {error && (
          <div className="absolute bottom-2 left-2 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-400 ring-1 ring-amber-500/30">
            {error}
          </div>
        )}
        <button
          onClick={handleResetCamera}
          className="btn btn-secondary absolute bottom-2 right-2 p-2"
          title="Reset camera"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
