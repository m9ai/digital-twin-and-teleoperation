import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Check, Download, RotateCcw, Save, AlertCircle } from 'lucide-react';
import { useURDFStore } from '@/store/urdfStore';
import { validateURDF } from '@/lib/urdfJoints';
import type { editor } from 'monaco-editor';

/**
 * Monaco-based URDF editor.
 *
 * Editing is buffered locally: the 3D scene is only rebuilt when the operator
 * presses “应用”, because every URDF change creates a new blob URL and forces
 * a full Three.js reload. Auto-applying on every keystroke made the viewer
 * stutter and dropped WebGL contexts.
 */
export function URDFEditor() {
  const { fileName, urdfText, joints, setURDF, setError } = useURDFStore();
  const [draft, setDraft] = useState(urdfText ?? '');
  const [applying, setApplying] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Re-sync the draft when the source URDF changes from outside the editor
  // (new upload, ZIP import, mesh re-resolution, reset).
  useEffect(() => {
    setDraft(urdfText ?? '');
  }, [urdfText]);

  const validation = useMemo(() => validateURDF(draft), [draft]);
  const dirty = draft !== (urdfText ?? '');

  const handleApply = useCallback(() => {
    if (!validation.ok) return;
    setApplying(true);
    setError(null);
    setURDF(fileName ?? 'robot.urdf', draft);
    // The blob URL swap + Three.js reload happens in RobotViewer's effect.
    window.setTimeout(() => setApplying(false), 400);
  }, [validation.ok, fileName, draft, setURDF, setError]);

  const handleRevert = useCallback(() => {
    setDraft(urdfText ?? '');
  }, [urdfText]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([draft], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName ?? 'robot.urdf';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [draft, fileName]);

  const options = useMemo(
    () => ({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on' as const,
      automaticLayout: true,
      tabSize: 2,
      fontSize: 12,
    }),
    []
  );

  return (
    <div className="flex flex-col gap-2">
      <Editor
        height="320px"
        theme="vs-dark"
        defaultLanguage="xml"
        language="xml"
        value={draft}
        onChange={(next) => setDraft(next ?? '')}
        onMount={(instance) => {
          editorRef.current = instance;
        }}
        options={options}
        loading={<span className="text-xs text-slate-500">加载编辑器…</span>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleApply}
          disabled={!validation.ok || (!dirty && !applying)}
          className="btn btn-primary flex-1 px-2 py-1.5 text-xs"
          title="重新解析并重建数字孪生"
        >
          <Save className="h-3.5 w-3.5" />
          {applying ? '应用中…' : '应用到数字孪生'}
        </button>
        <button
          onClick={handleRevert}
          disabled={!dirty}
          className="btn btn-secondary px-2 py-1.5 text-xs"
          title="放弃未应用的修改"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          还原
        </button>
        <button
          onClick={handleDownload}
          className="btn btn-secondary px-2 py-1.5 text-xs"
          title="导出当前 URDF"
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>

      {!validation.ok ? (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-red-500/30">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            XML 校验失败{validation.line !== null && `（第 ${validation.line} 行）`}：{validation.message}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-2 text-xs text-slate-400">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span>
            {dirty ? '有未应用的修改' : '已同步'} · 解析到 {joints.length} 个可动关节
          </span>
        </div>
      )}

      {!validation.ok && validation.line !== null && editorRef.current && (
        <button
          onClick={() => {
            editorRef.current?.revealLineInCenter(validation.line!);
            editorRef.current?.setPosition({ lineNumber: validation.line!, column: 1 });
            editorRef.current?.focus();
          }}
          className="self-start text-xs text-cyan-400 hover:text-cyan-300"
        >
          跳转到出错行
        </button>
      )}
    </div>
  );
}
