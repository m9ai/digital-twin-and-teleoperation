import { create } from 'zustand';
import { resolveMeshReferences } from '@/lib/urdfMeshResolver';
import { parseJointDefinitions, parseLinkDefinitions } from '@/lib/urdfJoints';
import { expandXacro } from '@/lib/xacroProcessor';
import {
  getModelPath,
  inferRootName,
  isMeshFile,
  isModelFile,
  isURDFFile,
  isXacroFile,
  mergeModelFiles,
} from '@/lib/directoryReader';
import type { MeshReference } from '@/lib/urdfMeshResolver';
import type { URDFJointDefinition, URDFLinkDefinition } from '@/lib/urdfJoints';

/**
 * One imported model folder (or archive).
 *
 * A robot description is never a single file, so an upload is kept as the
 * folder the user picked instead of being flattened into a mesh pool: the
 * panel can render the real tree, and — once the twin renders more than one
 * robot — every source becomes one robot in the scene.
 */
export interface ModelSource {
  id: string;
  /** Folder / archive name as chosen on disk, e.g. `humanoid`. */
  name: string;
  /** Every model file of this source: URDF/XACRO descriptions and meshes. */
  files: File[];
  /** Path of the description currently rendered for this source. */
  entryPath: string | null;
}

/**
 * One rendered robot in the digital twin.
 *
 * The twin can display a swarm of robots. Each instance keeps its own copy
 * of the resolved URDF text and transform so copies of the same model can be
 * placed independently without re-parsing the source files.
 */
export interface RobotInstance {
  id: string;
  sourceId: string;
  entryPath: string;
  /** Display label, e.g. `humanoid #2`. */
  name: string;
  /** World placement in the Three.js scene. */
  transform: {
    x: number;
    y: number;
    z: number;
    rotationY: number;
    scale: number;
  };
  visible: boolean;
  /** The instance currently receiving joints / gizmo / safety interaction. */
  isActive: boolean;
  /** Expanded URDF text used to build this instance. */
  urdfText: string;
  joints: URDFJointDefinition[];
  links: URDFLinkDefinition[];
}

export interface URDFState {
  fileName: string | null;
  urdfText: string | null;
  processedText: string | null;
  blobUrl: string | null;
  error: string | null;
  isLoading: boolean;
  /** Imported folders, newest last. */
  sources: ModelSource[];
  /** Source whose entry URDF is rendered in the twin. */
  activeSourceId: string | null;
  /** All robot instances currently shown in the twin. */
  instances: RobotInstance[];
  /** Instance that receives joints / gizmo / safety interaction. */
  activeInstanceId: string | null;
  /** Mesh pool of every source, active source first. Drives the resolver. */
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
  /** Normalise a selection (folder, files or drag payload) into a source. */
  loadModelFiles: (files: File[], name?: string) => Promise<void>;
  /** Register an already-parsed source, e.g. an unpacked archive. */
  addModelSource: (
    name: string,
    files: File[],
    options?: {
      entryPath?: string;
      entryText?: string;
      xacroSources?: Record<string, string>;
    }
  ) => void;
  /** Render a different description of an already imported source. */
  setActiveModelFile: (sourceId: string, path: string) => Promise<void>;
  /** Add a new robot instance to the twin, optionally copying an existing one. */
  addRobotInstance: (sourceId: string, path: string) => Promise<void>;
  /** Remove one robot instance from the twin. */
  removeRobotInstance: (instanceId: string) => void;
  /** Switch which instance receives joints / gizmo / safety interaction. */
  setActiveInstance: (instanceId: string | null) => void;
  /** Move, rotate or scale a robot instance. */
  setInstanceTransform: (
    instanceId: string,
    patch: Partial<RobotInstance['transform']>
  ) => void;
  /** Show or hide a robot instance without removing it. */
  setInstanceVisible: (instanceId: string, visible: boolean) => void;
  removeModelSource: (sourceId: string) => Promise<void>;
  /** `identifier` is the source-relative path, or the bare file name. */
  removeModelFile: (sourceId: string, identifier: string) => Promise<void>;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
  /** Fetch the bundled demo URDF so its joints become editable / jogglable. */
  loadDefault: () => Promise<void>;
  reset: () => void;
}

const defaultURDFUrl = '/assets/industrial-5axis-arm.urdf';

type ApplyableState = Pick<URDFState, 'urdfText' | 'meshFiles' | 'fileName' | 'blobUrl'>;

const basenameOf = (path: string) => path.split('/').pop() ?? path;

let sourceSeq = 0;
const createSourceId = () => `model-source-${(sourceSeq += 1)}`;

