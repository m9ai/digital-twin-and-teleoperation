import { useEffect, useRef, useState, useCallback } from 'react';

export type WebRTCState = 'idle' | 'connecting' | 'connected' | 'failed';

function isValidSignalingUrl(url: string): boolean {
  if (!url.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return false;
  }
}

export function useWebRTC(signalingUrl?: string, streamId = 'camera_front') {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<WebRTCState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const disconnect = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setState('idle');
    setLatencyMs(null);
    setError(null);
  }, []);

  const connect = useCallback(async () => {
    disconnect();

    if (!signalingUrl || !isValidSignalingUrl(signalingUrl)) {
      setError('请输入有效的 WebSocket 信令地址（ws:// 或 wss://）');
      setState('failed');
      return;
    }

    setState('connecting');
    setError(null);

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (videoRef.current) {
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

      pc.addTransceiver('video', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const ws = new WebSocket(signalingUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', streamId, sdp: offer.sdp }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'answer' && msg.sdp) {
            pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
          } else if (msg.type === 'candidate' && msg.candidate) {
            pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          }
        } catch (err) {
          console.warn('[WebRTC] Failed to parse signaling message:', err);
        }
      };

      ws.onerror = () => {
        setState('failed');
        setError(`无法连接到信令服务器：${signalingUrl}`);
      };

      ws.onclose = () => {
        if (state !== 'connected') {
          setState('failed');
          setError(`信令连接已关闭：${signalingUrl}`);
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState('failed');
      setError(`初始化 WebRTC 失败：${message}`);
    }
  }, [signalingUrl, streamId, disconnect, state]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return { videoRef, state, error, connect, disconnect, latencyMs };
}
