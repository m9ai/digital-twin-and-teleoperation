import { useCallback, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import debounce from 'lodash.debounce';
import { useURDFStore } from '@/store/urdfStore';

export function URDFEditor() {
  const { fileName, urdfText, setURDF, setError } = useURDFStore();
  const value = urdfText ?? '';

  const save = useRef(
    debounce((next: string, name: string | null) => {
      const trimmed = next.trim();
      if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<robot')) {
        setError('URDF 必须以 <?xml 或 <robot> 开头');
        return;
      }
      setError(null);
      setURDF(name ?? 'robot.urdf', next);
    }, 500)
  );

  const onChange = useCallback(
    (next: string | undefined) => {
      save.current(next ?? '', fileName);
    },
    [fileName, save]
  );

  const options = useMemo(
    () => ({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on' as const,
      automaticLayout: true,
      language: 'xml',
      tabSize: 2,
    }),
    []
  );

  return (
    <div className="flex flex-col gap-2">
      <Editor
        height="320px"
        theme="vs-dark"
        defaultLanguage="xml"
        value={value}
        onChange={onChange}
        options={options}
        loading={<span className="text-xs text-slate-500">加载编辑器…</span>}
      />
    </div>
  );
}