let instanceSeq = 0;
const createInstanceId = () => `robot-instance-${(instanceSeq += 1)}`;

/**
 * Produce a display name like `humanoid #2` for copies of the same model.
 */
function deriveInstanceName(
  sourceId: string,
  sourceName: string,
  entryName: string,
  instances: RobotInstance[]
): string {
  const base = `${sourceName}/${entryName}`;
  const count = instances.filter((item) => item.sourceId === sourceId && item.entryPath === entryName).length;
  return count > 0 ? `${base} #${count + 1}` : base;
}

/**
 * Compute a non-overlapping world placement for a new robot instance.
 *
 * Copies of the same model are spaced along the world X axis so they do not
 * render on top of each other.
 */
function deriveInstanceTransform(instances: RobotInstance[]): RobotInstance['transform'] {
  const spacing = 1.2;
  const occupied = new Set(instances.map((item) => Math.round(item.transform.x / spacing)));
  let slot = 0;
  while (occupied.has(slot)) slot += 1;
  return { x: slot * spacing, y: 0, z: 0, rotationY: 0, scale: 1 };
}

/**
 * Mesh pool handed to the resolver, active source first.
 *
 * `package://` references that only match by basename then resolve inside the
 * robot being viewed instead of grabbing a same-named mesh from another
 * loaded folder.
 */
function collectMeshFiles(sources: ModelSource[], activeSourceId: string | null): File[] {
  const meshesOf = (source: ModelSource) => source.files.filter((file) => isMeshFile(file.name));
  const active = sources.find((source) => source.id === activeSourceId);
  const others = sources.filter((source) => source.id !== activeSourceId);
  return mergeModelFiles(
    active ? meshesOf(active) : [],
    others.flatMap(meshesOf)
  );
}

/**
 * Which file is the entry point of a model set.
 *
 * A generated `.urdf` beats a `.xacro` because it needs no macro expansion;
 * within one kind the shallowest path wins so that `robot.urdf` beats
 * `urdf/robot.urdf` in nested package layouts.
 */
function pickEntryFile(files: File[]): File | undefined {
  const candidates = files.filter((file) => isURDFFile(file.name));
  if (candidates.length === 0) return undefined;
  const depth = (file: File) => getModelPath(file).split('/').length;
  return [...candidates].sort((a, b) => {
    const aIsXacro = isXacroFile(a.name);
    const bIsXacro = isXacroFile(b.name);
    if (aIsXacro !== bIsXacro) return aIsXacro ? 1 : -1;
    return depth(a) - depth(b);
  })[0];
}

