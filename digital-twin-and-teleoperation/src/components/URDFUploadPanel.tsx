import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileCode2,
  FileText,
  FolderOpen,
  FolderTree,
  RotateCcw,
  UploadCloud,
  X,
} from 'lucide-react';
import { useURDFStore } from '@/store/urdfStore';
import { parseURDFZip } from '@/lib/urdfZipParser';
import { URDFEditor } from '@/components/URDFEditor';
import {
  filesFromDataTransfer,
  filesFromFileList,
  getModelPath,
  inferRootName,
  isMeshFile,
  isURDFFile,
  isXacroFile,
  isZipFile,
} from '@/lib/directoryReader';
import type { ModelSource } from '@/store/urdfStore';

/**
 * Directory upload attributes.
 *
 * `webkitdirectory` is the only cross-vendor way to pick a whole folder and is
 * not part of the standard `InputHTMLAttributes` typings, hence the cast.
 */
const DIRECTORY_INPUT_PROPS = {
  webkitdirectory: '',
} as unknown as React.InputHTMLAttributes<HTMLInputElement>;

const FILE_ACCEPT = '.urdf,.xacro,.zip,.stl,.dae,.obj,.glb,.gltf';

type FileKind = 'urdf' | 'xacro' | 'mesh' | 'other';

function kindOf(file: File): FileKind {
  if (isXacroFile(file.name)) return 'xacro';
  if (isURDFFile(file.name)) return 'urdf';
  if (isMeshFile(file.name)) return 'mesh';
  return 'other';
}

interface FileLeaf {
  name: string;
  path: string;
  kind: FileKind;
}

interface DirectoryNode {
  name: string;
  path: string;
  dirs: DirectoryNode[];
  files: FileLeaf[];
}

/** Nest the files of one source by their relative path so the tree mirrors disk. */
function buildFileTree(files: File[]): DirectoryNode {
  const root: DirectoryNode = { name: '', path: '', dirs: [], files: [] };

  for (const file of files) {
    const segments = getModelPath(file).split('/');
    const fileName = segments.pop() ?? file.name;

    let cursor = root;
    for (const segment of segments) {
      let dir = cursor.dirs.find((candidate) => candidate.name === segment);
      if (!dir) {
        dir = {
          name: segment,
          path: cursor.path ? `${cursor.path}/${segment}` : segment,
          dirs: [],
          files: [],
        };
        cursor.dirs.push(dir);
      }
      cursor = dir;
    }

    cursor.files.push({
      name: fileName,
      path: [...segments, fileName].join('/'),
      kind: kindOf(file),
    });
  }

  return root;
}

function countFiles(node: DirectoryNode): number {
  return node.files.length + node.dirs.reduce((total, dir) => total + countFiles(dir), 0);
}

