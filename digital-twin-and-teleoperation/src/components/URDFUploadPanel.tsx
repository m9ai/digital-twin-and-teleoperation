import { useRef, useState, useCallback } from 'react';
import {
  Upload,
  FileText,
  RotateCcw,
  AlertCircle,
  Box,
  CheckCircle2,
  Package,
  X,
} from 'lucide-react';
import { useURDFStore } from '@/store/urdfStore';
import { parseURDFZip } from '@/lib/urdfZipParser';

export function URDFUploadPanel() {
  const urdfInputRef = useRef<HTMLInputElement>(null);
  const meshInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [dragTarget, setDragTarget] = useState<'urdf' | 'mesh' | 'zip' | null>(null);

  const {
    fileName,
    error,
    isLoading,
    meshFiles,
    resolvedMeshes,
    missingMeshes,
    unresolvedReplaced,
    setURDF,
    addMeshFiles,
    removeMeshFile,
    setError,
    setLoading,
    reset,
  } = useURDFStore();

  const readURDF = useCallback(
    async (file: File) => {
      const text = await file.text();
      if (!text.trim().startsWith('<?xml') && !text.trim().startsWith('<robot')) {
        throw new Error('文件内容不是有效的 URDF/XML');
      }
      setURDF(file.name, text);
    },
    [setURDF]
  );

  const handleURDFInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setLoading(true);
      setError(null);
      try {
        await readURDF(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : '读取 URDF 失败');
      } finally {
        setLoading(false);
        if (urdfInputRef.current) urdfInputRef.current.value = '';
      }
    },
    [readURDF, setError, setLoading]
  );

  const handleMeshInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        addMeshFiles(files);
      } finally {
        setLoading(false);
        if (meshInputRef.current) meshInputRef.current.value = '';
      }
    },
    [addMeshFiles, setError, setLoading]
  );

  const handleZipInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setLoading(true);
      setError(null);
      try {
        const { urdfText, urdfFileName, meshFiles: zipMeshes } = await parseURDFZip(file);
        setURDF(urdfFileName, urdfText, zipMeshes);
      } catch (err) {
        setError(err instanceof Error ? err.message : '解析压缩包失败');
      } finally {
        setLoading(false);
        if (zipInputRef.current) zipInputRef.current.value = '';
      }
    },
    [setURDF, setError, setLoading]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent, target: 'urdf' | 'mesh' | 'zip') => {
      e.preventDefault();
      setDragTarget(null);
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      setLoading(true);
      setError(null);

      try {
        if (target === 'urdf') {
          const urdf = files.find(
            (f) => f.name.toLowerCase().endsWith('.urdf') || f.name.toLowerCase().endsWith('.xacro')
          );
          if (!urdf) throw new Error('拖拽中未找到 .urdf / .xacro 文件');
          await readURDF(urdf);
          // Also treat any dropped STL files as mesh additions.
          const stls = files.filter((f) => {
            const lower = f.name.toLowerCase();
            return (
              lower.endsWith('.stl') ||
              lower.endsWith('.dae') ||
              lower.endsWith('.obj') ||
              lower.endsWith('.glb') ||
              lower.endsWith('.gltf')
            );
          });
          if (stls.length) addMeshFiles(stls);
        } else if (target === 'mesh') {
          const stls = files.filter((f) => {
            const lower = f.name.toLowerCase();
            return (
              lower.endsWith('.stl') ||
              lower.endsWith('.dae') ||
              lower.endsWith('.obj') ||
              lower.endsWith('.glb') ||
              lower.endsWith('.gltf')
            );
          });
          if (stls.length === 0) throw new Error('拖拽中未找到 STL/DAE/OBJ 文件');
          addMeshFiles(stls);
        } else if (target === 'zip') {
          const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
          if (!zip) throw new Error('拖拽中未找到 .zip 文件');
          const { urdfText, urdfFileName, meshFiles: zipMeshes } = await parseURDFZip(zip);
          setURDF(urdfFileName, urdfText, zipMeshes);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '处理失败');
      } finally {
        setLoading(false);
      }
    },
    [readURDF, addMeshFiles, setURDF, setError, setLoading]
  );

  const dropClass = (target: 'urdf' | 'mesh' | 'zip') =>
    `flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-3 transition-colors ${
      dragTarget === target
        ? 'border-cyan-500 bg-cyan-500/10'
        : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'
    }`;

  return (
    <div className="panel flex flex-col gap-3">
      <div className="panel-title">
        <FileText className="h-4 w-4" />
        <span>URDF 模型</span>
      </div>

      {/* URDF upload */}
      <div
        onClick={() => urdfInputRef.current?.click()}
        onDrop={(e) => onDrop(e, 'urdf')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragTarget('urdf');
        }}
        onDragLeave={() => setDragTarget(null)}
        className={dropClass('urdf')}
      >
        <Upload className={`h-5 w-5 ${dragTarget === 'urdf' ? 'text-cyan-400' : 'text-slate-500'}`} />
        <div className="text-center text-xs text-slate-400">
          <span className="font-medium text-cyan-400">上传 URDF</span>
        </div>
        <div className="text-[10px] text-slate-600">.urdf / .xacro</div>
        <input
          ref={urdfInputRef}
          type="file"
          accept=".urdf,.xacro"
          onChange={handleURDFInput}
          className="hidden"
        />
      </div>

      {/* Mesh upload */}
      <div
        onClick={() => meshInputRef.current?.click()}
        onDrop={(e) => onDrop(e, 'mesh')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragTarget('mesh');
        }}
        onDragLeave={() => setDragTarget(null)}
        className={dropClass('mesh')}
      >
        <Box className={`h-5 w-5 ${dragTarget === 'mesh' ? 'text-cyan-400' : 'text-slate-500'}`} />
        <div className="text-center text-xs text-slate-400">
          <span className="font-medium text-cyan-400">上传 Mesh 资源</span>
        </div>
        <div className="text-[10px] text-slate-600">STL / DAE / OBJ，可多次追加</div>
        <input
          ref={meshInputRef}
          type="file"
          accept=".stl,.dae,.obj,.glb,.gltf"
          multiple
          onChange={handleMeshInput}
          className="hidden"
        />
      </div>

      {/* ZIP upload */}
      <div
        onClick={() => zipInputRef.current?.click()}
        onDrop={(e) => onDrop(e, 'zip')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragTarget('zip');
        }}
        onDragLeave={() => setDragTarget(null)}
        className={dropClass('zip')}
      >
        <Package
          className={`h-5 w-5 ${dragTarget === 'zip' ? 'text-cyan-400' : 'text-slate-500'}`}
        />
        <div className="text-center text-xs text-slate-400">
          <span className="font-medium text-cyan-400">上传 ZIP 包</span>
        </div>
        <div className="text-[10px] text-slate-600">包含 URDF + meshes 的压缩包</div>
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          onChange={handleZipInput}
          className="hidden"
        />
      </div>

      {fileName && (
        <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 truncate text-slate-300">
            <FileText className="h-3.5 w-3.5 text-cyan-400" />
            <span className="truncate">{fileName}</span>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-1 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
            title="恢复默认 URDF"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      )}

      {meshFiles.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-lg bg-slate-800/40 px-3 py-2 text-xs">
          <div className="mb-1 text-slate-500">已加载 mesh：</div>
          <ul className="flex flex-col gap-1">
            {meshFiles.map((f) => (
              <li key={f.name} className="flex items-center justify-between gap-2 text-slate-300">
                <span className="truncate">{f.name}</span>
                <button
                  onClick={() => removeMeshFile(f.name)}
                  className="shrink-0 text-slate-500 hover:text-red-400"
                  title="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
          正在解析 URDF 与匹配 mesh...
        </div>
      )}

      {resolvedMeshes.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400 ring-1 ring-emerald-500/30">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            已加载 {resolvedMeshes.length} 个真实 mesh
            {missingMeshes.length > 0 && `，缺失 ${missingMeshes.length} 个`}
          </span>
        </div>
      )}

      {missingMeshes.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400 ring-1 ring-amber-500/30">
          <div className="flex items-center gap-2">
            <Box className="h-3.5 w-3.5 shrink-0" />
            <span>缺失 {missingMeshes.length} 个 mesh，已用占位立方体替代：</span>
          </div>
          <ul className="ml-5 list-disc text-[10px] leading-4">
            {missingMeshes.slice(0, 6).map((m) => (
              <li key={m.raw}>{m.basename}</li>
            ))}
            {missingMeshes.length > 6 && <li>…等共 {missingMeshes.length} 个</li>}
          </ul>
        </div>
      )}

      {unresolvedReplaced === 0 && resolvedMeshes.length === 0 && fileName && !isLoading && (
        <div className="flex items-start gap-2 rounded-lg bg-slate-700/30 px-3 py-2 text-xs text-slate-400 ring-1 ring-slate-600">
          <Box className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>当前 URDF 不含外部 mesh 引用。</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/30">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
