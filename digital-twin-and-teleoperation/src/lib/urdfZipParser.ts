import JSZip from 'jszip';
import { withModelPath } from '@/lib/directoryReader';

export interface ParsedZipPackage {
  urdfText: string;
  urdfFileName: string;
  meshFiles: File[];
}

export async function parseURDFZip(zipFile: File): Promise<ParsedZipPackage> {
  const zip = await JSZip.loadAsync(zipFile);

  // Find the first URDF file in the archive.
  const urdfEntry = Object.values(zip.files).find(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.urdf')
  );

  if (!urdfEntry) {
    throw new Error('压缩包中未找到 .urdf 文件');
  }

  const urdfText = await urdfEntry.async('text');
  const urdfFileName = urdfEntry.name.split('/').pop() ?? urdfEntry.name;

  // Collect all mesh files.
  const meshFiles: File[] = [];
  const meshPromises: Promise<void>[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const lower = entry.name.toLowerCase();
    if (
      lower.endsWith('.stl') ||
      lower.endsWith('.dae') ||
      lower.endsWith('.obj') ||
      lower.endsWith('.glb') ||
      lower.endsWith('.gltf')
    ) {
      meshPromises.push(
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
    }
  }

  await Promise.all(meshPromises);

  return { urdfText, urdfFileName, meshFiles };
}
