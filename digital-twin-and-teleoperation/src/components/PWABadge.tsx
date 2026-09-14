import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Download, X, WifiOff } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let updateTimer: number | undefined;

/**
 * Service-worker lifecycle UI: announces new builds instead of reloading
 * mid-session (a reload during teleoperation would drop control), offers
 * installation and confirms offline readiness.
 */
export function PWABadge() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (!registration || import.meta.env.DEV) return;
      if (updateTimer) window.clearInterval(updateTimer);
      updateTimer = window.setInterval(() => {
        void registration.update();
      }, 60 * 60 * 1000);
    },
  });

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      if (updateTimer) window.clearInterval(updateTimer);
    };
  }, []);

  // Offline readiness is informational only: let it fade out on its own.
  useEffect(() => {
    if (!offlineReady) return;
    const id = window.setTimeout(() => setOfflineReady(false), 6000);
    return () => window.clearTimeout(id);
  }, [offlineReady, setOfflineReady]);

  const triggerInstall = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }, [installEvent]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {offlineReady && !needRefresh && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-300 shadow-lg">
          <WifiOff className="h-4 w-4 text-emerald-400" />
          <span>应用外壳已缓存，可离线打开</span>
          <button
            type="button"
            onClick={() => setOfflineReady(false)}
            className="text-slate-500 hover:text-slate-300"
            aria-label="关闭提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {needRefresh && (
        <div className="pointer-events-auto w-72 rounded-lg border border-cyan-700/60 bg-slate-900/95 p-3 text-xs text-slate-200 shadow-lg">
          <p className="font-medium text-slate-100">有新版本可用</p>
          <p className="mt-1 text-slate-400">更新会重新加载页面，请确保当前未处于遥操作或录制过程。</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void updateServiceWorker(true)}
              className="flex items-center gap-1 rounded bg-cyan-600 px-2.5 py-1 font-medium text-white hover:bg-cyan-500"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              更新并重载
            </button>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:border-slate-500"
            >
              稍后
            </button>
          </div>
        </div>
      )}

      {installEvent && !needRefresh && (
        <button
          type="button"
          onClick={() => void triggerInstall()}
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-200 shadow-lg hover:border-cyan-600"
        >
          <Download className="h-4 w-4 text-cyan-400" />
          安装为桌面应用
        </button>
      )}
    </div>
  );
}
