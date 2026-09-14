import { create } from 'zustand';
import { resolveMeshReferences } from '@/lib/urdfMeshResolver';
import { parseJointDefinitions } from '@/lib/urdfJoints';
import type { MeshReference } from '@/lib/urdfMeshResolver';
import type { URDFJointDefinition } from '@/lib/urdfJoints';

export interface URDFState {
  fileName: string | null;
  urdfText: string | null;
  processedText: string | null;
  blobUrl: string | null;
  error: string | null;
  isLoading: boolean;
  meshFiles: File[];
  resolvedMeshes: MeshReference[];
  missingMeshes: MeshReference[];
  unresolvedReplaced: number;
  joints: URDFJointDefinition[];
  setURDF: (fileName: string, text: string, initialMeshFiles?: File[]) => void;
  addMeshFiles: (files: File[]) => void;
  removeMeshFile: (name: string) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  /** Fetch the bundled demo URDF so its joints become editable / jogglable. */
  loadDefault: () => Promise<void>;
  reset: () => void;
}

const defaultURDFUrl = '/assets/industrial-5axis-arm.urdf';

function applyURDF(
  state: Pick<URDFState, 'urdfText' | 'meshFiles' | 'fileName' | 'blobUrl'>,
  fileName: string,
  text: string,
  meshFiles: File[]
): Partial<URDFState> {
  const { text: processed, resolved, missing, unresolvedReplaced } = resolveMeshReferences(
    text,
    meshFiles
  );
  const blob = new Blob([processed], { type: 'application/xml' });
  const blobUrl = URL.createObjectURL(blob);

  if (state.blobUrl && state.blobUrl !== defaultURDFUrl) {
    URL.revokeObjectURL(state.blobUrl);
  }

  return {
    fileName,
    urdfText: text,
    processedText: processed,
    blobUrl,
    error: null,
    isLoading: false,
    meshFiles,
    resolvedMeshes: resolved,
    missingMeshes: missing,
    unresolvedReplaced,
    joints: parseJointDefinitions(text),
  };
}

export const useURDFStore = create<URDFState>((set, get) => ({
  fileName: null,
  urdfText: null,
  processedText: null,
  blobUrl: defaultURDFUrl,
  error: null,
  isLoading: false,
  meshFiles: [],
  resolvedMeshes: [],
  missingMeshes: [],
  unresolvedReplaced: 0,
  joints: [],
  setURDF: (fileName, text, initialMeshFiles = []) =>
    set((prev) => applyURDF(prev, fileName, text, initialMeshFiles)),
  addMeshFiles: (files) =>
    set((prev) => {
      if (!prev.urdfText) {
        // If no URDF yet, just accumulate mesh files.
        const merged = [...prev.meshFiles];
        for (const f of files) {
          if (!merged.some((m) => m.name.toLowerCase() === f.name.toLowerCase())) {
            merged.push(f);
          }
        }
        return { meshFiles: merged };
      }
      const merged = [...prev.meshFiles];
      for (const f of files) {
        if (!merged.some((m) => m.name.toLowerCase() === f.name.toLowerCase())) {
          merged.push(f);
        }
      }
      return applyURDF(prev, prev.fileName ?? 'robot.urdf', prev.urdfText, merged);
    }),
  removeMeshFile: (name) =>
    set((prev) => {
      const merged = prev.meshFiles.filter((m) => m.name !== name);
      if (!prev.urdfText) return { meshFiles: merged };
      return applyURDF(prev, prev.fileName ?? 'robot.urdf', prev.urdfText, merged);
    }),
  setError: (error) => set({ error }),
  setLoading: (loading) => set({ isLoading: loading }),
  loadDefault: async () => {
    if (get().urdfText !== null) return;
    set({ isLoading: true });
    try {
      const res = await fetch(defaultURDFUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      set((prev) => applyURDF(prev, 'industrial-5axis-arm.urdf', text, prev.meshFiles));
    } catch {
      set({ isLoading: false, error: '无法加载默认 URDF 资源' });
    }
  },
  reset: () => {
    const prev = get();
    if (prev.blobUrl && prev.blobUrl !== defaultURDFUrl) {
      URL.revokeObjectURL(prev.blobUrl);
    }
    set({
      fileName: null,
      urdfText: null,
      processedText: null,
      blobUrl: defaultURDFUrl,
      error: null,
      isLoading: false,
      meshFiles: [],
      resolvedMeshes: [],
      missingMeshes: [],
      unresolvedReplaced: 0,
      joints: [],
    });
    void get().loadDefault();
  },
}));
