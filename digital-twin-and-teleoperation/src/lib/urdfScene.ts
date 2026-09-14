import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getMeshFormatForBlobUrl } from '@/lib/urdfMeshResolver';
import type { JointState } from '@/types';

export interface SceneHandles {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  robot: THREE.Object3D | null;
  applyJointState: (state: JointState) => void;
  dispose: () => void;
  resize: () => void;
}

function createDefaultPBRMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xc0c5c9,
    roughness: 0.4,
    metalness: 0.3,
  });
}

function ensurePBRMaterial(material: THREE.Material): THREE.MeshStandardMaterial {
  if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
    return material;
  }

  const pbr = createDefaultPBRMaterial();

  if ('color' in material && material.color instanceof THREE.Color) {
    pbr.color.copy(material.color);
  }
  if ('map' in material && material.map instanceof THREE.Texture) {
    pbr.map = material.map;
  }
  if ('transparent' in material && typeof material.transparent === 'boolean') {
    pbr.transparent = material.transparent;
    pbr.opacity = 'opacity' in material && typeof material.opacity === 'number' ? material.opacity : 1;
  }

  material.dispose();
  return pbr;
}

export function createURDFScene(container: HTMLElement, urdfUrl: string): Promise<SceneHandles> {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 100);
  camera.position.set(1.5, 1.2, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0.5, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const hemisphere = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.8);
  scene.add(hemisphere);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(3, 5, 3);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xa5f3fc, 0.6);
  fillLight.position.set(-3, 2, -3);
  scene.add(fillLight);

  const grid = new THREE.GridHelper(10, 50, 0x334155, 0x1e293b);
  scene.add(grid);

  const axes = new THREE.AxesHelper(0.5);
  scene.add(axes);

  let robot: THREE.Object3D | null = null;
  let animationId: number;

  const loader = new URDFLoader() as unknown as {
    loadMeshCb: (
      path: string,
      manager: THREE.LoadingManager,
      done: (mesh: THREE.Object3D | null, err?: unknown) => void
    ) => void;
  };
  loader.loadMeshCb = (path, manager, done) => {
    const format = getMeshFormatForBlobUrl(path);
    const lowerPath = path.toLowerCase();

    if (format === 'stl' || lowerPath.endsWith('.stl')) {
      const stlLoader = new STLLoader(manager);
      stlLoader.load(
        path,
        (geom) => {
          // STL from some CAD exporters lacks smooth vertex normals.
          geom.computeVertexNormals();

          const material = new THREE.MeshStandardMaterial({
            color: 0x8899a6,
            roughness: 0.4,
            metalness: 0.5,
          });
          done(new THREE.Mesh(geom, material));
        },
        undefined,
        (err) => done(null, err)
      );
    } else if (format === 'gltf' || lowerPath.endsWith('.glb') || lowerPath.endsWith('.gltf')) {
      const gltfLoader = new GLTFLoader(manager);
      gltfLoader.load(
        path,
        (gltf) => done(gltf.scene),
        undefined,
        (err) => done(null, err)
      );
    } else if (format === 'dae' || lowerPath.endsWith('.dae')) {
      const daeLoader = new ColladaLoader(manager);
      daeLoader.load(
        path,
        (dae) => done(dae.scene),
        undefined,
        (err) => done(null, err)
      );
    } else if (format === 'obj' || lowerPath.endsWith('.obj')) {
      const objLoader = new OBJLoader(manager);
      objLoader.load(
        path,
        (obj) => done(obj),
        undefined,
        (err) => done(null, err)
      );
    } else {
      console.warn(`URDFLoader: Could not load model at ${path}.\nNo loader available`);
      done(null);
    }
  };

  return new Promise((resolve, reject) => {
    fetch(urdfUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load URDF: ${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((urdfText) => {
        // Pass an empty working path so mesh filenames that are already
        // absolute blob URLs are not prepended with the URDF base URL.
        const parsed = (loader as unknown as { parse: (text: string, path: string) => THREE.Object3D }).parse(urdfText, '');
        robot = parsed;
        robot.scale.set(1, 1, 1);

        // ROS URDF uses Z-up; Three.js uses Y-up. Rotate the root so the
        // robot stands upright in the Three.js scene.
        robot.rotation.x = -Math.PI / 2;

        robot.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Ensure PBR fallback for missing or non-PBR materials.
            const current = mesh.material;
            if (Array.isArray(current)) {
              mesh.material = current.map((m) => ensurePBRMaterial(m));
            } else if (current) {
              mesh.material = ensurePBRMaterial(current);
            } else {
              mesh.material = createDefaultPBRMaterial();
            }
          }
        });
        scene.add(robot);

        // Force initial matrix computation now that transforms are set.
        robot.updateMatrix();
        robot.updateMatrixWorld(true);

        const applyJointState = (state: JointState) => {
          if (!robot) return;
          const urdfRobot = robot as unknown as {
            joints: Record<string, { setJointValue: (...values: number[]) => void }>;
          };
          let changed = false;
          state.name.forEach((jointName, index) => {
            const joint = urdfRobot.joints?.[jointName];
            if (joint && typeof joint.setJointValue === 'function') {
              const value = state.position[index] ?? 0;
              joint.setJointValue(value);
              changed = true;
            }
          });
          if (changed) {
            robot.updateMatrixWorld(true);
          }
        };

        const animate = () => {
          animationId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        const dispose = () => {
          cancelAnimationFrame(animationId);
          controls.dispose();
          renderer.dispose();
          if (container.contains(renderer.domElement)) {
            container.removeChild(renderer.domElement);
          }
        };

        const resize = () => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };

        resolve({ scene, camera, renderer, controls, robot, applyJointState, dispose, resize });
      })
      .catch((err: unknown) => reject(err));
  });
}

