import { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Factory,
  Home,
  Layers,
  Moon,
  RotateCcw,
  Sun,
  Trees,
  Warehouse,
} from 'lucide-react';
import { useSceneStore } from '@/store/sceneStore';
import { ENVIRONMENT_PRESETS } from '@/lib/scene/environmentPresets';
import type { EnvironmentPresetId, SceneBackgroundId } from '@/types';

const PRESET_ICONS: Record<EnvironmentPresetId, typeof Boxes> = {
  none: Boxes,
  workshop: Factory,
  room: Home,
  street: Trees,
  lab: Warehouse,
};

const BACKDROPS: Array<{ id: SceneBackgroundId; label: string; swatch: string }> = [
  { id: 'studio', label: 'Studio', swatch: 'linear-gradient(180deg,#1e293b,#020617)' },
  { id: 'daylight', label: 'Daylight', swatch: 'linear-gradient(180deg,#bfdbfe,#94a3b8)' },
  { id: 'night', label: 'Night', swatch: 'linear-gradient(180deg,#111827,#000000)' },
  { id: 'transparent', label: '透明', swatch: 'linear-gradient(180deg,#334155,#0f172a)' },
];

/**
 * Compact scene switcher floating over the twin.
 *
 * Full scene authoring lives in the `ScenePanel` on the right rail, but the two
 * most common actions — pick an environment and toggle the helpers — belong in
 * the viewport where the result is visible.
 */
export function SceneQuickSettings() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const preset = useSceneStore((s) => s.preset);
  const background = useSceneStore((s) => s.background);
  const gridVisible = useSceneStore((s) => s.gridVisible);
  const axesVisible = useSceneStore((s) => s.axesVisible);
  const shadows = useSceneStore((s) => s.lighting.shadows);
  const setPreset = useSceneStore((s) => s.setPreset);
  const setBackground = useSceneStore((s) => s.setBackground);
  const setGridVisible = useSceneStore((s) => s.setGridVisible);
  const setAxesVisible = useSceneStore((s) => s.setAxesVisible);
  const patchLighting = useSceneStore((s) => s.patchLighting);
  const reset = useSceneStore((s) => s.reset);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const activePreset = ENVIRONMENT_PRESETS.find((item) => item.id === preset);

  return (
    <div ref={wrapperRef} className="absolute right-2 bottom-2 z-20">
      {open && (
        <div className="mb-2 w-60 rounded-lg bg-slate-900/95 p-2.5 ring-1 ring-slate-700 backdrop-blur">
          <p className="px-0.5 pb-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            场景环境
          </p>
          <div className="grid grid-cols-1 gap-1">
            {ENVIRONMENT_PRESETS.map((item) => {
              const Icon = PRESET_ICONS[item.id];
              const active = item.id === preset;
              return (
                <button
                  key={item.id}
                  onClick={() => setPreset(item.id)}
                  title={item.hint}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors ${
                    active
                      ? 'bg-cyan-600/25 text-cyan-200 ring-1 ring-cyan-500/40'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium">{item.label}</span>
                  <span className="ml-auto truncate text-[9px] text-slate-500">{item.hint}</span>
                </button>
              );
            })}
          </div>

          <p className="px-0.5 pb-1.5 pt-2.5 text-[10px] uppercase tracking-wider text-slate-500">
            背景
          </p>
          <div className="grid grid-cols-4 gap-1">
            {BACKDROPS.map((item) => (
              <button
                key={item.id}
                onClick={() => setBackground(item.id)}
                title={item.label}
                className={`h-6 rounded ring-1 transition-all ${
                  background === item.id ? 'ring-cyan-400' : 'ring-slate-700 hover:ring-slate-500'
                }`}
                style={{ background: item.swatch }}
              />
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1">
            <ToggleChip active={gridVisible} onClick={() => setGridVisible(!gridVisible)} label="网格" />
            <ToggleChip active={axesVisible} onClick={() => setAxesVisible(!axesVisible)} label="坐标轴" />
            <ToggleChip
              active={shadows}
              onClick={() => patchLighting({ shadows: !shadows })}
              label="阴影"
            />
            <button
              onClick={reset}
              title="恢复默认环境设置"
              className="ml-auto flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
            >
              <RotateCcw className="h-3 w-3" />
              重置
            </button>
          </div>

          {activePreset && (
            <p className="mt-2 border-t border-slate-800 pt-2 text-[9px] leading-relaxed text-slate-500">
              当前：{activePreset.label}。更多参数在右侧「场景 Scene」面板（可上传 glTF/GLB 场景）。
            </p>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((value) => !value)}
        title="切换机器人所在的工作场景"
        className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
          open
            ? 'bg-cyan-600/30 text-cyan-200 ring-1 ring-cyan-500/50'
            : 'bg-slate-900/85 text-slate-300 ring-1 ring-slate-700 hover:bg-slate-800 backdrop-blur'
        }`}
      >
        {background === 'daylight' ? (
          <Sun className="h-3.5 w-3.5" />
        ) : (
          <Moon className="h-3.5 w-3.5" />
        )}
        <Layers className="h-3.5 w-3.5" />
        {activePreset?.label ?? '场景'}
      </button>
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 text-[10px] transition-colors ${
        active
          ? 'bg-cyan-600/25 text-cyan-200 ring-1 ring-cyan-500/40'
          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

export default SceneQuickSettings;
