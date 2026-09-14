import * as THREE from 'three';
import type { SafetyLevel } from '@/types';

/**
 * Safety highlighting for the digital twin.
 *
 * Joints that drift close to (or past) their URDF limits, and link pairs that
 * come within a proximity threshold, tint the corresponding meshes amber /
 * red. A breathing pulse on `violation` makes the fault impossible to miss on
 * a shop-floor monitor.
 */

export interface SafetyHighlightEntry {
  /** Joint name; resolved to its child link when `link` is omitted. */
  joint?: string;
  /** Link (Object3D) name; takes precedence over `joint`. */
  link?: string;
  level: SafetyLevel;
}

export interface SafetyHighlightOptions {
  root: THREE.Object3D;
  /** Optional joint -> link name override for non-URDF (procedural) models. */
  jointLinkMap?: Record<string, string>;
}

interface RestoredMaterial {
  material: THREE.MeshStandardMaterial;
  emissive: THREE.Color;
  emissiveIntensity: number;
}

const LEVEL_STYLE: Record<SafetyLevel, { color: number; intensity: number }> = {
  warn: { color: 0xf59e0b, intensity: 0.5 },
  violation: { color: 0xef4444, intensity: 1.0 },
};

export function createSafetyHighlighter(options: SafetyHighlightOptions) {
  const { root, jointLinkMap } = options;

  const urdf = root as unknown as {
    links?: Record<string, THREE.Object3D>;
    joints?: Record<string, { child?: THREE.Object3D }>;
  };

  const materialRegistry = new Map<string, THREE.MeshStandardMaterial[]>();
  const restored: RestoredMaterial[] = [];
  let active: Array<{ materials: THREE.MeshStandardMaterial[]; level: SafetyLevel }> = [];
  let pulse = 0;

  const registerLink = (name: string, object: THREE.Object3D) => {
    if (materialRegistry.has(name)) return;
    const materials: THREE.MeshStandardMaterial[] = [];
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
        if (!materials.includes(material)) materials.push(material);
      }
    });
    materialRegistry.set(name, materials);
  };

  const resolveObject = (entry: SafetyHighlightEntry): string | null => {
    const linkName = entry.link ?? (entry.joint ? jointLinkMap?.[entry.joint] : undefined);
    if (linkName) return linkName;

    if (entry.joint) {
      const child = urdf.joints?.[entry.joint]?.child;
      if (child?.name) return child.name;
      if (jointLinkMap?.[entry.joint]) return jointLinkMap[entry.joint];
    }
    return null;
  };

  const findObject = (name: string): THREE.Object3D | null => {
    if (urdf.links?.[name]) return urdf.links[name];
    let found: THREE.Object3D | null = null;
    root.traverse((child) => {
      if (!found && child.name === name) found = child;
    });
    return found;
  };

  const setWarnings = (entries: SafetyHighlightEntry[]) => {
    // Restore every material touched by the previous frame's warnings.
    for (const item of restored) {
      item.material.emissive.copy(item.emissive);
      item.material.emissiveIntensity = item.emissiveIntensity;
    }
    restored.length = 0;
    active = [];

    for (const entry of entries) {
      const name = resolveObject(entry);
      if (!name) continue;

      if (!materialRegistry.has(name)) {
        const object = findObject(name);
        if (!object) continue;
        registerLink(name, object);
      }

      const materials = materialRegistry.get(name);
      if (!materials || materials.length === 0) continue;

      for (const material of materials) {
        if (restored.some((r) => r.material === material)) continue;
        restored.push({
          material,
          emissive: material.emissive.clone(),
          emissiveIntensity: material.emissiveIntensity,
        });
      }
      active.push({ materials, level: entry.level });
    }
  };

  /** Advance the breathing pulse; call once per rendered frame. */
  const update = (deltaMs: number) => {
    if (active.length === 0) return;
    pulse = (pulse + deltaMs / 500) % 2;
    // Triangle wave in [0.45, 1].
    const breath = 0.45 + 0.55 * (pulse < 1 ? pulse : 2 - pulse);

    for (const { materials, level } of active) {
      const style = LEVEL_STYLE[level];
      const intensity = level === 'violation' ? style.intensity * breath : style.intensity;
      for (const material of materials) {
        material.emissive.setHex(style.color);
        material.emissiveIntensity = intensity;
      }
    }
  };

  const dispose = () => setWarnings([]);

  return { setWarnings, update, dispose };
}
