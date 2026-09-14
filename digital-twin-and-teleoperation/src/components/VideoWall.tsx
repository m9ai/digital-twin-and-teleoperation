import { useCallback, useEffect, useMemo, useState } from 'react';
import { Video, Play, Square, Plus, Trash2, PictureInPicture2, AlertCircle } from 'lucide-react';
import { useWebRTC } from '@/hooks/useWebRTC';

/**
 * Multi-camera WebRTC wall.
 *
 * Multiple `webrtc_ros` / WHEP feeds can be monitored side by side, and any
 * single tile can be popped out with the browser Picture-in-Picture API so the
 * operator keeps eyes on the tool while driving joints elsewhere.
 *
 * Browsers only allow one PiP element at a time, so the button swaps the
 * active tile rather than stacking windows.
 */

export interface CameraConfig {
  id: string;
  label: string;
  /** Signaling endpoint: ws(s):// custom bridge or http(s):// WHEP. */
  url: string;
  /** Stream name for custom WebSocket signaling (ignored for WHEP). */
  streamId: string;
}

const STORAGE_KEY = 'robot-camera-wall.v1';

function defaultCameras(): CameraConfig[] {
  return [
    { id: 'cam-1', label: 'Front', url: '', streamId: 'camera_front' },
  ];
}

function loadCameras(): CameraConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCameras();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultCameras();
    return parsed as CameraConfig[];
  } catch {
    return defaultCameras();
  }
}

export function VideoWall() {
  const [cameras, setCameras] = useState<CameraConfig[]>(loadCameras);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftStreamId, setDraftStreamId] = useState('camera_front');
  const [draftLabel, setDraftLabel] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cameras));
    } catch {
      // Private mode: configuration simply is not persisted.
    }
  }, [cameras]);

  const addCamera = useCallback(() => {
    const url = draftUrl.trim();
    if (!url) return;
    setCameras((prev) => [
      ...prev,
      {
        id: `cam-${Date.now()}`,
        label: draftLabel.trim() || `Cam ${prev.length + 1}`,
        url,
        streamId: draftStreamId.trim() || 'camera_front',
      },
    ]);
    setDraftUrl('');
    setDraftLabel('');
  }, [draftUrl, draftStreamId, draftLabel]);

  const removeCamera = useCallback((id: string) => {
    setCameras((prev) => (prev.length === 1 ? prev : prev.filter((c) => c.id !== id)));
  }, []);

  const gridClass = useMemo(() => {
    if (cameras.length <= 1) return 'grid-cols-1';
    if (cameras.length === 2) return 'grid-cols-2';
    return 'grid-cols-2';
  }, [cameras.length]);

  return (
    <div className="panel flex flex-col gap-3">
      <div className="panel-title justify-between">
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4" />
          <span>WebRTC Cameras</span>
        </div>
        <span className="text-[10px] font-normal normal-case text-slate-500">
          {cameras.length} 路 · P2P 直连
        </span>
      </div>

      <div className={`grid gap-2 ${gridClass}`}>
        {cameras.map((camera) => (
          <CameraTile key={camera.id} camera={camera} onRemove={() => removeCamera(camera.id)} />
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-800/40 p-2">
        <div className="flex items-center gap-2">
          <input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            placeholder="wss://robot-ip:8443/ws 或 https://gateway/whep"
          />
          <button
            onClick={addCamera}
            disabled={!draftUrl.trim()}
            className="btn btn-secondary px-2 py-1.5 text-xs disabled:opacity-40"
            title="新增一路摄像头"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            placeholder="名称"
          />
          <input
            value={draftStreamId}
            onChange={(e) => setDraftStreamId(e.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            placeholder="stream id"
          />
        </div>
        <p className="text-[10px] text-slate-500">
          支持自建 WebSocket 信令（webrtc_ros）与标准 WHEP 端点；画中画一次仅允许弹出一路。
        </p>
      </div>
    </div>
  );
}

function CameraTile({ camera, onRemove }: { camera: CameraConfig; onRemove: () => void }) {
  const { videoRef, state, error, connect, disconnect, latencyMs, stats, mode } = useWebRTC(
    camera.url,
    camera.streamId
  );
  const [pipError, setPipError] = useState<string | null>(null);

  const isConnected = state === 'connected';
  const pipSupported =
    typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setPipError(null);
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        await video.requestPictureInPicture();
      }
    } catch (err) {
      setPipError(err instanceof Error ? err.message : '画中画不可用');
    }
  }, [videoRef]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="aspect-video h-full w-full object-cover"
      />

      {!isConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[11px] text-slate-500">
          {state === 'connecting' ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
              <span>Connecting...</span>
            </>
          ) : (
            <span>{camera.url ? 'Stream idle' : '未配置信令地址'}</span>
          )}
        </div>
      )}

      <div className="absolute left-1 top-1 flex items-center gap-1">
        <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-slate-200">{camera.label}</span>
        {latencyMs !== null && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              latencyMs <= 100 ? 'bg-emerald-500/25 text-emerald-300' : 'bg-amber-500/25 text-amber-300'
            }`}
            title="RTT/2 + jitter buffer"
          >
            {latencyMs.toFixed(0)} ms
          </span>
        )}
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-slate-600'
          }`}
        />
      </div>

      <div className="absolute right-1 top-1 flex items-center gap-1">
        {pipSupported && isConnected && (
          <button
            onClick={togglePip}
            title="画中画弹出"
            className="rounded bg-black/70 p-1 text-slate-200 hover:bg-black/90"
          >
            <PictureInPicture2 className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={onRemove}
          title="移除该路"
          className="rounded bg-black/70 p-1 text-slate-400 hover:bg-red-600/80 hover:text-white"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="absolute bottom-1 left-1 flex items-center gap-1">
        {isConnected ? (
          <button
            onClick={disconnect}
            className="flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-black/90"
          >
            <Square className="h-2.5 w-2.5" />
            Stop
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={!camera.url || state === 'connecting'}
            className="flex items-center gap-1 rounded bg-cyan-600/80 px-1.5 py-0.5 text-[10px] text-white hover:bg-cyan-500 disabled:opacity-40"
          >
            <Play className="h-2.5 w-2.5" />
            Start
          </button>
        )}
        {mode && (
          <span className="rounded bg-black/60 px-1 py-0.5 text-[9px] text-slate-400">
            {mode === 'ws' ? 'WS' : 'WHEP'}
          </span>
        )}
        {stats && stats.framesPerSecond > 0 && (
          <span className="rounded bg-black/60 px-1 py-0.5 text-[9px] text-slate-400">
            {stats.framesPerSecond.toFixed(0)} fps · {(stats.kbps / 1000).toFixed(1)} Mbps
          </span>
        )}
      </div>

      {(error || pipError) && (
        <div className="absolute inset-x-1 bottom-6 flex items-start gap-1 rounded bg-red-500/15 px-1.5 py-1 text-[9px] text-red-300">
          <AlertCircle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          <span className="line-clamp-2">{error ?? pipError}</span>
        </div>
      )}
    </div>
  );
}