export function createFallbackScene(container: HTMLElement): SceneHandles {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 100);
  camera.position.set(1.5, 1.2, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.5, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(2, 4, 2);
  scene.add(dirLight);

  const grid = new THREE.GridHelper(10, 50, 0x334155, 0x1e293b);
  scene.add(grid);

  const robotGroup = new THREE.Group();
  const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x334155 });
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x1e5aa8 });
  const linkGreyMaterial = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
  const linkSilverMaterial = new THREE.MeshStandardMaterial({ color: 0xc0c5c9 });
  const toolMaterial = new THREE.MeshStandardMaterial({ color: 0xf97316 });

  // Base link
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.15, 0.45), baseMaterial);
  base.position.y = 0.075;
  base.castShadow = true;
  robotGroup.add(base);

  // Joint 1: waist (rotate around z)
  const joint1Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 24), jointMaterial);
  joint1Housing.position.y = 0.15;
  joint1Housing.castShadow = true;
  robotGroup.add(joint1Housing);

  const joint1Pivot = new THREE.Group();
  joint1Pivot.position.y = 0.15;
  robotGroup.add(joint1Pivot);

  const link1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 16), linkGreyMaterial);
  link1.position.y = 0.25;
  link1.castShadow = true;
  joint1Pivot.add(link1);

  // Joint 2: shoulder (rotate around y)
  const joint2Housing = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 24), jointMaterial);
  joint2Housing.position.y = 0.5;
  joint2Housing.castShadow = true;
  joint1Pivot.add(joint2Housing);

  const joint2Pivot = new THREE.Group();
  joint2Pivot.position.y = 0.5;
  joint1Pivot.add(joint2Pivot);

  // Link 2: upper arm along +x (Three.js cylinder y-up; rotate -90 deg around z)
  const link2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 16), linkSilverMaterial);
  link2.rotation.z = -Math.PI / 2;
  link2.position.x = 0.275;
  link2.castShadow = true;
  joint2Pivot.add(link2);

  // Joint 3: elbow (rotate around y)
  const joint3Housing = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 24), jointMaterial);
  joint3Housing.position.x = 0.55;
  joint3Housing.castShadow = true;
  joint2Pivot.add(joint3Housing);

  const joint3Pivot = new THREE.Group();
  joint3Pivot.position.x = 0.55;
  joint2Pivot.add(joint3Pivot);

  // Link 3: forearm along +x (Three.js cylinder y-up; rotate -90 deg around z)
  const link3 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 16), linkGreyMaterial);
  link3.rotation.z = -Math.PI / 2;
  link3.position.x = 0.225;
  link3.castShadow = true;
  joint3Pivot.add(link3);

  // Joint 4: wrist roll (rotate around z)
  const joint4Housing = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 24), jointMaterial);
  joint4Housing.position.x = 0.45;
  joint4Housing.castShadow = true;
  joint3Pivot.add(joint4Housing);

  const joint4Pivot = new THREE.Group();
  joint4Pivot.position.x = 0.45;
  joint3Pivot.add(joint4Pivot);

  // Link 4: wrist segment along z
  const link4 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 16), linkSilverMaterial);
  link4.position.y = 0.1;
  link4.castShadow = true;
  joint4Pivot.add(link4);

  // Joint 5: wrist bend (rotate around x)
  const joint5Housing = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 24), jointMaterial);
  joint5Housing.position.y = 0.2;
  joint5Housing.castShadow = true;
  joint4Pivot.add(joint5Housing);

  const joint5Pivot = new THREE.Group();
  joint5Pivot.position.y = 0.2;
  joint4Pivot.add(joint5Pivot);

  // Link 5: tool flange along z
  const link5 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 16), linkGreyMaterial);
  link5.position.y = 0.06;
  link5.castShadow = true;
  joint5Pivot.add(link5);

  // Tool / end effector
  const tool0 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), toolMaterial);
  tool0.position.y = 0.16;
  tool0.castShadow = true;
  joint5Pivot.add(tool0);

  scene.add(robotGroup);

  let animationId: number;
  const animate = () => {
    animationId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  const parts: Record<string, THREE.Object3D> = {
    joint1: joint1Pivot,
    joint2: joint2Pivot,
    joint3: joint3Pivot,
    joint4: joint4Pivot,
    joint5: joint5Pivot,
  };

  const applyJointState = (state: JointState) => {
    state.name.forEach((name, index) => {
      const part = parts[name];
      if (part) {
        const value = state.position[index] ?? 0;
        if (name === 'joint1') {
          part.rotation.z = value;
        } else if (name === 'joint2' || name === 'joint3') {
          part.rotation.y = value;
        } else if (name === 'joint4') {
          part.rotation.z = value;
        } else if (name === 'joint5') {
          part.rotation.x = value;
        }
      }
    });
  };

  return {
    scene,
    camera,
    renderer,
    controls,
    robot: robotGroup,
    applyJointState,
    dispose: () => {
      cancelAnimationFrame(animationId);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    },
    resize: () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
  };
}
