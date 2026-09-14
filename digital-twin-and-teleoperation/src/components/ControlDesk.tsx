import { useState, useCallback } from 'react';
import { Gamepad2, Power, ZapOff, Settings2, Cable } from 'lucide-react';
import { useConnectionStore } from '@/store/connectionStore';
import { useRobotStore } from '@/store/robotStore';
import { useGamepad } from '@/hooks/useGamepad';
import { rosClientRef } from '@/lib/rosRef';
import { releaseEmergencyStop, triggerEmergencyStop } from '@/lib/emergencyStop';
import type { Twist } from '@/types';

export function ControlDesk() {
  const { status, useSimulation, setUrl, setUseSimulation } = useConnectionStore();
  const { eStop, addLog } = useRobotStore();
  const [urlInput, setUrlInput] = useState(status.url);
  const axesRef = useGamepad();

  const handleUrlChange = () => {
    setUrl(urlInput);
    addLog(`Bridge URL updated to ${urlInput}`);
  };

  const sendZeroVelocity = useCallback(() => {
    const zero: Twist = {
      linear: { x: 0, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 0 },
    };
    try {
      rosClientRef.current?.publishTwist(zero);
      addLog('Zero velocity command published');
    } catch {
      // ignore
    }
  }, [addLog]);

  return (
    <div className="panel flex flex-col gap-4">
      <div className="panel-title">
        <Gamepad2 className="h-4 w-4" />
        <span>Control Desk</span>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm text-slate-300">数据源</span>
          <span className="text-[10px] text-slate-500">
            {useSimulation ? '内置 Mock 生成器 · 100 Hz' : 'rosbridge WebSocket'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setUseSimulation(true);
              addLog('切换到 Demo / Mock 模式（本地生成关节数据）');
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              useSimulation
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Demo / Mock
          </button>
          <button
            onClick={() => {
              setUseSimulation(false);
              addLog('切换到真实 ROS 2 节点');
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              !useSimulation
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            真实 ROS 2 节点
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Demo 模式无需任何 ROS 2 环境，自动按 URDF 限界生成连续关节运动，可直接用于演示与录屏。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Cable className="h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
          placeholder="ws://localhost:9090"
        />
        <button onClick={handleUrlChange} className="btn btn-secondary text-xs px-3 py-1.5">
          Set
        </button>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Gamepad Input</span>
          <span className="text-xs text-slate-500">Deadzone applied</span>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>Linear X</span>
              <span>{(-axesRef.current.y * 1.5).toFixed(2)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{
                  width: `${Math.min(Math.abs(-axesRef.current.y * 50), 50)}%`,
                  marginLeft: axesRef.current.y < 0 ? '50%' : `${50 - Math.min(Math.abs(-axesRef.current.y * 50), 50)}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>Angular Z</span>
              <span>{(-axesRef.current.x * 1.5).toFixed(2)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-pink-400 transition-all"
                style={{
                  width: `${Math.min(Math.abs(-axesRef.current.x * 50), 50)}%`,
                  marginLeft: axesRef.current.x < 0 ? '50%' : `${50 - Math.min(Math.abs(-axesRef.current.x * 50), 50)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => (eStop ? releaseEmergencyStop() : triggerEmergencyStop('button'))}
          className={`btn flex-1 ${eStop ? 'btn-primary' : 'btn-danger'}`}
          title="快捷键：Space"
        >
          {eStop ? <Power className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
          {eStop ? 'Release E-Stop' : 'Trigger E-Stop'}
        </button>
        <button onClick={sendZeroVelocity} className="btn btn-secondary flex-1">
          Zero Velocity
        </button>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-2">
        <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-400">
          <Settings2 className="h-3 w-3" />
          <span>System Log</span>
        </div>
        <div className="h-24 space-y-0.5 overflow-y-auto text-xs font-mono text-slate-500">
          <LogFeed />
        </div>
      </div>
    </div>
  );
}

function LogFeed() {
  const { logs } = useRobotStore();
  return (
    <>
      {logs.slice(0, 20).map((log, index) => (
        <div key={index} className="truncate">
          {log}
        </div>
      ))}
    </>
  );
}
