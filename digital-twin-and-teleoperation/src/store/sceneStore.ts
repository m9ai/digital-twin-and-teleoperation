import { create } from 'zustand';
import {
  ENVIRONMENT_MOODS,
  DEFAULT_SCENE_MOOD_ID,
} from '@/lib/scene/environmentPresets';
import type {
  CustomScene,
  CustomSceneStats,
  EnvironmentPresetId,
  SceneBackgroundId,
  SceneLightingConfig,
  SceneSafetyConfig,
} from '@/types';

/**
 * The workspace the robot stands in.
 *
 * Everything here is declarative: the 3D environment rig reads a snapshot of
 * this store and reconciles the Three.js scene, so switching a workshop for a
 * street never rebuilds the URDF or drops the telemetry stream.
 */

function sceneId(): string {
  return `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Accepted scene model extensions. glTF is the only self-contained format. */
const SCENE_EXTENSIONS = ['.glb', '.gltf'];

export function isSceneFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return SCENE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const SCENE_ACCEPT = SCENE_EXTENSIONS.join(',');

export interface SceneStoreState {
  preset: EnvironmentPresetId;
  gridVisible: boolean;
  /** Edge length of the reference grid, metres. */
  gridSize: number;
  gridDivisions: number;
  axesVisible: boolean;
  background: SceneBackgroundId;
  lighting: SceneLightingConfig;
  safety: SceneSafetyConfig;
  scenes: CustomScene[];

  /**
   * Switch environment. The preset also carries a lighting / backdrop mood so
   * a workshop reads differently from a street; both stay editable afterwards.
   */
  setPreset: (preset: EnvironmentPresetId) => void;
  setGridVisible: (visible: boolean) => void;
  setGrid: (size: number, divisions: number) => void;
  setAxesVisible: (visible: boolean) => void;
  setBackground: (background: SceneBackgroundId) => void;
  patchLighting: (patch: Partial<SceneLightingConfig>) => void;
  patchSafety: (patch: Partial<SceneSafetyConfig>) => void;

  /** Register uploaded files; URLs are owned (and revoked) by the store. */
  addSceneFiles: (files: File[]) => void;
  markSceneReady: (id: string, stats: CustomSceneStats) => void;
  markSceneError: (id: string, message: string) => void;
  updateScene: (id: string, patch: Partial<CustomScene>) => void;
  patchSceneTransform: (id: string, patch: Partial<CustomScene['transform']>) => void;
  removeScene: (id: string) => void;
  clearScenes: () => void;
  reset: () => void;
}

function moodFor(preset: EnvironmentPresetId) {
  return ENVIRONMENT_MOODS[preset] ?? ENVIRONMENT_MOODS[DEFAULT_SCENE_MOOD_ID];
}

const INITIAL_PRESET: EnvironmentPresetId = 'none';

export const useSceneStore = create<SceneStoreState>((set) => ({
  preset: INITIAL_PRESET,
  gridVisible: true,
  gridSize: moodFor(INITIAL_PRESET).gridSize,
  gridDivisions: 40,
  axesVisible: true,
  background: moodFor(INITIAL_PRESET).background,
  lighting: { ...moodFor(INITIAL_PRESET).lighting },
  safety: { obstacleCheck: true, warnDistance: 0.03 },
  scenes: [],

  setPreset: (preset) =>
    set(() => {
      const mood = moodFor(preset);
      return {
        preset,
        gridSize: mood.gridSize,
        background: mood.background,
        lighting: { ...mood.lighting },
      };
    }),

  setGridVisible: (gridVisible) => set({ gridVisible }),
  setGrid: (gridSize, gridDivisions) => set({ gridSize, gridDivisions }),
  setAxesVisible: (axesVisible) => set({ axesVisible }),
  setBackground: (background) => set({ background }),

  patchLighting: (patch) => set((state) => ({ lighting: { ...state.lighting, ...patch } })),
  patchSafety: (patch) => set((state) => ({ safety: { ...state.safety, ...patch } })),

  addSceneFiles: (files) =>
    set((state) => ({
      scenes: [
        ...state.scenes,
        ...files.map<CustomScene>((file) => ({
          id: sceneId(),
          name: file.name,
          url: URL.createObjectURL(file),
          visible: true,
          autoFit: true,
          targetSize: 10,
          zUp: false,
          transform: { x: 0, y: 0, z: 0, rotationY: 0, scale: 1 },
          status: 'loading',
        })),
      ],
    })),

  markSceneReady: (id, stats) =>
    set((state) => ({
      scenes: state.scenes.map((scene) =>
        scene.id === id ? { ...scene, status: 'ready', stats, error: undefined } : scene
      ),
    })),

  markSceneError: (id, message) =>
    set((state) => ({
      scenes: state.scenes.map((scene) =>
        scene.id === id ? { ...scene, status: 'error', error: message } : scene
      ),
    })),

  updateScene: (id, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
    })),

  patchSceneTransform: (id, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) =>
        scene.id === id ? { ...scene, transform: { ...scene.transform, ...patch } } : scene
      ),
    })),

  removeScene: (id) =>
    set((state) => {
      const target = state.scenes.find((scene) => scene.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return { scenes: state.scenes.filter((scene) => scene.id !== id) };
    }),

  clearScenes: () =>
    set((state) => {
      for (const scene of state.scenes) URL.revokeObjectURL(scene.url);
      return { scenes: [] };
    }),

  reset: () =>
    set((state) => {
      for (const scene of state.scenes) URL.revokeObjectURL(scene.url);
      const mood = moodFor(INITIAL_PRESET);
      return {
        preset: INITIAL_PRESET,
        gridVisible: true,
        gridSize: mood.gridSize,
        gridDivisions: 40,
        axesVisible: true,
        background: mood.background,
        lighting: { ...mood.lighting },
        safety: { obstacleCheck: true, warnDistance: 0.03 },
        scenes: [],
      };
    }),
}));
