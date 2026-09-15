import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { LinkNode } from '@/lib/safetyMonitor';
import { createGLTFLoader } from '@/lib/scene/modelLoader';
import { ensurePBRMaterial } from '@/lib/scene/materials';
import { buildEnvironment, disposeObject } from '@/lib/scene/environmentPresets';
import type {
  CustomScene,
  CustomSceneStats,
  EnvironmentPresetId,
  EnvironmentSettings,
  SceneBackgroundId,
} from '@/types';

/**
 * Everything in the viewport that is **not** the robot.
 *
 * The rig owns lights, backdrop, reference grid, the generated environment and
 * any user supplied glTF scene, and it reconciles all of them from a plain
 * settings object. Keeping it separate from `createURDFScene` means switching a
 * workshop for a street mutates one subtree — the URDF, live joint stream and
 * camera never get torn down.
 */

/** Vertical gradient used as the sky/backdrop quad. */
const BACKDROP_GRADIENTS: Record<Exclude<SceneBackgroundId, 'transparent'>, [string, string]> = {
  studio: ['#1e293b', '#020617'],
  night: ['#111827', '#000000'],
  daylight: ['#bfdbfe', '#94a3b8'],
};

export interface EnvironmentRigCallbacks {
  onSceneReady?: (id: string, stats: CustomSceneStats) => void;
  onSceneError?: (id: string, message: string) => void;
}

export interface EnvironmentRigOptions extends EnvironmentRigCallbacks {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}

export interface EnvironmentRig {
  /** Generated scenery lives here; safe to hide without touching the robot. */
  group: THREE.Group;
  /** Reconcile lights / backdrop / grid / environment from a settings snapshot. */
  apply: (settings: EnvironmentSettings) => void;
  /** Reconcile user uploaded scenes (transform updates are synchronous). */
  syncCustomScenes: (scenes: CustomScene[]) => void;
  /** Static props registered for the robot proximity scan. */
  getObstacleNodes: () => LinkNode[];
  dispose: () => void;
}

interface LoadedScene {
  /** Outer group: carries the user transform. */
  root: THREE.Group;
  /** Inner group: carries auto-fit normalization so user values stay readable. */
  fit: THREE.Group;
  url: string;
  loaded: boolean;
  /** Geometry is re-normalized if `autoFit` / `zUp` / `targetSize` changes. */
  fitKey: string;
}

