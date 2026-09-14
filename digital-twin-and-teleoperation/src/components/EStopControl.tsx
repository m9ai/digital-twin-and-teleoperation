import { OctagonX, Power } from 'lucide-react';
import { useRobotStore } from '@/store/robotStore';
import { triggerEmergencyStop, releaseEmergencyStop } from '@/lib/emergencyStop';

/**
 * Emergency stop control.
 *
 * The trigger sits in the header so it is reachable from every view, and the
 * hotkey (Space) latches the same state. Once engaged a full-screen highlight
 * makes the machine state unmistakable, and release is an explicit action.
 */
export function EStopControl() {
  const eStop = useRobotStore((s) => s.eStop);

  return (
    <>
      <button
        onClick={() => (eStop ? releaseEmergencyStop() : triggerEmergencyStop('button'))}
        title={eStop ? '解除急停' : '触发急停（快捷键：Space）'}
        aria-pressed={eStop}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
          eStop
            ? 'bg-red-500 text-white ring-2 ring-red-300 hover:bg-red-400'
            : 'bg-red-600/15 text-red-400 ring-1 ring-red-500/60 hover:bg-red-600/30 hover:text-red-300'
        }`}
      >
        {eStop ? <Power className="h-4 w-4" /> : <OctagonX className="h-4 w-4" />}
        {eStop ? 'Release E-Stop' : 'E-Stop'}
        {!eStop && (
          <kbd className="rounded border border-red-500/40 px-1 text-[10px] font-normal text-red-300">
            Space
          </kbd>
        )}
      </button>

      {eStop && <EStopOverlay />}
    </>
  );
}

function EStopOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-start justify-center">
      {/* Full-screen highlight: a red vignette that never blocks the UI. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(220,38,38,0.28)_100%)]" />
      <div className="absolute inset-0 animate-pulse border-4 border-red-500/70" />

      <div className="pointer-events-auto mt-16 flex flex-col items-center gap-3 rounded-xl border-2 border-red-500 bg-slate-950/95 px-8 py-5 shadow-2xl">
        <div className="flex items-center gap-2 text-lg font-black uppercase tracking-widest text-red-400">
          <OctagonX className="h-6 w-6 animate-pulse" />
          Emergency Stop Engaged
        </div>
        <p className="text-xs text-slate-400">
          关节指令 / 速度指令已锁定，机器人保持使能但拒绝运动命令。
        </p>
        <button
          onClick={releaseEmergencyStop}
          className="btn bg-red-600 text-white hover:bg-red-500"
        >
          <Power className="h-4 w-4" />
          解除急停
        </button>
      </div>
    </div>
  );
}
