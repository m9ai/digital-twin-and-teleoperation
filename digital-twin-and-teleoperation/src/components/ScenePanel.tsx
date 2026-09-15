import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  Eye,
  EyeOff,
  Factory,
  Home,
  Layers,
  RotateCcw,
  ShieldAlert,
  Sun,
  Trash2,
  Trees,
  Upload,
  Warehouse,
} from 'lucide-react';
import { SCENE_ACCEPT, isSceneFile, useSceneStore } from '@/store/sceneStore';
import { ENVIRONMENT_PRESETS } from '@/lib/scene/environmentPresets';
import type { CustomScene, EnvironmentPresetId, SceneBackgroundId } from '@/types';

const PRESET_ICONS: Record<EnvironmentPresetId, typeof Boxes> = {
  none: Boxes,
  workshop: Factory,
  room: Home,
  street: Trees,
  lab: Warehouse,
};

const BACKDROPS: Array<{ id: SceneBackgroundId; label: string; swatch: string }> = [
  { id: 'studio', label: '影棚', swatch: 'linear-gradient(180deg,#1e293b,#020617)' },
  { id: 'daylight', label: '日光', swatch: 'linear-gradient(180deg,#bfdbfe,#94a3b8)' },
  { id: 'night', label: '夜间', swatch: 'linear-gradient(180deg,#111827,#000000)' },
  { id: 'transparent', label: '透明', swatch: 'linear-gradient(180deg,#334155,#0f172a)' },
];

/**
 * Scene authoring panel.
 *
 * A twin is only meaningful in context: the same arm reads very differently on
 * a shop floor than alone on a grid. This panel owns everything around the
 * robot — environment preset, lighting rig, reference helpers, uploaded scene
 * models and whether those props take part in the safety scan.
 */