function FileLeafRow({
  leaf,
  depth,
  isEntry,
  sourceId,
  onRemove,
  onSelect,
}: {
  leaf: FileLeaf;
  depth: number;
  isEntry: boolean;
  sourceId: string;
  onRemove: (sourceId: string, path: string) => void;
  onSelect: (sourceId: string, path: string) => void;
}) {
  const Icon = leaf.kind === 'mesh' ? Box : leaf.kind === 'other' ? FileCode2 : FileText;
  const selectable = !isEntry && (leaf.kind === 'urdf' || leaf.kind === 'xacro');

  return (
    <div
      className={`group flex items-center gap-1.5 rounded py-0.5 pr-1 ${
        isEntry ? 'text-cyan-300' : 'text-slate-400'
      } hover:bg-slate-700/50`}
      style={{ paddingLeft: depth * 12 + 6 }}
    >
      <Icon className={`h-3 w-3 shrink-0 ${isEntry ? 'text-cyan-400' : 'text-slate-500'}`} />
      <span className="truncate" title={leaf.path}>
        {leaf.name}
      </span>
      {isEntry && (
        <span className="shrink-0 rounded bg-cyan-500/15 px-1 py-px text-[10px] text-cyan-300 ring-1 ring-cyan-500/30">
          入口
        </span>
      )}
      {selectable && (
        <button
          onClick={() => onSelect(sourceId, leaf.path)}
          className="shrink-0 text-[10px] text-slate-600 opacity-0 transition-opacity hover:text-cyan-300 group-hover:opacity-100"
          title="将该模型渲染到数字孪生"
        >
          设为当前
        </button>
      )}
      <button
        onClick={() => onRemove(sourceId, leaf.path)}
        className="ml-auto shrink-0 text-slate-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        title="移除"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function DirectoryRow({
  node,
  depth,
  sourceId,
  entryPath,
  onRemove,
  onSelect,
}: {
  node: DirectoryNode;
  depth: number;
  sourceId: string;
  entryPath: string | null;
  onRemove: (sourceId: string, path: string) => void;
  onSelect: (sourceId: string, path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-slate-300 hover:bg-slate-700/50"
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
        )}
        <FolderTree className="h-3 w-3 shrink-0 text-slate-500" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 text-[10px] text-slate-600">{countFiles(node)}</span>
      </button>

      {open && (
        <>
          {node.dirs.map((dir) => (
            <DirectoryRow
              key={dir.path}
              node={dir}
              depth={depth + 1}
              sourceId={sourceId}
              entryPath={entryPath}
              onRemove={onRemove}
              onSelect={onSelect}
            />
          ))}
          {node.files.map((leaf) => (
            <FileLeafRow
              key={leaf.path}
              leaf={leaf}
              depth={depth + 1}
              isEntry={leaf.path === entryPath}
              sourceId={sourceId}
              onRemove={onRemove}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * One imported folder, rendered as the tree the user picked on disk.
 *
 * Every source keeps its own entry URDF so that the panel can already switch
 * between robots — the scene will follow once the twin renders more than one.
 */
function SourceRow({
  source,
  active,
  onRemoveSource,
  onRemoveFile,
  onSelectEntry,
}: {
  source: ModelSource;
  active: boolean;
  onRemoveSource: (sourceId: string) => void;
  onRemoveFile: (sourceId: string, path: string) => void;
  onSelectEntry: (sourceId: string, path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const tree = useMemo(() => buildFileTree(source.files), [source.files]);

  return (
    <div className="mb-0.5">
      <div className="group flex items-center gap-1.5 rounded py-0.5 pr-1 text-slate-200 hover:bg-slate-700/50">
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />
          )}
          <FolderOpen className={`h-3 w-3 shrink-0 ${active ? 'text-cyan-400' : 'text-slate-500'}`} />
          <span className="truncate" title={source.name}>
            {source.name}
          </span>
          <span className="shrink-0 text-[10px] text-slate-600">{source.files.length}</span>
        </button>

        {active ? (
          <span className="shrink-0 rounded bg-cyan-500/15 px-1 py-px text-[10px] text-cyan-300 ring-1 ring-cyan-500/30">
            渲染中
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-slate-600">未渲染</span>
        )}

        <button
          onClick={() => onRemoveSource(source.id)}
          className="shrink-0 text-slate-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
          title="移除整个文件夹"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {open && (
        <>
          {tree.dirs.map((dir) => (
            <DirectoryRow
              key={dir.path}
              node={dir}
              depth={1}
              sourceId={source.id}
              entryPath={source.entryPath}
              onRemove={onRemoveFile}
              onSelect={onSelectEntry}
            />
          ))}
          {tree.files.map((leaf) => (
            <FileLeafRow
              key={leaf.path}
              leaf={leaf}
              depth={1}
              isEntry={leaf.path === source.entryPath}
              sourceId={source.id}
              onRemove={onRemoveFile}
              onSelect={onSelectEntry}
            />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Model source panel.
 *
 * A robot model arrives either as a folder (URDF + mesh sub-directories, the
 * ROS package layout) or as a packaged archive. Both are handled by a single
 * drop target plus two buttons — "load files" and "load folder" — instead of
 * one picker per file kind.
 */
export function URDFUploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'upload' | 'edit'>('upload');
  const [isDragOver, setIsDragOver] = useState(false);

  const {
    fileName,
    error,
    isLoading,
    sources,
    activeSourceId,
    resolvedMeshes,
    missingMeshes,
    unresolvedReplaced,
    xacroExpanded,
    xacroWarnings,
    loadModelFiles,
    addModelSource,
    setActiveModelFile,
    removeModelSource,
    removeModelFile,
    setError,
    setLoading,
    reset,
  } = useURDFStore();

  const activeSource = sources.find((source) => source.id === activeSourceId);

  /**
   * Single entry point for every load path (drop, file picker, folder picker).
   *
   * The selection is registered as one model source so the panel shows the
   * folder the user actually picked; the entry URDF inside it is what gets
   * rendered.
   */
  const loadFiles = useCallback(
    async (incoming: File[]) => {
      if (incoming.length === 0) return;

      setLoading(true);
      setError(null);

      try {
        const archive = incoming.find((file) => isZipFile(file.name));
        if (archive) {
          // An archive is already a folder, just compressed: unpack it into the
          // same source shape so both paths look identical downstream.
          const { files, entryPath, urdfText, xacroSources } = await parseURDFZip(archive);
          const name = inferRootName(files) ?? archive.name.replace(/\.zip$/i, '');
          addModelSource(name, files, {
            entryPath,
            entryText: urdfText,
            xacroSources,
          });
          return;
        }

        await loadModelFiles(incoming);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载模型失败');
      } finally {
        setLoading(false);
      }
    },
    [addModelSource, loadModelFiles, setError, setLoading]
  );

  const handleInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = filesFromFileList(input.files);
      input.value = '';
      await loadFiles(files);
    },
    [loadFiles]
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      const pending = filesFromDataTransfer(event.dataTransfer);
      await loadFiles(await pending);
    },
    [loadFiles]
  );

  return (
    <div className="panel flex flex-col gap-3">
      <div className="panel-title justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span>URDF 模型</span>
        </div>
        <div className="flex rounded-md bg-slate-800 p-0.5">
          <button
            onClick={() => setMode('upload')}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              mode === 'upload' ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UploadCloud className="h-3 w-3" />
            上传
          </button>
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              mode === 'edit' ? 'bg-slate-600 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Edit3 className="h-3 w-3" />
            编辑
          </button>
        </div>
      </div>

      {mode === 'edit' && <URDFEditor />}

      {mode === 'upload' && (
        <>
          {/* Single drop target for files and folders alike. */}
          <div
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setIsDragOver(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsDragOver(false);
              }
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              isDragOver ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700 bg-slate-800/40'
            }`}
          >
            <UploadCloud
              className={`h-7 w-7 transition-colors ${isDragOver ? 'text-cyan-400' : 'text-slate-600'}`}
            />
            <div className="text-xs text-slate-400">
              将机器人模型文件夹或文件拖拽至此处
              <div className="text-[10px] text-slate-500">或点击下方按钮选择加载</div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-600"
              >
                <FileText className="h-3.5 w-3.5" />
                加载文件
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                加载文件夹
              </button>
            </div>

            <div className="text-[10px] leading-4 text-slate-600">
              支持 .urdf / .xacro / .zip 及 .stl .dae .obj .glb .gltf 网格 · 可多次加载不同文件夹
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              onChange={handleInputChange}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              onChange={handleInputChange}
              className="hidden"
              {...DIRECTORY_INPUT_PROPS}
            />
          </div>

          {fileName && (
            <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2 truncate text-slate-300">
                <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                {activeSource && (
                  <span
                    className="shrink-0 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400"
                    title={activeSource.name}
                  >
                    {activeSource.name}
                  </span>
                )}
                <span className="truncate" title={activeSource?.entryPath ?? fileName}>
                  {fileName}
                </span>
                {xacroExpanded && (
                  <span
                    className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] text-violet-300 ring-1 ring-violet-500/30"
                    title="XACRO 宏已在浏览器中展开为纯 URDF"
                  >
                    XACRO 已展开
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  reset();
                  setMode('upload');
                }}
                className="flex items-center gap-1 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
                title="恢复默认 URDF"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>
          )}

          {sources.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-800/40 px-2 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between px-1 text-slate-500">
                <span>已加载文件夹（{sources.length}）</span>
                <span>
                  共 {sources.reduce((total, source) => total + source.files.length, 0)} 个文件
                </span>
              </div>
              {sources.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  active={source.id === activeSourceId}
                  onRemoveSource={removeModelSource}
                  onRemoveFile={removeModelFile}
                  onSelectEntry={setActiveModelFile}
                />
              ))}
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

          {xacroWarnings.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400 ring-1 ring-amber-500/30">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>XACRO 展开了但有 {xacroWarnings.length} 处需要注意：</span>
              </div>
              <ul className="ml-5 list-disc text-[10px] leading-4">
                {xacroWarnings.slice(0, 4).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {xacroWarnings.length > 4 && <li>…等共 {xacroWarnings.length} 条</li>}
              </ul>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/30">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
