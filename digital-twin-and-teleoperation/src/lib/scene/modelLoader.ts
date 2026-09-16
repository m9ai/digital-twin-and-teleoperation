import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { getMeshFormatForBlobUrl, getMeshCacheKeyForUrl } from '@/lib/urdfMeshResolver';
import { readMeshCache, writeMeshCache } from '@/lib/meshCache';
import { createDefaultPBRMaterial } from '@/lib/scene/materials';

/**
 * Unified mesh loader for URDF `<mesh>` references.
 *
 * - Binary STL / GLB are fetched once as bytes and stored in the IndexedDB
 *   mesh cache, so repeat loads (and offline reloads) skip the network.
 * - GLB is decoded with Draco, which is what the offline STL -> GLB pipeline
 *   produces.
 * - ASCII STL, DAE and OBJ keep the streaming loader path.
 */

export type MeshFormat = 'stl' | 'gltf' | 'dae' | 'obj';

/** Decoder is served from the app origin so Draco works offline. */
const DRACO_DECODER_PATH = `${import.meta.env.BASE_URL}draco/`;

let dracoLoader: DRACOLoader | null = null;

function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  }
  return dracoLoader;
}

export function createGLTFLoader(manager?: THREE.LoadingManager): GLTFLoader {
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(getDracoLoader());
  return loader;
}

export function detectMeshFormat(path: string): MeshFormat | null {
  const blobFormat = getMeshFormatForBlobUrl(path);
  if (blobFormat === 'stl' || blobFormat === 'dae' || blobFormat === 'obj' || blobFormat === 'gltf') {
    return blobFormat;
  }

  const lower = path.split('?')[0].toLowerCase();
  if (lower.endsWith('.stl')) return 'stl';
  if (lower.endsWith('.glb') || lower.endsWith('.gltf')) return 'gltf';
  if (lower.endsWith('.dae')) return 'dae';
  if (lower.endsWith('.obj')) return 'obj';
  return null;
}

/** ASCII STL files start with "solid "; only binary STL can be parsed from bytes. */
function isBinarySTL(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 84) return false;
  const header = new Uint8Array(bytes, 0, 5);
  const signature = String.fromCharCode(...header);
  return signature.toLowerCase() !== 'solid';
}

async function fetchMeshBytes(url: string, cacheKey: string): Promise<ArrayBuffer> {
  const cached = await readMeshCache(cacheKey);
  if (cached && cached.byteLength > 0) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch mesh: ${response.status} ${response.statusText}`);
  }

  const bytes = await response.arrayBuffer();
  void writeMeshCache(cacheKey, bytes);
  return bytes;
}

export type MeshLoadCallback = (mesh: THREE.Object3D | null, err?: unknown) => void;

export function loadRobotMesh(
  path: string,
  manager: THREE.LoadingManager,
  done: MeshLoadCallback
): void {
  const format = detectMeshFormat(path);

  if (!format) {
    console.warn(`URDFLoader: could not load model at ${path}.\nNo loader available`);
    done(null);
    return;
  }

  const cacheKey = getMeshCacheKeyForUrl(path) ?? path;

  const finish = (mesh: THREE.Object3D | null, err?: unknown) => {
    if (err) console.warn(`[modelLoader] ${format} load failed for ${path}:`, err);
    done(mesh, err);
  };

  if (format === 'stl') {
    fetchMeshBytes(path, cacheKey)
      .then((bytes) => {
        if (!isBinarySTL(bytes)) {
          // ASCII STL: STLLoader.parse() only understands the binary format.
          new STLLoader(manager).load(
            path,
            (geom) => finish(buildSTL(geom)),
            undefined,
            (err) => finish(null, err)
          );
          return;
        }
        finish(buildSTL(new STLLoader().parse(bytes)));
      })
      .catch((err) => finish(null, err));
    return;
  }

  if (format === 'gltf') {
    fetchMeshBytes(path, cacheKey)
      .then((bytes) => createGLTFLoader(manager).parseAsync(bytes, ''))
      .then((gltf) => finish(gltf.scene as THREE.Object3D))
      .catch((err) => finish(null, err));
    return;
  }

  if (format === 'dae') {
    // ColladaLoader's error message is cryptic when the fetched file is not
    // XML (e.g. a 404 page or a misnamed binary file). Pre-check the response
    // so the console explains the real cause.
    fetch(path)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('xml') && !contentType.includes('application/octet-stream')) {
          console.warn(
            `[modelLoader] ${path} has suspicious content-type "${contentType}"; DAE should be XML.`
          );
        }
        return response.text();
      })
      .then((text) => {
        const trimmed = text.trim();
        if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<COLLADA')) {
          throw new Error(
            `File does not look like a Collada XML document (starts with "${trimmed.slice(0, 40).replace(/\n/g, ' ')}...")`
          );
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'application/xml');
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
          throw new Error(`XML parse error: ${parseError.textContent?.slice(0, 120)}`);
        }
        new ColladaLoader(manager).load(path, (dae) => finish(dae.scene), undefined, (err) =>
          finish(null, err)
        );
      })
      .catch((err) => finish(null, err));
    return;
  }

  new OBJLoader(manager).load(path, (obj) => finish(obj), undefined, (err) => finish(null, err));
}

function buildSTL(geometry: THREE.BufferGeometry): THREE.Mesh {
  // STL from some CAD exporters lacks smooth vertex normals.
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, createDefaultPBRMaterial());
}
