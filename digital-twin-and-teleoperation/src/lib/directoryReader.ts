/**
 * Folder / multi-file readers for the model loading panel.
 *
 * A robot model is never a single file: a URDF points at a whole tree of
 * meshes. Browsers expose two different APIs depending on how that tree gets
 * in, so both are normalised here into plain `File` objects that additionally
 * remember their path relative to the upload root:
 *
 *  - `<input type="file" webkitdirectory>` -> `FileList` where every entry
 *    already carries `webkitRelativePath`.
 *  - drag & drop -> `DataTransferItem` entries that have to be walked
 *    recursively through `webkitGetAsEntry()`.
 *
 * Keeping the relative path (not just the basename) is what lets the mesh
 * resolver honour the folder structure of packages such as
 * `package://humanoid/meshes/hip_left.STL`.
 */

export const URDF_EXTENSIONS = ['.urdf', '.xacro'];
export const MESH_EXTENSIONS = ['.stl', '.dae', '.obj', '.glb', '.gltf'];
export const ZIP_EXTENSIONS = ['.zip'];
export const MODEL_EXTENSIONS = [...URDF_EXTENSIONS, ...MESH_EXTENSIONS, ...ZIP_EXTENSIONS];

export interface PathAwareFile extends File {
  /** Path relative to the upload root, e.g. `humanoid/meshes/hip_left.STL`. */
  modelPath?: string;
}

/** Forward slashes, no leading `./` or `/`. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

export function hasExtension(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export const isURDFFile = (name: string) => hasExtension(name, URDF_EXTENSIONS);
export const isMeshFile = (name: string) => hasExtension(name, MESH_EXTENSIONS);
export const isZipFile = (name: string) => hasExtension(name, ZIP_EXTENSIONS);
export const isModelFile = (name: string) => hasExtension(name, MODEL_EXTENSIONS);

/** Path of an uploaded file relative to the upload root. */
export function getModelPath(file: File): string {
  const attached = (file as PathAwareFile).modelPath;
  if (attached) return normalizePath(attached);
  const relative = file.webkitRelativePath;
  if (relative) return normalizePath(relative);
  return file.name;
}

/** Attach the root-relative path so mesh resolution can use the folder layout. */
export function withModelPath(file: File, path: string): File {
  const normalized = normalizePath(path);
  if (!normalized || normalized === file.name) return file;
  try {
    (file as PathAwareFile).modelPath = normalized;
  } catch {
    // `File` is extensible everywhere we target; if it is not, name matching
    // still works as a fallback.
  }
  return file;
}

/** Drop OS bookkeeping entries (`.DS_Store`, `__MACOSX`, …). */
function isUsableFile(file: File, path: string): boolean {
  return !normalizePath(path)
    .split('/')
    .some((segment) => segment.startsWith('.'))
    && Boolean(file.name);
}

/** Flatten a `<input type="file">` (optionally `webkitdirectory`) selection. */
export function filesFromFileList(list: FileList | null): File[] {
  if (!list) return [];
  return Array.from(list).filter((file) => isUsableFile(file, getModelPath(file)));
}

/** Merge newly loaded files into an existing set, de-duplicated by path. */
export function mergeModelFiles(base: File[], incoming: File[]): File[] {
  const seen = new Set(base.map((file) => getModelPath(file).toLowerCase()));
  const merged = [...base];
  for (const file of incoming) {
    const key = getModelPath(file).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged;
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.name.startsWith('.')) return;

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    if (isUsableFile(file, entry.fullPath)) {
      out.push(withModelPath(file, entry.fullPath));
    }
    return;
  }

  if (!entry.isDirectory) return;

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // `readEntries()` hands back at most 100 entries per call, so keep polling
  // until it returns an empty batch.
  let batch = await readDirectoryBatch(reader);
  while (batch.length > 0) {
    for (const child of batch) {
      await walkEntry(child, out);
    }
    batch = await readDirectoryBatch(reader);
  }
}

/**
 * Flatten a drag & drop payload, walking dropped folders recursively.
 *
 * `webkitGetAsEntry()` has to be called synchronously — the `DataTransfer` is
 * neutralised once the drop handler yields — so the entries (and the plain
 * file fallback) are captured before the first `await`.
 */
export async function filesFromDataTransfer(dataTransfer: DataTransfer | null): Promise<File[]> {
  if (!dataTransfer) return [];

  const fallback = filesFromFileList(dataTransfer.files);
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 0) return fallback;

  const files: File[] = [];
  for (const entry of entries) {
    await walkEntry(entry, files);
  }
  return files.length > 0 ? files : fallback;
}
