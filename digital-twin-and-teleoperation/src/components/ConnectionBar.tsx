import { Wifi, WifiOff, Clock, AlertCircle } from 'lucide-react';
import { useConnectionStore } from '@/store/connectionStore';
import { useRobotStore } from '@/store/robotStore';

export function ConnectionBar() {
  const { status } = useConnectionStore();
  const { eStop } = useRobotStore();

  return (
    <div className="panel flex items-center justify-between py-2">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          {status.connected ? (
            <Wifi className="h-5 w-5 text-emerald-400" />
          ) : (
            <WifiOff className="h-5 w-5 text-rose-400" />
          )}
          <span className={`text-sm font-semibold ${status.connected ? 'text-emerald-400' : 'text-rose-400'}`}>
            {status.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock className="h-4 w-4" />
          <span>
            {status.latencyMs !== null ? `${status.latencyMs.toFixed(0)} ms` : '-- ms'}
          </span>
        </div>

        <div className="text-sm text-slate-400">{status.url}</div>
      </div>

      <div className="flex items-center gap-4">
        {status.error && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <AlertCircle className="h-4 w-4" />
            <span className="max-w-xs truncate">{status.error}</span>
          </div>
        )}
        {eStop ? (
          <span className="rounded bg-red-500/20 px-2 py-1 text-xs font-bold text-red-400 ring-1 ring-red-500/50">
            E-STOP ACTIVE
          </span>
        ) : (
          <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/30">
            READY
          </span>
        )}
      </div>
    </div>
  );
}
