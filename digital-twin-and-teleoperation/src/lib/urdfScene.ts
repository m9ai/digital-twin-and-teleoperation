import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
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

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(3, 5, 3);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const grid = new THREE.GridHelper(10, 50, 0x334155, 0x1e293b);
  scene.add(grid);

  const axes = new THREE.AxesHelper(0.5);
  scene.add(axes);

  let robot: THREE.Object3D | null = null;
  let animationId: number;

  const loader = new URDFLoader();
  loader.packages = {
    'robot_description': '/assets',
  };

  return new Promise((resolve, reject) => {
    loader.load(
      urdfUrl,
      (result: THREE.Object3D) => {
        robot = result;
        robot.scale.set(1, 1, 1);
        robot.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        scene.add(robot);

        const applyJointState = (state: JointState) => {
          if (!robot) return;
          const urdfRobot = robot as unknown as { joints: Record<string, { setJointValue: (...values: number[]) => void }> };
          state.name.forEach((jointName, index) => {
            const joint = urdfRobot.joints?.[jointName];
            if (joint && typeof joint.setJointValue === 'function') {
              const value = state.position[index] ?? 0;
              joint.setJointValue(value);
            }
          });
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
      },
      undefined,
      (err: unknown) => reject(err)
    );
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
