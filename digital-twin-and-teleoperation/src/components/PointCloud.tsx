import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Cloud, Pause, Play } from 'lucide-react';

const POINT_COUNT = 20000;

function generatePoints(): Float32Array {
  const positions = new Float32Array(POINT_COUNT * 3);
  const colors = new Float32Array(POINT_COUNT * 3);
  const radius = 4;

  for (let i = 0; i < POINT_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * Math.cbrt(Math.random());

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const intensity = Math.random();
    colors[i * 3] = intensity * 0.2 + 0.1;
    colors[i * 3 + 1] = intensity * 0.4 + 0.4;
    colors[i * 3 + 2] = intensity * 0.2 + 0.6;
  }

  return positions;
}

export function PointCloud() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
    camera.position.set(5, 3, 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    const geometry = new THREE.BufferGeometry();
    const positions = generatePoints();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const colors = new Float32Array(POINT_COUNT * 3);
    for (let i = 0; i < POINT_COUNT; i++) {
      const intensity = Math.random();
      colors[i * 3] = intensity * 0.2 + 0.1;
      colors[i * 3 + 1] = intensity * 0.4 + 0.4;
      colors[i * 3 + 2] = intensity * 0.2 + 0.6;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);
    pointsRef.current = points;

    const axes = new THREE.AxesHelper(0.5);
    scene.add(axes);

    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!pointsRef.current || !running) return;
      const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < POINT_COUNT; i++) {
        positions[i * 3 + 1] += Math.sin(Date.now() / 1000 + i) * 0.002;
      }
      pointsRef.current.geometry.attributes.position.needsUpdate = true;
    }, 50);

    return () => window.clearInterval(interval);
  }, [running]);

  return (
    <div className="panel flex flex-1 flex-col min-h-[240px]">
      <div className="panel-title">
        <Cloud className="h-4 w-4" />
        <span>LiDAR Point Cloud</span>
      </div>
      <div className="relative flex-1 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <div ref={containerRef} className="absolute inset-0" />
        <button
          onClick={() => setRunning((r) => !r)}
          className="btn btn-secondary absolute bottom-2 right-2 p-2"
          title={running ? 'Pause animation' : 'Resume animation'}
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