export function ScenePanel() {
  const store = useSceneStore();
  const {
    preset,
    gridVisible,
    gridSize,
    gridDivisions,
    axesVisible,
    background,
    lighting,
    safety,
    scenes,
    setPreset,
    setGridVisible,
    setGrid,
    setAxesVisible,
    setBackground,
    patchLighting,
    patchSafety,
    addSceneFiles,
    updateScene,
    patchSceneTransform,
    removeScene,
    clearScenes,
    reset,
  } = store;

  const [dragOver, setDragOver] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const files = Array.from(fileList).filter(isSceneFile);
      if (files.length > 0) addSceneFiles(files);
    },
    [addSceneFiles]
  );

  const readyScenes = useMemo(() => scenes.filter((scene) => scene.status === 'ready'), [scenes]);

  return (
    <div className="panel">
      <div className="panel-title justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          <span>场景 Scene</span>
        </div>
        <button
          onClick={reset}
          title="重置环境并清除上传的场景"
          className="flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
        >
          <RotateCcw className="h-3 w-3" />
          重置
        </button>
      </div>

      {/* ---- built-in environments ------------------------------------ */}
      <p className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">工作环境</p>
      <div className="grid grid-cols-2 gap-1.5">
        {ENVIRONMENT_PRESETS.map((item) => {
          const Icon = PRESET_ICONS[item.id];
          const active = item.id === preset;
          return (
            <button
              key={item.id}
              onClick={() => setPreset(item.id)}
              title={item.hint}
              className={`flex flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-left transition-colors ${
                active
                  ? 'bg-cyan-600/20 text-cyan-200 ring-1 ring-cyan-500/40'
                  : 'bg-slate-800/60 text-slate-300 ring-1 ring-slate-700 hover:bg-slate-700/70'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="text-[11px] font-medium leading-none">{item.label}</span>
              <span className="text-[9px] leading-tight text-slate-500">{item.hint}</span>
            </button>
          );
        })}
      </div>

      {/* ---- custom scene upload ------------------------------------- */}
      <p className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-slate-500">
        自定义场景模型
      </p>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          acceptFiles(event.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-3 text-center transition-colors ${
          dragOver
            ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300'
            : 'border-slate-700 bg-slate-800/40 text-slate-400 hover:border-slate-500 hover:text-slate-300'
        }`}
      >
        <Upload className="h-4 w-4" />
        <span className="text-[11px]">拖入或点击上传 .glb / .gltf 场景</span>
        <span className="text-[9px] text-slate-500">自动归零到地面并按米单位归一化</span>
        <input
          ref={inputRef}
          type="file"
          accept={SCENE_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            acceptFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {scenes.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {scenes.map((scene) => (
            <SceneRow
              key={scene.id}
              scene={scene}
              expanded={expandedId === scene.id}
              onToggle={() => setExpandedId(expandedId === scene.id ? null : scene.id)}
              onUpdate={(patch) => updateScene(scene.id, patch)}
              onTransform={(patch) => patchSceneTransform(scene.id, patch)}
              onRemove={() => removeScene(scene.id)}
            />
          ))}
          <div className="flex items-center justify-between pt-1 text-[10px] text-slate-500">
            <span>
              {readyScenes.length}/{scenes.length} 个场景已就绪
            </span>
            <button
              onClick={clearScenes}
              className="flex items-center gap-1 text-slate-400 transition-colors hover:text-red-300"
            >
              <Trash2 className="h-3 w-3" />
              清空
            </button>
          </div>
        </div>
      )}

      {/* ---- helpers ------------------------------------------------- */}
      <p className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-slate-500">参考与画面</p>
      <div className="mb-2 flex flex-wrap gap-1">
        <ToggleChip active={gridVisible} onClick={() => setGridVisible(!gridVisible)} label="地面网格" />
        <ToggleChip active={axesVisible} onClick={() => setAxesVisible(!axesVisible)} label="坐标轴" />
        <ToggleChip
          active={lighting.shadows}
          onClick={() => patchLighting({ shadows: !lighting.shadows })}
          label="投影阴影"
        />
        <ToggleChip
          active={lighting.envMap}
          onClick={() => patchLighting({ envMap: !lighting.envMap })}
          label="环境反射"
        />
      </div>

      <div className="mb-2 grid grid-cols-4 gap-1">
        {BACKDROPS.map((item) => (
          <button
            key={item.id}
            onClick={() => setBackground(item.id)}
            title={`背景：${item.label}`}
            className={`h-6 rounded ring-1 transition-all ${
              background === item.id ? 'ring-cyan-400' : 'ring-slate-700 hover:ring-slate-500'
            }`}
            style={{ background: item.swatch }}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SliderField
          label="网格边长"
          value={gridSize}
          min={4}
          max={40}
          step={1}
          unit="m"
          onChange={(value) => setGrid(value, gridDivisions)}
          disabled={!gridVisible}
        />
        <SliderField
          label="网格密度"
          value={gridDivisions}
          min={10}
          max={80}
          step={5}
          onChange={(value) => setGrid(gridSize, value)}
          disabled={!gridVisible}
        />
      </div>

      {/* ---- lighting ------------------------------------------------ */}
      <p className="mb-1.5 mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        <Sun className="h-3 w-3" />
        光照
      </p>
      <div className="grid grid-cols-2 gap-2">
        <SliderField
          label="光源方位"
          value={lighting.azimuthDeg}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={(value) => patchLighting({ azimuthDeg: value })}
        />
        <SliderField
          label="光源仰角"
          value={lighting.elevationDeg}
          min={5}
          max={85}
          step={1}
          unit="°"
          onChange={(value) => patchLighting({ elevationDeg: value })}
        />
        <SliderField
          label="主光强度"
          value={lighting.intensity}
          min={0}
          max={4}
          step={0.05}
          onChange={(value) => patchLighting({ intensity: value })}
        />
        <SliderField
          label="环境光"
          value={lighting.ambient}
          min={0}
          max={1.5}
          step={0.05}
          onChange={(value) => patchLighting({ ambient: value })}
        />
        <SliderField
          label="环境反射强度"
          value={lighting.envIntensity}
          min={0}
          max={2}
          step={0.05}
          onChange={(value) => patchLighting({ envIntensity: value })}
          disabled={!lighting.envMap}
        />
        <SliderField
          label="曝光"
          value={lighting.exposure}
          min={0.3}
          max={2}
          step={0.05}
          onChange={(value) => patchLighting({ exposure: value })}
        />
      </div>

      {/* ---- safety -------------------------------------------------- */}
      <p className="mb-1.5 mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
        <ShieldAlert className="h-3 w-3" />
        安全
      </p>
      <ToggleChip
        active={safety.obstacleCheck}
        onClick={() => patchSafety({ obstacleCheck: !safety.obstacleCheck })}
        label={
          safety.obstacleCheck
            ? '场景参与接近检测：开'
            : '场景参与接近检测：关'
        }
      />
      <div className="mt-2">
        <SliderField
          label="障碍报警间距"
          value={safety.warnDistance}
          min={0.005}
          max={0.15}
          step={0.005}
          unit="m"
          decimals={3}
          onChange={(value) => patchSafety({ warnDistance: value })}
          disabled={!safety.obstacleCheck}
        />
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
        球体包围盒近似，8 Hz 扫描。地面本身不计入障碍，仅检测墙体、围栏、工作台等实体道具。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Row / primitive widgets
 * ------------------------------------------------------------------ */

function SceneRow({
  scene,
  expanded,
  onToggle,
  onUpdate,
  onTransform,
  onRemove,
}: {
  scene: CustomScene;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<CustomScene>) => void;
  onTransform: (patch: Partial<CustomScene['transform']>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          onClick={() => onUpdate({ visible: !scene.visible })}
          title={scene.visible ? '隐藏该场景' : '显示该场景'}
          className="text-slate-400 transition-colors hover:text-cyan-300"
          disabled={scene.status !== 'ready'}
        >
          {scene.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>

        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span
            className={`truncate text-[11px] ${
              scene.status === 'error' ? 'text-red-300' : 'text-slate-200'
            }`}
          >
            {scene.name}
          </span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-slate-500 transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>

        <button
          onClick={onRemove}
          title="移除场景"
          className="text-slate-500 transition-colors hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {scene.status === 'loading' && (
        <div className="px-2.5 pb-2 text-[9px] text-slate-500">正在解析模型…</div>
      )}
      {scene.status === 'error' && (
        <div className="px-2.5 pb-2 text-[9px] text-red-300">{scene.error}</div>
      )}

      {scene.stats && (
        <div className="px-2.5 pb-1.5 text-[9px] text-slate-500">
          {scene.stats.meshes} mesh · {scene.stats.triangles.toLocaleString()} 三角面 ·{' '}
          {scene.stats.size.map((v) => `${v.toFixed(1)}m`).join(' × ')}
        </div>
      )}

      {expanded && scene.status === 'ready' && (
        <div className="space-y-2 border-t border-slate-700 px-2.5 pb-2.5 pt-2">
          <div className="grid grid-cols-3 gap-1.5">
            <SliderField
              label="X"
              value={scene.transform.x}
              min={-30}
              max={30}
              step={0.1}
              unit="m"
              onChange={(value) => onTransform({ x: value })}
            />
            <SliderField
              label="Y"
              value={scene.transform.y}
              min={-5}
              max={10}
              step={0.1}
              unit="m"
              onChange={(value) => onTransform({ y: value })}
            />
            <SliderField
              label="Z"
              value={scene.transform.z}
              min={-30}
              max={30}
              step={0.1}
              unit="m"
              onChange={(value) => onTransform({ z: value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <SliderField
              label="绕 Y 旋转"
              value={scene.transform.rotationY}
              min={-180}
              max={180}
              step={1}
              unit="°"
              onChange={(value) => onTransform({ rotationY: value })}
            />
            <SliderField
              label="缩放"
              value={scene.transform.scale}
              min={0.05}
              max={10}
              step={0.05}
              unit="×"
              onChange={(value) => onTransform({ scale: value })}
            />
          </div>
          <SliderField
            label="自动归一化目标边长"
            value={scene.targetSize}
            min={1}
            max={60}
            step={1}
            unit="m"
            onChange={(value) => onUpdate({ targetSize: value })}
            disabled={!scene.autoFit}
          />
          <div className="flex flex-wrap gap-1">
            <ToggleChip
              active={scene.autoFit}
              onClick={() => onUpdate({ autoFit: !scene.autoFit })}
              label="单位归一化"
            />
            <ToggleChip
              active={scene.zUp}
              onClick={() => onUpdate({ zUp: !scene.zUp })}
              label="Z-up 源文件"
            />
          </div>
        </div>
      )}
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

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  decimals = 2,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`block ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-center justify-between text-[9px] text-slate-500">
        <span>{label}</span>
        <span className="tabular-nums text-slate-400">
          {value.toFixed(decimals)}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-0.5 h-1 w-full cursor-pointer appearance-none rounded bg-slate-700 accent-cyan-400 disabled:cursor-not-allowed"
      />
    </label>
  );
}

export default ScenePanel;
