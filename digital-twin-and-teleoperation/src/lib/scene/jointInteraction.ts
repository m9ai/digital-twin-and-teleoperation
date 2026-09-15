import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { findLinkName } from '@/lib/scene/materials';
import { clampToJointLimits, type URDFJointDefinition, type URDFLinkDefinition } from '@/lib/urdfJoints';

/**
 * Live information about the joint/link the user is hovering or dragging.
 */
export interface JointSelectionInfo {
  jointName: string;
  jointType: string;
  linkName: string;
  parentLinkName: string;
  mass: number;
  value: number;
  lower: number;
  upper: number;
  unit: 'rad' | 'm';
  /** Viewport coordinate of the pointer for the inspector card. */
  screenX: number;
  screenY: number;
  /** World-space position of the hovered link origin. */
  position: THREE.Vector3;
  /** World-space orientation of the hovered link. */
  orientation: THREE.Quaternion;
}

export interface JointInteractionOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  robot: THREE.Object3D;
  /** Parsed movable joints. */
  joints: URDFJointDefinition[];
  /** Parsed link metadata (mass, etc.). */
  links: URDFLinkDefinition[];
  controls: OrbitControls;
  /** Called when the pointer hovers over / leaves a joint-driven link. */
  onHover: (info: JointSelectionInfo | null) => void;
  /** Called when the user starts dragging a joint. */
  onSelect: (info: JointSelectionInfo | null) => void;
  /** Called while dragging so the UI can mirror the value. */
  onChange?: (jointName: string, value: number) => void;
  /** Called once when the drag ends so consumers can publish the target. */
  onDragEnd?: (jointName: string, value: number) => void;
}

export interface JointInteractionHandles {
  dispose: () => void;
  setEnabled: (enabled: boolean) => void;
}

const HIGHLIGHT_COLOR = 0x0ea5e9;

/**
 * Hover to inspect a joint, drag horizontally to jog it.
 *
 * - Pointer hover: highlight the link and show an inspector card.
 * - Pointer down on a highlighted link: start dragging and lock the card position.
 * - Horizontal drag: change the joint value (revolute = radians, prismatic = metres).
 * - Pointer up: end drag, publish the final target.
 * - Pointer leaves the model: hide the card unless a drag is still active.
 */
