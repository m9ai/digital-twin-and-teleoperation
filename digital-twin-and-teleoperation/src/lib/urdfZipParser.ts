import JSZip from 'jszip';
import { withModelPath } from '@/lib/directoryReader';

export interface ParsedZipPackage {
  urdfText: string;
  urdfFileName: string;
  meshFiles: File[];
  /**
   * Text of every `.xacro` in the archive, keyed by its archive-relative path.
   * Needed to resolve `<xacro:include>` after unpacking.
   */
  xacroSources: Record<string, string>;
}

const MESH_SUFFIXES = ['.stl', '.dae', '.obj', '.glb', '.gltf'];

/**
 * Pick the model entry point from an archive.
 *
 * A `.urdf` wins over a `.xacro` (it needs no expansion), and among the
 * candidates of the same kind the shallowest one wins so that a top-level
 * entry beats a nested `urdf/robot.xacro`.
 */
function pickModelEntry(entries: JSZip.JSZipObject[]): JSZip.JSZipObject | undefined {
  const candidates = entries.filter((entry) => {
    const lower = entry.name.toLowerCase();
    return lower.endsWith('.urdf') || lower.endsWith('.xacro');
  });
  if (candidates.length === 0) return undefined;

  const depth = (entry: JSZip.JSZipObject) => entry.name.split('/').length;
  return [...candidates].sort((a, b) => {
    const aIsUrdf = a.name.toLowerCase().endsWith('.urdf');
    const bIsUrdf = b.name.toLowerCase().endsWith('.urdf');
    if (aIsUrdf !== bIsUrdf) return aIsUrdf ? -1 : 1;
    return depth(a) - depth(b);
  })[0];
}

export async function parseURDFZip(zipFile: File): Promise<ParsedZipPackage> {
  const zip = await JSZip.loadAsync(zipFile);
  const allEntries = Object.values(zip.files).filter((entry) => !entry.dir);

  const modelEntry = pickModelEntry(allEntries);
  if (!modelEntry) {
    throw new Error('压缩包中未找到 .urdf / .xacro 文件');
  }

  const urdfText = await modelEntry.async('text');
  const urdfFileName = modelEntry.name.split('/').pop() ?? modelEntry.name;

  // Collect all mesh files.
  const meshFiles: File[] = [];
  // Collect every xacro so `<xacro:include>` can be resolved offline.
  const xacroSources: Record<string, string> = {};
  const pending: Promise<void>[] = [];

  for (const entry of allEntries) {
    const lower = entry.name.toLowerCase();

    if (MESH_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
      pending.push(
        entry.async('arraybuffer').then((buffer) => {
          const basename = entry.name.split('/').pop() ?? entry.name;
          let mime = 'application/octet-stream';
          if (lower.endsWith('.dae')) mime = 'model/vnd.collada+xml';
          else if (lower.endsWith('.obj')) mime = 'text/plain';
          else if (lower.endsWith('.glb')) mime = 'model/gltf-binary';
          else if (lower.endsWith('.gltf')) mime = 'model/gltf+json';
          // Keep the archive-relative path so mesh references can be matched
          // against the packaged folder layout, not just the file name.
          const file = new File([buffer], basename, { type: mime });
          meshFiles.push(withModelPath(file, entry.name));
        })
      );
      continue;
    }

    if (lower.endsWith('.xacro')) {
      pending.push(
        entry.async('text').then((text) => {
          xacroSources[entry.name.replace(/^\.?\//, '')] = text;
        })
      );
    }
  }

  await Promise.all(pending);

  return { urdfText, urdfFileName, meshFiles, xacroSources };
}
