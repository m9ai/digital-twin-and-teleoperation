import { useEffect, useRef, useState } from 'react';
import { createURDFScene, createFallbackScene, type SceneHandles } from '@/lib/urdfScene';
import { useRobotStore } from '@/store/robotStore';
import { useURDFStore } from '@/store/urdfStore';
import { Maximize2, RotateCcw } from 'lucide-react';

export function RobotViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { jointState } = useRobotStore();
  const { blobUrl } = useURDFStore();

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

  const handleResetCamera = () => {
    if (sceneRef.current) {
      sceneRef.current.camera.position.set(1.5, 1.2, 2);
      sceneRef.current.controls.target.set(0, 0.5, 0);
      sceneRef.current.controls.update();
    }
  };

  return (
    <div className="panel flex flex-1 flex-col min-h-[320px]">
      <div className="panel-title">
        <Maximize2 className="h-4 w-4" />
        <span>Digital Twin (URDF / Three.js)</span>
      </div>
      <div className="relative flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <div ref={containerRef} className="absolute inset-0" />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Loading robot model...
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