export function createJointInteraction(options: JointInteractionOptions): JointInteractionHandles {
  const { domElement, camera, robot, joints, links, controls, onHover, onSelect, onChange, onDragEnd } =
    options;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const linkMassByName = new Map(links.map((l) => [l.name, l.mass]));
  const jointByChild = new Map(joints.map((j) => [j.child, j]));

  let enabled = true;
  let hoveredJointName: string | null = null;
  let selectedJointName: string | null = null;
  let dragging = false;
  let dragStartX = 0;
  let dragStartValue = 0;
  let dragJoint: { setJointValue: (...values: number[]) => void; angle?: number } | null = null;
  let lastScreenX = 0;
  let lastScreenY = 0;

  const highlightedMaterials = new Map<THREE.Material, THREE.Color>();

  const urdfJoints = (robot as unknown as {
    joints: Record<string, { setJointValue: (...values: number[]) => void; angle?: number }>;
  }).joints;

  function clearHighlight() {
    for (const [material, original] of highlightedMaterials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.copy(original);
      }
    }
    highlightedMaterials.clear();
  }

  function highlightLink(linkName: string) {
    clearHighlight();
    const link = (robot as unknown as { links?: Record<string, THREE.Object3D> }).links?.[linkName];
    if (!link) return;

    link.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (material instanceof THREE.MeshStandardMaterial && !highlightedMaterials.has(material)) {
          highlightedMaterials.set(material, material.emissive.clone());
          material.emissive.setHex(HIGHLIGHT_COLOR);
        }
      }
    });
  }

  function findJointFromIntersection(intersect: THREE.Intersection): URDFJointDefinition | null {
    const linkName = findLinkName(intersect.object as THREE.Mesh, robot);
    if (!linkName) return null;
    return jointByChild.get(linkName) ?? null;
  }

  function buildSelectionInfo(
    joint: URDFJointDefinition,
    screenX: number,
    screenY: number
  ): JointSelectionInfo | null {
    const urdfJoint = urdfJoints?.[joint.name];
    if (!urdfJoint) return null;

    const link = (robot as unknown as { links?: Record<string, THREE.Object3D> }).links?.[joint.child];
    if (!link) return null;

    robot.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    const orientation = new THREE.Quaternion();
    link.getWorldPosition(position);
    link.getWorldQuaternion(orientation);

    return {
      jointName: joint.name,
      jointType: joint.type,
      linkName: joint.child,
      parentLinkName: joint.parent,
      mass: linkMassByName.get(joint.child) ?? 0,
      value: urdfJoint.angle ?? 0,
      lower: joint.lower,
      upper: joint.upper,
      unit: joint.type === 'prismatic' ? 'm' : 'rad',
      screenX,
      screenY,
      position,
      orientation,
    };
  }

  function emitHover() {
    if (!hoveredJointName) {
      onHover(null);
      return;
    }
    const joint = joints.find((j) => j.name === hoveredJointName);
    if (!joint) {
      onHover(null);
      return;
    }
    const info = buildSelectionInfo(joint, lastScreenX, lastScreenY);
    if (info) onHover(info);
  }

  function emitSelection() {
    if (!selectedJointName) {
      onSelect(null);
      return;
    }
    const joint = joints.find((j) => j.name === selectedJointName);
    if (!joint) {
      onSelect(null);
      return;
    }
    const info = buildSelectionInfo(joint, lastScreenX, lastScreenY);
    if (info) onSelect(info);
  }

  function setJointValue(jointName: string, rawValue: number) {
    const jointDef = joints.find((j) => j.name === jointName);
    const urdfJoint = urdfJoints?.[jointName];
    if (!urdfJoint || typeof urdfJoint.setJointValue !== 'function') return;

    const value = jointDef ? clampToJointLimits(jointDef, rawValue) : rawValue;
    urdfJoint.setJointValue(value);
    robot.updateMatrixWorld(true);
  }

  function raycastJoint(event: PointerEvent): URDFJointDefinition | null {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster
      .intersectObject(robot, true)
      .filter((hit) => hit.object.visible && (hit.object as THREE.Mesh).isMesh);

    if (hits.length === 0) return null;
    return findJointFromIntersection(hits[0]);
  }

  function onPointerMove(event: PointerEvent) {
    if (!enabled) return;

    lastScreenX = event.clientX;
    lastScreenY = event.clientY;

    if (dragging && selectedJointName && dragJoint) {
      const jointDef = joints.find((j) => j.name === selectedJointName);
      if (!jointDef) return;

      const dx = event.clientX - dragStartX;
      const scale = jointDef.type === 'prismatic' ? 0.0002 : 0.005;
      const value = dragStartValue + dx * scale;
      setJointValue(selectedJointName, value);
      onChange?.(selectedJointName, urdfJoints?.[selectedJointName]?.angle ?? value);
      emitSelection();
      return;
    }

    // Hover mode: only react when no button is pressed.
    if (event.buttons !== 0) return;

    const joint = raycastJoint(event);
    if (!joint) {
      if (hoveredJointName) {
        hoveredJointName = null;
        clearHighlight();
        onHover(null);
      }
      return;
    }

    if (hoveredJointName !== joint.name) {
      hoveredJointName = joint.name;
      highlightLink(joint.child);
    }
    emitHover();
  }

  function onPointerDown(event: PointerEvent) {
    if (!enabled) return;

    lastScreenX = event.clientX;
    lastScreenY = event.clientY;

    const joint = raycastJoint(event);
    if (!joint) {
      selectedJointName = null;
      hoveredJointName = null;
      clearHighlight();
      onSelect(null);
      onHover(null);
      return;
    }

    selectedJointName = joint.name;
    hoveredJointName = joint.name;
    highlightLink(joint.child);

    dragJoint = urdfJoints?.[joint.name] ?? null;
    if (dragJoint) {
      dragging = true;
      dragStartX = event.clientX;
      dragStartValue = dragJoint.angle ?? 0;
      controls.enabled = false;
      domElement.setPointerCapture(event.pointerId);
    }

    emitHover();
    emitSelection();
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    controls.enabled = true;
    if (domElement.hasPointerCapture(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
    if (selectedJointName && dragJoint) {
      const value = dragJoint.angle ?? 0;
      onChange?.(selectedJointName, value);
      onDragEnd?.(selectedJointName, value);
    }
  }

  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);

  return {
    dispose: () => {
      clearHighlight();
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerUp);
    },
    setEnabled: (next) => {
      enabled = next;
      if (!enabled) {
        dragging = false;
        controls.enabled = true;
        hoveredJointName = null;
        selectedJointName = null;
        clearHighlight();
        onHover(null);
        onSelect(null);
      }
    },
  };
}
