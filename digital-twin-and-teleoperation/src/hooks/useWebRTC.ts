import { useEffect, useRef, useState, useCallback } from 'react';

export type WebRTCState = 'idle' | 'connecting' | 'connected' | 'failed';

/**
 * 两种接入方式：
 * - ws:   自建 WebSocket 信令（发送 join + sdp，接收 answer / candidate）
 * - whep: IETF RFC 9725 标准 HTTP 信令（POST SDP 换 answer），用于对接 MediaMTX 等标准网关
 */
export type SignalingMode = 'ws' | 'whep' | null;

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const WHEP_ICE_GATHERING_TIMEOUT_MS = 2000;
const WHEP_TRICKLE_CONTENT_TYPE = 'application/trickle-ice-sdpfrag';

export function parseSignalingMode(url: string): SignalingMode {
  if (!url.trim()) return null;
  try {
    const protocol = new URL(url.trim()).protocol;
    if (protocol === 'ws:' || protocol === 'wss:') return 'ws';
    if (protocol === 'http:' || protocol === 'https:') return 'whep';
    return null;
  } catch {
    return null;
  }
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, timeoutMs);
    function onChange() {
      if (pc.iceGatheringState === 'complete') done();
    }
    function done() {
      window.clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

export function useWebRTC(signalingUrl?: string, streamId = 'camera_front') {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** WHEP 会话资源地址，用于 trickle ICE (PATCH) 与断流 (DELETE) */
  const resourceRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<WebRTCState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const mode = parseSignalingMode(signalingUrl ?? '');

  /** best-effort trickle ICE：服务端不支持时静默降级，SDP 内已含完整 candidates */
  const patchCandidates = useCallback(async (fragments: string[]) => {
    const resource = resourceRef.current;
    if (!resource || fragments.length === 0) return;
    try {
      await fetch(resource, {
        method: 'PATCH',
        headers: { 'Content-Type': WHEP_TRICKLE_CONTENT_TYPE },
        body: `${fragments.join('\r\n')}\r\n`,
        signal: abortRef.current?.signal,
      });
    } catch {
      // 忽略：non-trickle 模式下 SDP 已携带候选，PATCH 失败不影响建连
    }
  }, []);

  const disconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const resource = resourceRef.current;
    resourceRef.current = null;
    if (resource) {
      void fetch(resource, { method: 'DELETE', keepalive: true }).catch(() => undefined);
    }

    wsRef.current?.close();
    wsRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;

    setState('idle');
    setLatencyMs(null);
    setError(null);
  }, []);

  const connectViaWebSocket = useCallback(
    (pc: RTCPeerConnection, url: string, offerSdp: string) =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'join', streamId: streamId.trim() || 'camera_front', sdp: offerSdp }));
          resolve();
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === 'answer' && msg.sdp) {
              void pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
            } else if (msg.type === 'candidate' && msg.candidate) {
              void pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
          } catch (err) {
            console.warn('[WebRTC] Failed to parse signaling message:', err);
          }
        };

        ws.onerror = () => reject(new Error(`无法连接到信令服务器：${url}`));

        ws.onclose = () => {
          const pcState = pcRef.current?.connectionState;
          if (pcState !== 'connected' && pcState !== 'connecting') {
            setState('failed');
            setError(`信令连接已关闭：${url}`);
          }
        };
      }),
    [streamId],
  );

  const connectViaWhep = useCallback(
    async (pc: RTCPeerConnection, url: string, controller: AbortController) => {
      await waitForIceGathering(pc, WHEP_ICE_GATHERING_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp ?? '',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`WHEP 端点返回 ${response.status} ${response.statusText}`);
      }

      const answerSdp = await response.text();
      const location = response.headers.get('location');
      resourceRef.current = location ? new URL(location, url).toString() : null;

      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    },
    [],
  );

  const connect = useCallback(async () => {
    disconnect();

    const url = signalingUrl?.trim() ?? '';
    const currentMode = parseSignalingMode(url);

    if (!currentMode) {
      setError('请输入有效的信令地址：ws(s):// 自建信令，或 http(s):// WHEP 端点');
      setState('failed');
      return;
    }

    setState('connecting');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
        }
        setState('connected');
        setError(null);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setState('connected');
          setError(null);
        } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          setState('failed');
          setError('WebRTC 连接失败或已关闭');
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          void patchCandidates(['a=end-of-candidates']);
          return;
        }
        const { candidate, sdpMid } = event.candidate;
        void patchCandidates([`a=mid:${sdpMid ?? '0'}`, `a=${candidate}`]);
      };

      pc.addTransceiver('video', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (currentMode === 'ws') {
        await connectViaWebSocket(pc, url, offer.sdp ?? '');
      } else {
        await connectViaWhep(pc, url, controller);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setState('failed');
      setError(message);
    }
  }, [signalingUrl, streamId, disconnect, connectViaWebSocket, connectViaWhep, patchCandidates]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { videoRef, state, error, connect, disconnect, latencyMs, mode };
}