function gradientTexture(top: string, bottom: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createEnvironmentRig(options: EnvironmentRigOptions): EnvironmentRig {
  const { scene, renderer, onSceneReady, onSceneError } = options;

  const group = new THREE.Group();
  group.name = 'environment-rig';
  scene.add(group);

  /* ---- lights ---------------------------------------------------- */
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  const hemisphere = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xa5f3fc, 0.45);
  fill.position.set(-4, 3, -5);
  const rim = new THREE.DirectionalLight(0xffffff, 0.3);
  rim.position.set(-2, 4, 6);
  group.add(ambient, hemisphere, key, fill, rim);

  /* ---- reference helpers ----------------------------------------- */
  let grid: THREE.GridHelper | null = null;
  const axes = new THREE.AxesHelper(0.5);
  axes.position.y = 0.004;
  group.add(axes);

  const rebuildGrid = (size: number, divisions: number) => {
    if (grid) {
      group.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      grid = null;
    }
    const helper = new THREE.GridHelper(size, divisions, 0x475569, 0x1e293b);
    const material = helper.material as THREE.LineBasicMaterial;
    material.transparent = true;
    material.opacity = 0.55;
    material.depthWrite = false;
    // Lifted off the floor plane so the two never z-fight.
    helper.position.y = 0.003;
    group.add(helper);
    grid = helper;
  };
  rebuildGrid(10, 40);

  /* ---- backdrop -------------------------------------------------- */
  const backdrops = new Map<SceneBackgroundId, THREE.CanvasTexture>();
  const getBackdrop = (id: SceneBackgroundId): THREE.CanvasTexture | null => {
    if (id === 'transparent') return null;
    const cached = backdrops.get(id);
    if (cached) return cached;
    const [top, bottom] = BACKDROP_GRADIENTS[id];
    const texture = gradientTexture(top, bottom);
    backdrops.set(id, texture);
    return texture;
  };

  /* ---- image based lighting -------------------------------------- */
  let envTexture: THREE.Texture | null = null;
  const ensureEnvMap = (): THREE.Texture => {
    if (envTexture) return envTexture;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    disposeObject(room);
    pmrem.dispose();
    envTexture = target.texture;
    return envTexture;
  };

  /* ---- generated presets ----------------------------------------- */
  let currentPreset: EnvironmentPresetId | null = null;
  let presetObjects: THREE.Group | null = null;
  let presetObstacles: THREE.Object3D[] = [];
  let presetFog: THREE.Fog | null = null;

  const swapPreset = (id: EnvironmentPresetId) => {
    if (presetObjects) {
      group.remove(presetObjects);
      disposeObject(presetObjects);
      presetObjects = null;
    }
    presetObstacles = [];
    const build = buildEnvironment(id);
    group.add(build.objects);
    presetObjects = build.objects;
    presetObstacles = build.obstacles;
    presetFog = build.fog;
    currentPreset = id;
  };
  swapPreset('none');

  /* ---- user scenes ----------------------------------------------- */
  const loadedScenes = new Map<string, LoadedScene>();
  const loading = new Set<string>();

  const fitSignature = (sceneItem: CustomScene) =>
    `${sceneItem.autoFit ? 1 : 0}:${sceneItem.zUp ? 1 : 0}:${sceneItem.targetSize}:${sceneItem.url}`;

  const applyTransform = (entry: LoadedScene, sceneItem: CustomScene) => {
    const { x, y, z, rotationY, scale } = sceneItem.transform;
    entry.root.position.set(x, y, z);
    entry.root.rotation.y = THREE.MathUtils.degToRad(rotationY);
    entry.root.scale.setScalar(scale);
    entry.root.visible = sceneItem.visible && entry.loaded;
  };

  const clearFitGroup = (fit: THREE.Group) => {
    for (const child of [...fit.children]) {
      fit.remove(child);
      disposeObject(child);
    }
  };

  const load = async (id: string, sceneItem: CustomScene, entry: LoadedScene) => {
    loading.add(id);
    try {
      const response = await fetch(sceneItem.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const gltf = await createGLTFLoader().parseAsync(bytes, '');

      const content = gltf.scene;
      content.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const current = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (current) mesh.material = ensurePBRMaterial(current);
      });

      // Z-up exporters: rotate before measuring so auto-fit sees the real pose.
      if (sceneItem.zUp) content.rotation.x = -Math.PI / 2;
      content.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(content);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z);

      // Normalize once: sink the model onto the floor, centre it on the origin
      // and rescale arbitrary authoring units into metres.
      content.position.set(-center.x, -box.min.y, -center.z);
      content.updateMatrixWorld(true);
      const fitScale =
        sceneItem.autoFit && longest > 1e-6 ? sceneItem.targetSize / longest : 1;

      clearFitGroup(entry.fit);
      entry.fit.scale.setScalar(fitScale);
      entry.fit.add(content);
      entry.loaded = true;
      entry.fitKey = fitSignature(sceneItem);

      let meshes = 0;
      let triangles = 0;
      content.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        meshes++;
        const index = mesh.geometry.getIndex();
        const position = mesh.geometry.getAttribute('position');
        triangles += index ? index.count / 3 : position ? position.count / 3 : 0;
      });

      const normalized: [number, number, number] = [
        size.x * fitScale,
        size.y * fitScale,
        size.z * fitScale,
      ];
      onSceneReady?.(id, { meshes, triangles: Math.round(triangles), size: normalized });
    } catch (err) {
      entry.loaded = false;
      onSceneError?.(id, err instanceof Error ? err.message : '场景模型解析失败');
    } finally {
      loading.delete(id);
      applyTransform(entry, sceneItem);
    }
  };

  const syncCustomScenes = (scenes: CustomScene[]) => {
    const seen = new Set<string>();

    for (const sceneItem of scenes) {
      seen.add(sceneItem.id);
      let entry = loadedScenes.get(sceneItem.id);
      if (!entry) {
        const root = new THREE.Group();
        root.name = `custom-scene:${sceneItem.name}`;
        const fit = new THREE.Group();
        root.add(fit);
        group.add(root);
        entry = { root, fit, url: sceneItem.url, loaded: false, fitKey: '' };
        loadedScenes.set(sceneItem.id, entry);
      }
      applyTransform(entry, sceneItem);

      const signature = fitSignature(sceneItem);
      if (!loading.has(sceneItem.id) && (!entry.loaded || entry.fitKey !== signature)) {
        void load(sceneItem.id, sceneItem, entry);
      }
    }

    for (const [id, entry] of loadedScenes) {
      if (seen.has(id)) continue;
      group.remove(entry.root);
      clearFitGroup(entry.fit);
      loadedScenes.delete(id);
    }
  };

  /* ---- settings application -------------------------------------- */
  const gridScale = { width: 10, divisions: 40 };
  let currentBackground: SceneBackgroundId | null = null;
  let shadowsEnabled: boolean | null = null;

  const setShadows = (enabled: boolean) => {
    if (shadowsEnabled === enabled) return;
    shadowsEnabled = enabled;
    renderer.shadowMap.enabled = enabled;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Toggling the shadow define changes every program: force a recompile.
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => (m.needsUpdate = true));
      else mesh.material.needsUpdate = true;
    });
  };

  const apply = (settings: EnvironmentSettings) => {
    if (settings.preset !== currentPreset) swapPreset(settings.preset);

    if (
      grid &&
      (Math.abs(settings.grid.size - gridScale.width) > 1e-6 ||
        settings.grid.divisions !== gridScale.divisions)
    ) {
      rebuildGrid(settings.grid.size, settings.grid.divisions);
    }
    if (grid) grid.visible = settings.grid.visible;
    gridScale.width = settings.grid.size;
    gridScale.divisions = settings.grid.divisions;
    axes.visible = settings.axes;

    if (settings.background !== currentBackground) {
      const texture = getBackdrop(settings.background);
      scene.background = texture;
      renderer.setClearAlpha(0);
      currentBackground = settings.background;
    }
    scene.fog = presetFog;

    const { lighting } = settings;
    ambient.intensity = lighting.ambient;
    hemisphere.intensity = lighting.ambient * 0.9;
    key.intensity = lighting.intensity;
    fill.intensity = lighting.intensity * 0.3;
    rim.intensity = lighting.intensity * 0.18;

    const azimuth = THREE.MathUtils.degToRad(lighting.azimuthDeg);
    const polar = THREE.MathUtils.degToRad(90 - THREE.MathUtils.clamp(lighting.elevationDeg, 1, 89));
    key.position.setFromSphericalCoords(14, polar, azimuth);
    key.castShadow = lighting.shadows;

    setShadows(lighting.shadows);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = lighting.exposure;

    scene.environment = lighting.envMap ? ensureEnvMap() : null;
    scene.environmentIntensity = lighting.envMap ? lighting.envIntensity : 0;
  };

  /** Collect named solid props of an uploaded scene for the proximity scan. */
  const collectSceneNodes = (root: THREE.Object3D, prefix: string, into: LinkNode[], cap: number) => {
    root.traverse((child) => {
      if (into.length >= cap) return;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      into.push({ name: `${prefix}:${mesh.name || into.length}`, object: mesh });
    });
  };

  return {
    group,
    apply,
    syncCustomScenes,
    getObstacleNodes: () => {
      const nodes: LinkNode[] = [];
      for (const object of presetObstacles) {
        nodes.push({ name: `场景:${object.name}`, object });
      }
      for (const [id, entry] of loadedScenes) {
        if (!entry.loaded || !entry.root.visible) continue;
        collectSceneNodes(entry.root, `模型:${id.slice(-4)}`, nodes, 64);
      }
      return nodes;
    },
    dispose: () => {
      if (presetObjects) {
        group.remove(presetObjects);
        disposeObject(presetObjects);
      }
      for (const entry of loadedScenes.values()) {
        group.remove(entry.root);
        clearFitGroup(entry.fit);
      }
      loadedScenes.clear();
      if (grid) {
        group.remove(grid);
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
      }
      for (const texture of backdrops.values()) texture.dispose();
      backdrops.clear();
      envTexture?.dispose();
      scene.remove(group);
      scene.background = null;
      scene.environment = null;
      scene.fog = null;
    },
  };
}