/** Sibling xacro text, keyed by path, used to resolve `<xacro:include>`. */
async function readXacroSources(files: File[]): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};
  await Promise.all(
    files.map(async (file) => {
      try {
        sources[getModelPath(file)] = await file.text();
      } catch {
        // An unreadable sibling only costs us one include target.
      }
    })
  );
  return sources;
}

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
  sources: [],
  activeSourceId: null,
  instances: [],
  activeInstanceId: null,
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

  addModelSource: (name, files, options = {}) =>
    set((prev) => {
      const source: ModelSource = {
        id: createSourceId(),
        name,
        files,
        entryPath: options.entryPath ?? null,
      };
      // Re-importing the same folder replaces it instead of stacking a second
      // copy of every mesh.
      const sources = [...prev.sources.filter((item) => item.name !== name), source];
      const meshFiles = collectMeshFiles(sources, source.id);
      const next = { ...prev, sources, activeSourceId: source.id, meshFiles };

      if (options.entryText !== undefined) {
        const applied = applyURDF(
          next,
          basenameOf(options.entryPath ?? name),
          options.entryText,
          meshFiles,
          options.xacroSources ?? {}
        );
        const entryPath = options.entryPath ?? basenameOf(name);
        const instance: RobotInstance = {
          id: createInstanceId(),
          sourceId: source.id,
          entryPath,
          name: deriveInstanceName(source.id, source.name, basenameOf(entryPath), prev.instances),
          transform: deriveInstanceTransform(prev.instances),
          visible: true,
          isActive: true,
          urdfText: applied.processedText ?? applied.urdfText ?? options.entryText,
          joints: applied.joints ?? [],
          links: applied.links ?? [],
        };
        const instances = prev.instances.map((item) => ({ ...item, isActive: false })).concat(instance);
        return { ...next, ...applied, instances, activeInstanceId: instance.id };
      }
      // Meshes only: keep whatever robot is already on screen and let it pick
      // up the new files.
      if (!prev.urdfText) return { ...next, error: null, isLoading: false };
      return {
        ...next,
        ...applyURDF(next, prev.fileName ?? 'robot.urdf', prev.urdfText, meshFiles),
      };
    }),

  loadModelFiles: async (files, name) => {
    const modelFiles = files.filter((file) => isModelFile(file.name));
    if (modelFiles.length === 0) {
      set({ error: '未找到 .urdf / .xacro / .zip 模型文件或 STL/DAE/OBJ/GLB 网格资源', isLoading: false });
      return;
    }

    // The folder the user picked is the identity of the source; loose files
    // have no common root and fall back to a generic label.
    const sourceName = name ?? inferRootName(modelFiles) ?? '未分组资源';
    set({ isLoading: true, error: null });

    try {
      const entry = pickEntryFile(modelFiles);
      if (!entry) {
        get().addModelSource(sourceName, modelFiles);
        return;
      }

      const entryPath = getModelPath(entry);
      const entryText = await entry.text();
      if (!/<robot[\s>]/.test(entryText)) {
        throw new Error(`${basenameOf(entryPath)} 内容不是有效的 URDF/XML`);
      }

      // A xacro almost always splits its macros across sibling files, so
      // every other `.xacro` in the selection is collected as a candidate
      // for `<xacro:include>` before expansion starts.
      const xacroSources = await readXacroSources(
        modelFiles.filter((file) => file !== entry && isXacroFile(file.name))
      );

      get().addModelSource(sourceName, modelFiles, { entryPath, entryText, xacroSources });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载模型失败', isLoading: false });
    }
  },

  setActiveModelFile: async (sourceId, path) => {
    const source = get().sources.find((item) => item.id === sourceId);
    if (!source) return;
    const entry = source.files.find((file) => getModelPath(file) === path);
    if (!entry) return;

    set({ isLoading: true, error: null });
    try {
      const entryText = await entry.text();
      if (!/<robot[\s>]/.test(entryText)) {
        throw new Error(`${basenameOf(path)} 内容不是有效的 URDF/XML`);
      }
      const xacroSources = await readXacroSources(
        source.files.filter((file) => file !== entry && isXacroFile(file.name))
      );
      set((state) => {
        const sources = state.sources.map((item) =>
          item.id === sourceId ? { ...item, entryPath: path } : item
        );
        const meshFiles = collectMeshFiles(sources, sourceId);
        const applied = applyURDF(state, basenameOf(path), entryText, meshFiles, xacroSources);
        const activeInstance = state.instances.find((item) => item.id === state.activeInstanceId);

        let instances: RobotInstance[];
        let activeInstanceId = state.activeInstanceId;
        if (activeInstance) {
          instances = state.instances.map((item) =>
            item.id === activeInstance.id
              ? {
                  ...item,
                  sourceId,
                  entryPath: path,
                  name: deriveInstanceName(source.id, source.name, basenameOf(path), state.instances.filter((i) => i.id !== item.id)),
                  urdfText: applied.processedText ?? applied.urdfText ?? entryText,
                  joints: applied.joints ?? [],
                  links: applied.links ?? [],
                  isActive: true,
                }
              : { ...item, isActive: false }
          );
        } else {
          const instance: RobotInstance = {
            id: createInstanceId(),
            sourceId,
            entryPath: path,
            name: deriveInstanceName(source.id, source.name, basenameOf(path), state.instances),
            transform: deriveInstanceTransform(state.instances),
            visible: true,
            isActive: true,
            urdfText: applied.processedText ?? applied.urdfText ?? entryText,
            joints: applied.joints ?? [],
            links: applied.links ?? [],
          };
          instances = state.instances.map((item) => ({ ...item, isActive: false })).concat(instance);
          activeInstanceId = instance.id;
        }

        return {
          ...state,
          sources,
          activeSourceId: sourceId,
          meshFiles,
          instances,
          activeInstanceId,
          ...applied,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '切换模型失败', isLoading: false });
    }
  },

  addRobotInstance: async (sourceId, path) => {
    const source = get().sources.find((item) => item.id === sourceId);
    if (!source) return;
    const entry = source.files.find((file) => getModelPath(file) === path);
    if (!entry) return;

    set({ isLoading: true, error: null });
    try {
      const entryText = await entry.text();
      if (!/<robot[\s>]/.test(entryText)) {
        throw new Error(`${basenameOf(path)} 内容不是有效的 URDF/XML`);
      }
      const xacroSources = await readXacroSources(
        source.files.filter((file) => file !== entry && isXacroFile(file.name))
      );
      set((state) => {
        const meshFiles = collectMeshFiles(state.sources, sourceId);
        const applied = applyURDF(state, basenameOf(path), entryText, meshFiles, xacroSources);
        const instance: RobotInstance = {
          id: createInstanceId(),
          sourceId,
          entryPath: path,
          name: deriveInstanceName(source.id, source.name, basenameOf(path), state.instances),
          transform: deriveInstanceTransform(state.instances),
          visible: true,
          isActive: true,
          urdfText: applied.processedText ?? applied.urdfText ?? entryText,
          joints: applied.joints ?? [],
          links: applied.links ?? [],
        };
        const instances = state.instances.map((item) => ({ ...item, isActive: false })).concat(instance);
        return {
          ...state,
          activeSourceId: sourceId,
          meshFiles,
          instances,
          activeInstanceId: instance.id,
          ...applied,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '追加模型失败', isLoading: false });
    }
  },

  removeRobotInstance: (instanceId) => {
    set((state) => {
      const instances = state.instances.filter((item) => item.id !== instanceId);
      const activeRemoved = state.activeInstanceId === instanceId;
      const activeInstanceId = activeRemoved
        ? (instances[instances.length - 1]?.id ?? null)
        : state.activeInstanceId;
      const instancesWithActive = instances.map((item, index) => ({
        ...item,
        isActive: activeRemoved ? index === instances.length - 1 : item.isActive,
      }));
      return { instances: instancesWithActive, activeInstanceId };
    });
  },

  setActiveInstance: (instanceId) => {
    set((state) => ({
      instances: state.instances.map((item) => ({ ...item, isActive: item.id === instanceId })),
      activeInstanceId: instanceId,
    }));
  },

  setInstanceTransform: (instanceId, patch) => {
    set((state) => ({
      instances: state.instances.map((item) =>
        item.id === instanceId ? { ...item, transform: { ...item.transform, ...patch } } : item
      ),
    }));
  },

  setInstanceVisible: (instanceId, visible) => {
    set((state) => ({
      instances: state.instances.map((item) =>
        item.id === instanceId ? { ...item, visible } : item
      ),
    }));
  },

  removeModelSource: async (sourceId) => {
    const prev = get();
    const sources = prev.sources.filter((source) => source.id !== sourceId);
    const instances = prev.instances.filter((item) => item.sourceId !== sourceId);

    if (sources.length === 0 || instances.length === 0) {
      prev.reset();
      return;
    }

    const activeInstanceId = instances.some((item) => item.id === prev.activeInstanceId)
      ? prev.activeInstanceId
      : instances[instances.length - 1].id;
    const activeInstance = instances.find((item) => item.id === activeInstanceId)!;
    const activeSource = sources.find((source) => source.id === activeInstance.sourceId) ?? sources[0];
    const meshFiles = collectMeshFiles(sources, activeSource.id);

    set({
      sources,
      activeSourceId: activeSource.id,
      instances: instances.map((item) => ({ ...item, isActive: item.id === activeInstanceId })),
      activeInstanceId,
      meshFiles,
    });
  },

  removeModelFile: async (sourceId, identifier) => {
    const prev = get();
    const sources = prev.sources
      .map((source) => {
        if (source.id !== sourceId) return source;
        const files = source.files.filter(
          (file) => getModelPath(file) !== identifier && file.name !== identifier
        );
        const entryRemoved =
          source.entryPath !== null &&
          (source.entryPath === identifier || basenameOf(source.entryPath) === identifier);
        return { ...source, files, entryPath: entryRemoved ? null : source.entryPath };
      })
      .filter((source) => source.files.length > 0);

    const instances = prev.instances.filter(
      (item) =>
        !(item.sourceId === sourceId && (item.entryPath === identifier || basenameOf(item.entryPath) === identifier))
    );

    if (sources.length === 0 || instances.length === 0) {
      prev.reset();
      return;
    }

    const activeInstanceId = instances.some((item) => item.id === prev.activeInstanceId)
      ? prev.activeInstanceId
      : instances[instances.length - 1].id;
    const activeInstance = instances.find((item) => item.id === activeInstanceId)!;
    const activeSource = sources.find((source) => source.id === activeInstance.sourceId) ?? sources[0];
    const meshFiles = collectMeshFiles(sources, activeSource.id);

    set({
      sources,
      activeSourceId: activeSource.id,
      instances: instances.map((item) => ({ ...item, isActive: item.id === activeInstanceId })),
      activeInstanceId,
      meshFiles,
      isLoading: false,
    });
  },

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
      sources: [],
      activeSourceId: null,
      instances: [],
      activeInstanceId: null,
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
