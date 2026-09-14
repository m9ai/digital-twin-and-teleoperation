import { useState, useMemo } from 'react';
import { Video, Play, Square, AlertCircle } from 'lucide-react';
import { useWebRTC } from '@/hooks/useWebRTC';

export function VideoStream() {
  const [signalingUrl, setSignalingUrl] = useState('');
  const [streamId, setStreamId] = useState('camera_front');
  const { videoRef, state, error, connect, disconnect, latencyMs, mode } = useWebRTC(
    signalingUrl,
    streamId,
  );

  const isConnected = state === 'connected';
  const canConnect = mode !== null && (mode !== 'ws' || streamId.trim().length > 0);
  const isBusy = isConnected || state === 'connecting';

  /** HTTPS 页面下浏览器会拦截明文 ws:// / http://，提前提示而不是让用户猜连接失败原因 */
  const mixedContentWarning = useMemo(() => {
    if (typeof window === 'undefined' || window.location.protocol !== 'https:') return null;
    try {
      const protocol = new URL(signalingUrl.trim()).protocol;
      if (protocol === 'ws:') return '当前页面为 HTTPS，浏览器会拦截明文 ws://，请改用 wss://';
      if (protocol === 'http:') return '当前页面为 HTTPS，浏览器会拦截明文 http://，请改用 https://';
    } catch {
      return null;
    }
    return null;
  }, [signalingUrl]);

  const modeHint =
    mode === 'ws'
      ? '自建 WebSocket 信令'
      : mode === 'whep'
        ? 'WHEP 端点（标准 HTTP 信令），流名由 URL 指定'
        : '支持 ws://、wss:// 自建信令，或 http(s):// WHEP 端点';

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
            placeholder="wss://robot-ip:8443/ws 或 https://gateway/whep"
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

        {mode !== 'whep' && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="webrtc-stream-id"
              className="w-16 shrink-0 text-[11px] text-slate-500"
            >
              Stream ID
            </label>
            <input
              id="webrtc-stream-id"
              type="text"
              value={streamId}
              onChange={(e) => setStreamId(e.target.value)}
              disabled={isBusy}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              placeholder="camera_front"
            />
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {mode && (
            <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-300">
              {mode === 'ws' ? 'WS' : 'WHEP'}
            </span>
          )}
          <span>{modeHint}</span>
        </div>

        {mixedContentWarning && (
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-400 ring-1 ring-amber-500/30">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{mixedContentWarning}</span>
          </div>
        )}

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
