import { useState, useMemo } from 'react';
import { Video, Play, Square, AlertCircle } from 'lucide-react';
import { useWebRTC } from '@/hooks/useWebRTC';

function isValidWsUrl(url: string): boolean {
  if (!url.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

export function VideoStream() {
  const [signalingUrl, setSignalingUrl] = useState('');
  const { videoRef, state, error, connect, disconnect, latencyMs } = useWebRTC(signalingUrl, 'camera_front');

  const isConnected = state === 'connected';
  const canConnect = useMemo(() => isValidWsUrl(signalingUrl), [signalingUrl]);

  return (
    <div className="panel flex flex-col gap-3">
      <div className="panel-title">
        <Video className="h-4 w-4" />
        <span>WebRTC Video Stream</span>
      </div>

      <div className="relative aspect-video overflow-hidden rounded-lg border border-slate-800 bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {state !== 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-500">
            {state === 'connecting' ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
                <span>Connecting stream...</span>
              </>
            ) : (
              <span>Stream idle</span>
            )}
          </div>
        )}
        <div className="absolute right-2 top-2 flex items-center gap-2">
          {latencyMs !== null && (
            <span className="rounded bg-black/60 px-1.5 py-0.5 text-xs text-slate-300">
              {latencyMs.toFixed(0)} ms
            </span>
          )}
          <span
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-slate-500'
            }`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={signalingUrl}
            onChange={(e) => setSignalingUrl(e.target.value)}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            placeholder="wss://robot-ip:8443/ws"
          />
          {isConnected ? (
            <button onClick={disconnect} className="btn btn-danger px-3 py-1.5 text-xs">
              <Square className="h-3 w-3" />
              Stop
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={!canConnect || state === 'connecting'}
              className="btn btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              <Play className="h-3 w-3" />
              Start
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-xs text-red-400 ring-1 ring-red-500/30">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
