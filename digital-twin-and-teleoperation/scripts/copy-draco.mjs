/**
 * Copy the Draco decoder shipped with three.js into `public/draco/`.
 *
 * STL → GLB (Draco) conversion is the recommended way to serve robot meshes.
 * Serving the decoder from the app origin keeps decoding working offline and
 * avoids a hard dependency on a third-party CDN.
 */

import { cp, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const source = resolve(projectRoot, 'node_modules/three/examples/jsm/libs/draco/gltf');
const target = resolve(projectRoot, 'public/draco');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(source))) {
    console.warn('[copy-draco] three.js draco decoder not found; skipping.', source);
    return;
  }

  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  console.log(`[copy-draco] decoder copied to ${target}`);
}

main().catch((err) => {
  console.warn('[copy-draco] failed:', err.message);
  // Never fail the build because of an optional asset copy.
  process.exit(0);
});
