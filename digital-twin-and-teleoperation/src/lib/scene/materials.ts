import * as THREE from 'three';

/**
 * Material policy for imported robot meshes.
 *
 * Raw STL / OBJ imports carry no material, and URDF `<material>` tags only
 * declare a colour. Everything is upgraded to `MeshStandardMaterial` so the
 * PBR lighting rig and the safety highlighter (emissive tinting) behave
 * consistently across formats.
 */

const LINK_COLOR_PALETTE = [
  0x1e5aa8, // base blue
  0x334155, // joint dark
  0x94a3b8, // cool grey
  0xc0c5c9, // silver
  0x64748b, // slate
  0x0ea5e9, // sky
  0xf97316, // tool orange
  0x10b981, // emerald
  0x8b5cf6, // violet
  0xe11d48, // rose
];

export function createDefaultPBRMaterial(color?: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color ?? 0x8899a6,
    roughness: 0.5,
    metalness: 0.4,
  });
}

export function ensurePBRMaterial(material: THREE.Material): THREE.MeshStandardMaterial {
  if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
    return material;
  }

  const pbr = createDefaultPBRMaterial();

  if ('color' in material && (material as THREE.MeshStandardMaterial).color instanceof THREE.Color) {
    pbr.color.copy((material as THREE.MeshStandardMaterial).color);
  }
  if ('map' in material && (material as THREE.MeshStandardMaterial).map instanceof THREE.Texture) {
    pbr.map = (material as THREE.MeshStandardMaterial).map;
  }
  if ('transparent' in material && typeof (material as THREE.Material).transparent === 'boolean') {
    pbr.transparent = (material as THREE.Material).transparent;
    const opacity = (material as THREE.Material & { opacity?: number }).opacity;
    pbr.opacity = typeof opacity === 'number' ? opacity : 1;
  }

  material.dispose();
  return pbr;
}

export function colorForLinkName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return LINK_COLOR_PALETTE[Math.abs(hash) % LINK_COLOR_PALETTE.length];
}

/** Walk up to the first named ancestor below `root`: that is the URDF link. */
export function findLinkName(mesh: THREE.Object3D, root: THREE.Object3D): string | null {
  let node: THREE.Object3D | null = mesh.parent;
  while (node) {
    if (node === root) return null;
    if (node.name) return node.name;
    node = node.parent;
  }
  return null;
}
