import { create } from 'zustand';
import { resolveMeshReferences } from '@/lib/urdfMeshResolver';
import { parseJointDefinitions, parseLinkDefinitions } from '@/lib/urdfJoints';
import { expandXacro } from '@/lib/xacroProcessor';
import { getModelPath, mergeModelFiles } from '@/lib/directoryReader';
import type { MeshReference } from '@/lib/urdfMeshResolver';
import type { URDFJointDefinition, URDFLinkDefinition } from '@/lib/urdfJoints';

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
  links: URDFLinkDefinition[];
  /** True when the active model arrived as XACRO and was macro-expanded. */
  xacroExpanded: boolean;
  /** Non-fatal problems reported while expanding XACRO. */
  xacroWarnings: string[];
  setURDF: (
    fileName: string,
    text: string,
    initialMeshFiles?: File[],
    /** Text of other model files, keyed by path, for `<xacro:include>`. */
    xacroSources?: Record<string, string>
  ) => void;
  addMeshFiles: (files: File[]) => void;
  /** `identifier` is the upload-relative path, or the bare file name. */
  removeMeshFile: (identifier: string) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  /** Fetch the bundled demo URDF so its joints become editable / jogglable. */
  loadDefault: () => Promise<void>;
  reset: () => void;
}

const defaultURDFUrl = '/assets/industrial-5axis-arm.urdf';

type ApplyableState = Pick<
  URDFState,
  'urdfText' | 'meshFiles' | 'fileName' | 'blobUrl'
>;

/**
 * Normalise one model source into everything the app needs.
 *
 * XACRO is expanded first: the scene graph, joint list and mesh resolver all
 * expect plain URDF, and a macro such as `${...}` inside an origin would
 * otherwise reach `URDFLoader` verbatim.
 */
function applyURDF(
  state: ApplyableState,
  fileName: string,
  source: string,
  meshFiles: File[],
  xacroSources: Record<string, string> = {}
): Partial<URDFState> {
  const xacro = expandXacro(source, { files: xacroSources });
  const { text: processed, resolved, missing, unresolvedReplaced } = resolveMeshReferences(
    xacro.text,
    meshFiles
  );
  const blob = new Blob([processed], { type: 'application/xml' });
  const blobUrl = URL.createObjectURL(blob);

  if (state.blobUrl && state.blobUrl !== defaultURDFUrl) {
    URL.revokeObjectURL(state.blobUrl);
  }

  return {
    fileName,
    // Downstream always consumes the expanded URDF so that the editor can
    // validate and patch what the renderer actually loaded.
    urdfText: xacro.text,
    processedText: processed,
    blobUrl,
    error: null,
    isLoading: false,
    meshFiles,
    resolvedMeshes: resolved,
    missingMeshes: missing,
    unresolvedReplaced,
    joints: parseJointDefinitions(xacro.text),
    links: parseLinkDefinitions(xacro.text),
    xacroExpanded: xacro.expanded,
    xacroWarnings: xacro.warnings,
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
  links: [],
  xacroExpanded: false,
  xacroWarnings: [],
  setURDF: (fileName, text, initialMeshFiles = [], xacroSources = {}) =>
    set((prev) => applyURDF(prev, fileName, text, initialMeshFiles, xacroSources)),
  addMeshFiles: (files) =>
    set((prev) => {
      const merged = mergeModelFiles(prev.meshFiles, files);
      if (!prev.urdfText) {
        // If no URDF yet, just accumulate mesh files.
        return { meshFiles: merged };
      }
      return applyURDF(prev, prev.fileName ?? 'robot.urdf', prev.urdfText, merged);
    }),
  removeMeshFile: (identifier) =>
    set((prev) => {
      const merged = prev.meshFiles.filter(
        (file) => file.name !== identifier && getModelPath(file) !== identifier
      );
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
      links: [],
      xacroExpanded: false,
      xacroWarnings: [],
    });
    void get().loadDefault();
  },
}));
