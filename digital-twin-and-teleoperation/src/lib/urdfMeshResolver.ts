/**
 * Resolve URDF mesh references against a set of uploaded files.
 *
 * URDF files exported from ROS commonly use `package://pkg/meshes/file.STL`.
 * In the browser we don't have a filesystem, so we match by basename against
 * files the user uploaded, create blob URLs for them, and rewrite the URDF.
 */

export type MeshFormat = 'stl' | 'dae' | 'obj' | 'gltf';

export interface MeshReference {
  raw: string;
  packageName: string;
  relativePath: string;
  basename: string;
}

export interface ResolveResult {
  text: string;
  resolved: MeshReference[];
  missing: MeshReference[];
  unresolvedReplaced: number;
}

const MESH_REF_REGEX = /<mesh\s+filename\s*=\s*["']([^"']+)["']\s*\/?>/gi;

// Maps blob URLs to their original mesh format so that the custom mesh loader
// can pick the right THREE.js loader even though blob URLs have no extension.
const blobTypeMap = new Map<string, MeshFormat>();

// Blob URLs are recreated on every session, so they cannot key a persistent
// cache. The original file identity (name + size + mtime) is used instead.
const blobCacheKeyMap = new Map<string, string>();

export function getMeshFormatForBlobUrl(url: string): MeshFormat | undefined {
  return blobTypeMap.get(url);
}

/** Stable cache key for a mesh URL, or null when the URL is already stable. */
export function getMeshCacheKeyForUrl(url: string): string | null {
  return blobCacheKeyMap.get(url) ?? null;
}

export function extractMeshReferences(urdfText: string): MeshReference[] {
  const refs: MeshReference[] = [];
  let match: RegExpExecArray | null;

  while ((match = MESH_REF_REGEX.exec(urdfText)) !== null) {
    const raw = match[1];
    const parts = raw.replace(/^package:\/\//, '').split('/');
    const packageName = parts[0] ?? '';
    const relativePath = parts.slice(1).join('/');
    const basename = parts[parts.length - 1] ?? '';
    refs.push({ raw, packageName, relativePath, basename });
  }

  return refs;
}

function findMatchingFile(basename: string, files: File[]): File | undefined {
  return files.find((f) => f.name.toLowerCase() === basename.toLowerCase());
}

/** Identity of an uploaded mesh file, stable across browser sessions. */
function meshIdentityKey(path: string, file: File): string {
  return `mesh:${path}:${file.size}:${file.lastModified}`;
}

function detectFormat(basename: string): MeshFormat | undefined {
  const lower = basename.toLowerCase();
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.dae')) return 'dae';
  if (lower.endsWith('.obj')) return 'obj';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'gltf';
  return undefined;
}

export function resolveMeshReferences(
  urdfText: string,
  meshFiles: File[]
): ResolveResult {
  const refs = extractMeshReferences(urdfText);
  const resolved: MeshReference[] = [];
  const missing: MeshReference[] = [];
  const blobMap = new Map<string, string>();

  for (const ref of refs) {
    const file = findMatchingFile(ref.basename, meshFiles);
    if (file) {
      const blobUrl = URL.createObjectURL(file);
      const format = detectFormat(ref.basename);
      if (format) {
        blobTypeMap.set(blobUrl, format);
      }
      blobCacheKeyMap.set(blobUrl, meshIdentityKey(ref.relativePath || ref.basename, file));
      blobMap.set(ref.raw, blobUrl);
      resolved.push(ref);
    } else {
      missing.push(ref);
    }
  }

  let text = urdfText;
  let unresolvedReplaced = 0;

  text = text.replace(MESH_REF_REGEX, (_, rawRef: string) => {
    const blobUrl = blobMap.get(rawRef);
    if (blobUrl) {
      return `<mesh filename="${blobUrl}" />`;
    }
    unresolvedReplaced++;
    return '<box size="0.05 0.05 0.05" />';
  });

  return { text, resolved, missing, unresolvedReplaced };
}

export function hasMeshReferences(urdfText: string): boolean {
  return MESH_REF_REGEX.test(urdfText);
}
