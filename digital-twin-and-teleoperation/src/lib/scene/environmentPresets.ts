import * as THREE from 'three';
import type { EnvironmentPresetId, SceneBackgroundId, SceneLightingConfig } from '@/types';

/**
 * Procedural environments.
 *
 * Real deployments never happen on an empty grid: robots are bolted to a
 * workshop floor, roll through a corridor, or drive down a street. Shipping a
 * set of generated scenes makes the twin readable without asking the operator
 * to hunt for a reference model first, and every solid prop is registered as
 * an obstacle so the safety scan can warn about the environment too.
 *
 * Everything is authored in metres, Y-up, with the robot base at the origin —
 * matching the Three.js convention already used by the URDF loader.
 */

export interface EnvironmentPresetMeta {
  id: EnvironmentPresetId;
  label: string;
  hint: string;
}

export const ENVIRONMENT_PRESETS: EnvironmentPresetMeta[] = [
  { id: 'none', label: '空场景', hint: '仅坐标网格' },
  { id: 'workshop', label: '车间', hint: '安全围栏 / 工作台 / 货架' },
  { id: 'room', label: '房间', hint: '墙体 / 门窗 / 家具' },
  { id: 'street', label: '街道', hint: '车道 / 人行道 / 路灯' },
  { id: 'lab', label: '实验室', hint: '光学平台 / 机柜 / 白板' },
];

export const DEFAULT_SCENE_MOOD_ID: EnvironmentPresetId = 'none';

export interface EnvironmentMood {
  background: SceneBackgroundId;
  lighting: SceneLightingConfig;
  /** Reference grid edge length that suits the scale of the scene. */
  gridSize: number;
  /** Distance fog hides the finite floor edge; colour tracks the backdrop. */
  fog: { color: number; near: number; far: number } | null;
}

export const ENVIRONMENT_MOODS: Record<EnvironmentPresetId, EnvironmentMood> = {
  none: {
    background: 'studio',
    gridSize: 10,
    fog: null,
    lighting: {
      azimuthDeg: 45,
      elevationDeg: 42,
      intensity: 1.6,
      ambient: 0.45,
      envMap: true,
      envIntensity: 0.5,
      exposure: 1,
      shadows: true,
    },
  },
  workshop: {
    background: 'studio',
    gridSize: 20,
    fog: { color: 0x111827, near: 18, far: 60 },
    lighting: {
      azimuthDeg: 38,
      elevationDeg: 55,
      intensity: 2.2,
      ambient: 0.35,
      envMap: true,
      envIntensity: 0.7,
      exposure: 1.05,
      shadows: true,
    },
  },
  room: {
    background: 'daylight',
    gridSize: 8,
    fog: null,
    lighting: {
      azimuthDeg: 55,
      elevationDeg: 35,
      intensity: 1.5,
      ambient: 0.6,
      envMap: true,
      envIntensity: 0.95,
      exposure: 1.1,
      shadows: true,
    },
  },
  street: {
    background: 'daylight',
    gridSize: 30,
    fog: { color: 0xcbd5e1, near: 30, far: 95 },
    lighting: {
      azimuthDeg: 25,
      elevationDeg: 28,
      intensity: 2.6,
      ambient: 0.55,
      envMap: true,
      envIntensity: 1,
      exposure: 1.05,
      shadows: true,
    },
  },
  lab: {
    background: 'daylight',
    gridSize: 10,
    fog: null,
    lighting: {
      azimuthDeg: 60,
      elevationDeg: 58,
      intensity: 1.8,
      ambient: 0.65,
      envMap: true,
      envIntensity: 1,
      exposure: 1,
      shadows: true,
    },
  },
};

/* ------------------------------------------------------------------ *
 * Material palette
 * ------------------------------------------------------------------ */

const PALETTE = {
  epoxy: () => new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.55, metalness: 0.2 }),
  concrete: () => new THREE.MeshStandardMaterial({ color: 0x4b5158, roughness: 0.95, metalness: 0.04 }),
  asphalt: () => new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.98, metalness: 0.02 }),
  pavement: () => new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.88, metalness: 0.03 }),
  tile: () => new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.7, metalness: 0.05 }),
  wall: () => new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.92, metalness: 0 }),
  ceiling: () => new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.95, metalness: 0 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.35, metalness: 0.85 }),
  steelDark: () => new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.48, metalness: 0.7 }),
  hazard: () => new THREE.MeshStandardMaterial({ color: 0xd9a406, roughness: 0.6, metalness: 0.2 }),
  machineBlue: () => new THREE.MeshStandardMaterial({ color: 0x1e5aa8, roughness: 0.45, metalness: 0.45 }),
  cabinet: () => new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.5 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6, metalness: 0.05 }),
  roadPaint: () =>
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.7, metalness: 0, emissive: 0x94a3b8, emissiveIntensity: 0.06 }),
  cone: () => new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7, metalness: 0.05 }),
  foliage: () => new THREE.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.9, metalness: 0 }),
  trunk: () => new THREE.MeshStandardMaterial({ color: 0x6b4b2e, roughness: 0.95, metalness: 0 }),
  glass: () =>
    new THREE.MeshStandardMaterial({
      color: 0xbfe3ff,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    }),
  rug: () => new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 1, metalness: 0 }),
  lampOn: () =>
    new THREE.MeshStandardMaterial({
      color: 0xfff8e7,
      emissive: 0xffe9b0,
      emissiveIntensity: 1.6,
      roughness: 0.4,
      metalness: 0,
    }),
} as const;

/* ------------------------------------------------------------------ *
 * Builder helper
 * ------------------------------------------------------------------ */

type Vec3 = [number, number, number];

/** Max number of static props exposed to the proximity scan per environment. */
const MAX_OBSTACLES = 48;

class SceneBuilder {
  readonly group = new THREE.Group();
  readonly obstacles: THREE.Object3D[] = [];

  private add<T extends THREE.Object3D>(object: T, name: string, obstacle: boolean): T {
    object.name = name;
    this.group.add(object);
    if (obstacle && this.obstacles.length < MAX_OBSTACLES) this.obstacles.push(object);
    return object;
  }

  box(options: {
    name: string;
    size: Vec3;
    pos: Vec3;
    material: THREE.Material;
    obstacle?: boolean;
    rot?: Vec3;
    cast?: boolean;
  }): THREE.Mesh {
    const { name, size, pos, material, obstacle = true, rot, cast = true } = options;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    return this.add(mesh, name, obstacle);
  }

  cylinder(options: {
    name: string;
    radius: number;
    height: number;
    pos: Vec3;
    material: THREE.Material;
    radiusTop?: number;
    obstacle?: boolean;
    rot?: Vec3;
    segments?: number;
  }): THREE.Mesh {
    const {
      name,
      radius,
      height,
      pos,
      material,
      radiusTop,
      obstacle = true,
      rot,
      segments = 20,
    } = options;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radiusTop ?? radius, radius, height, segments),
      material
    );
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.add(mesh, name, obstacle);
  }

  sphere(options: {
    name: string;
    radius: number;
    pos: Vec3;
    material: THREE.Material;
    obstacle?: boolean;
  }): THREE.Mesh {
    const { name, radius, pos, material, obstacle = true } = options;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return this.add(mesh, name, obstacle);
  }

  /** Horizontal plane (floor / ceiling / zebra stripes). Never an obstacle. */
  plane(options: {
    name: string;
    size: [number, number];
    pos: Vec3;
    material: THREE.Material;
    receive?: boolean;
  }): THREE.Mesh {
    const { name, size, pos, material, receive = true } = options;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.receiveShadow = receive;
    mesh.castShadow = false;
    return this.add(mesh, name, false);
  }

  /** A named sub-assembly, e.g. a whole workbench treated as one obstacle. */
  makeGroup(name: string, obstacle: boolean): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 0, 0);
    this.add(group, name, obstacle);
    return group;
  }

  /** Parent to `$group` instead of the scene root, keeping the hierarchy tidy. */
  into<T extends THREE.Object3D>(parent: THREE.Object3D, object: T): T {
    parent.add(object);
    return object;
  }

  finalize(name: string): void {
    this.group.name = name;
    this.group.updateMatrixWorld(true);
    // Static scenery: skip per-frame matrix recomposition for every prop.
    this.group.traverse((object) => {
      if (object !== this.group) object.matrixAutoUpdate = false;
    });
  }
}

/* ------------------------------------------------------------------ *
 * Shared props
 * ------------------------------------------------------------------ */

/** Workbench: welded steel frame + MDF top + lower shelf. */
function buildBench(builder: SceneBuilder, center: Vec3, rotY: number) {
  const bench = builder.makeGroup(`bench@${center[0]},${center[2]}`, true);
  bench.position.set(center[0], 0, center[2]);
  bench.rotation.y = rotY;

  const steel = PALETTE.steelDark();
  const top = new THREE.MeshStandardMaterial({ color: 0x2f6f4f, roughness: 0.65, metalness: 0.1 });

  for (const [dx, dz] of [
    [-0.7, -0.35],
    [0.7, -0.35],
    [-0.7, 0.35],
    [0.7, 0.35],
  ] as Array<[number, number]>) {
    builder.into(
      bench,
      builder.box({
        name: 'bench_leg',
        size: [0.06, 0.78, 0.06],
        pos: [dx, 0.39, dz],
        material: steel,
        obstacle: false,
      })
    );
  }

  builder.into(
    bench,
    builder.box({
      name: 'bench_top',
      size: [1.6, 0.06, 0.9],
      pos: [0, 0.81, 0],
      material: top,
      obstacle: false,
    })
  );

  builder.into(
    bench,
    builder.box({
      name: 'bench_shelf',
      size: [1.5, 0.04, 0.8],
      pos: [0, 0.25, 0],
      material: steel,
      obstacle: false,
    })
  );
}

/** Pallet + cartons, the classic logistics props of a shop floor. */
function buildPallet(builder: SceneBuilder, center: Vec3) {
  const pallet = builder.makeGroup(`pallet@${center[0]},${center[2]}`, true);
  pallet.position.set(center[0], 0, center[2]);

  const wood = new THREE.MeshStandardMaterial({ color: 0xa1703f, roughness: 0.9, metalness: 0 });
  const carton = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.9, metalness: 0 });

  builder.into(
    pallet,
    builder.box({
      name: 'pallet_deck',
      size: [1.2, 0.14, 0.9],
      pos: [0, 0.07, 0],
      material: wood,
      obstacle: false,
    })
  );

  for (const [dx, dz, h] of [
    [-0.3, -0.2, 0.35],
    [0.3, -0.2, 0.35],
    [0, 0.25, 0.55],
  ] as Array<[number, number, number]>) {
    builder.into(
      pallet,
      builder.box({
        name: 'carton',
        size: [0.45, h, 0.4],
        pos: [dx, 0.14 + h / 2, dz],
        material: carton,
        obstacle: false,
      })
    );
  }
}

/** Street lamp: pole, curved arm and an emissive luminaire head. */
function buildStreetLamp(builder: SceneBuilder, center: Vec3, facing: number) {
  const lamp = builder.makeGroup(`lamp@${center[0]},${center[2]}`, true);
  lamp.position.set(center[0], 0, center[2]);
  lamp.rotation.y = facing;

  builder.into(
    lamp,
    builder.cylinder({
      name: 'lamp_pole',
      radius: 0.06,
      height: 5,
      pos: [0, 2.5, 0],
      material: PALETTE.steelDark(),
      obstacle: false,
    })
  );

  builder.into(
    lamp,
    builder.cylinder({
      name: 'lamp_arm',
      radius: 0.05,
      height: 1.1,
      pos: [0.5, 4.95, 0],
      material: PALETTE.steelDark(),
      rot: [0, 0, Math.PI / 2],
      obstacle: false,
    })
  );

  builder.into(
    lamp,
    builder.box({
      name: 'lamp_head',
      size: [0.7, 0.14, 0.3],
      pos: [1.0, 4.86, 0],
      material: PALETTE.lampOn(),
      obstacle: false,
    })
  );
}

/** Deciduous tree: trunk + two offset foliage globes. */
function buildTree(builder: SceneBuilder, center: Vec3, scale = 1) {
  const tree = builder.makeGroup(`tree@${center[0]},${center[2]}`, true);
  tree.position.set(center[0], 0, center[2]);
  tree.scale.setScalar(scale);

  builder.into(
    tree,
    builder.cylinder({
      name: 'tree_trunk',
      radius: 0.12,
      height: 2.2,
      pos: [0, 1.1, 0],
      material: PALETTE.trunk(),
      obstacle: false,
    })
  );

  const foliage = PALETTE.foliage();
  builder.into(
    tree,
    builder.sphere({ name: 'tree_crown', radius: 1.1, pos: [0, 2.9, 0], material: foliage, obstacle: false })
  );
  builder.into(
    tree,
    builder.sphere({ name: 'tree_crown', radius: 0.85, pos: [0.7, 2.3, 0.4], material: foliage, obstacle: false })
  );
}

/** Traffic cone with a reflective collar. */
function buildCone(builder: SceneBuilder, center: Vec3) {
  const cone = builder.makeGroup(`cone@${center[0]},${center[2]}`, true);
  cone.position.set(center[0], 0, center[2]);

  builder.into(
    cone,
    builder.box({
      name: 'cone_base',
      size: [0.42, 0.05, 0.42],
      pos: [0, 0.025, 0],
      material: PALETTE.cone(),
      obstacle: false,
    })
  );

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 18), PALETTE.cone());
  body.name = 'cone_body';
  body.position.set(0, 0.34, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  builder.into(cone, body);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.155, 0.07, 18), PALETTE.roadPaint());
  collar.name = 'cone_collar';
  collar.position.set(0, 0.36, 0);
  builder.into(cone, collar);
}

/* ------------------------------------------------------------------ *
 * Environments
 * ------------------------------------------------------------------ */

export interface EnvironmentBuild {
  /** Static scenery added under the environment rig. */
  objects: THREE.Group;
  /** Props eligible for the robot proximity scan. */
  obstacles: THREE.Object3D[];
  fog: THREE.Fog | null;
}

function buildEmpty(): EnvironmentBuild {
  return { objects: new THREE.Group(), obstacles: [], fog: null };
}

function buildWorkshop(): EnvironmentBuild {
  const b = new SceneBuilder();

  b.plane({ name: 'floor', size: [26, 26], pos: [0, 0, 0], material: PALETTE.epoxy() });

  // Yellow safety hatch marking the robot cell footprint.
  const HATCH = 3.2;
  for (const [dx, dz, w, d] of [
    [0, -HATCH, HATCH * 2 + 0.1, 0.1],
    [0, HATCH, HATCH * 2 + 0.1, 0.1],
    [-HATCH, 0, 0.1, HATCH * 2 + 0.1],
    [HATCH, 0, 0.1, HATCH * 2 + 0.1],
  ] as Array<[number, number, number, number]>) {
    b.box({
      name: 'safety_line',
      size: [w, 0.012, d],
      pos: [dx, 0.006, dz],
      material: PALETTE.hazard(),
      obstacle: false,
      cast: false,
    });
  }

  // Perimeter safety fence around the cell (9 m x 9 m).
  const FENCE = 4.5;
  const fenceMat = PALETTE.hazard();
  for (const [idx, angle] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) {
    const rail = new THREE.Group();
    rail.name = `fence_${idx}`;
    rail.rotation.y = angle;
    rail.position.set(Math.sin(angle) * FENCE, 0, Math.cos(angle) * FENCE);
    b.into(b.group, rail);

    const post = (offsetX: number) =>
      b.into(
        rail,
        b.box({
          name: 'fence_post',
          size: [0.08, 1.6, 0.08],
          pos: [offsetX, 0.8, 0],
          material: fenceMat,
          obstacle: false,
        })
      );
    post(-4.5);
    post(0);
    post(4.5);

    const meshPanel = new THREE.Mesh(
      new THREE.BoxGeometry(9, 1.4, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0xd9a406,
        roughness: 0.5,
        metalness: 0.35,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    meshPanel.name = 'fence_mesh';
    meshPanel.position.set(0, 0.85, 0);
    meshPanel.receiveShadow = true;
    b.into(rail, meshPanel);
  }
  // The four fence runs form one logical obstacle each.
  for (const idx of [0, 1, 2, 3]) {
    const rail = b.group.getObjectByName(`fence_${idx}`);
    if (rail && b.obstacles.length < MAX_OBSTACLES) b.obstacles.push(rail);
  }

  // Two workbenches, racks, pallets and a neighbouring machine base.
  buildBench(b, [-5.2, 0, 2.4], Math.PI / 2);
  buildBench(b, [5.0, 0, -3.2], -Math.PI / 2);
  buildPallet(b, [4.2, 0, 4.6]);
  buildPallet(b, [-6.4, 0, -4.8]);

  const rack = b.makeGroup('rack', true);
  const rackSteel = PALETTE.steel();
  for (const dx of [-1.2, 1.2]) {
    for (const dz of [-0.3, 0.3]) {
      b.into(
        rack,
        b.box({
          name: 'rack_post',
          size: [0.07, 2.4, 0.07],
          pos: [dx, 1.2, dz],
          material: rackSteel,
          obstacle: false,
        })
      );
    }
  }
  for (const y of [0.05, 0.85, 1.65]) {
    b.into(
      rack,
      b.box({
        name: 'rack_shelf',
        size: [2.5, 0.05, 0.75],
        pos: [0, y, 0],
        material: rackSteel,
        obstacle: false,
      })
    );
  }
  rack.position.set(-7.4, 0, 5.6);

  const neighbour = b.makeGroup('machine_base', true);
  b.into(
    neighbour,
    b.cylinder({
      name: 'machine_pedestal',
      radius: 0.45,
      height: 0.5,
      pos: [0, 0.25, 0],
      material: PALETTE.machineBlue(),
      obstacle: false,
    })
  );
  b.into(
    neighbour,
    b.box({
      name: 'machine_body',
      size: [0.9, 1.1, 0.9],
      pos: [0, 1.05, 0],
      material: PALETTE.machineBlue(),
      obstacle: false,
    })
  );
  neighbour.position.set(7.6, 0, 5.2);

  // Ceiling luminaires: emissive panels only, lighting comes from the rig.
  const luminaire = PALETTE.lampOn();
  for (const [x, z] of [
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ] as Array<[number, number]>) {
    b.box({
      name: 'luminaire',
      size: [1.4, 0.08, 0.4],
      pos: [x, 4.6, z],
      material: luminaire,
      obstacle: false,
      cast: false,
    });
  }

  b.finalize('env_workshop');
  return { objects: b.group, obstacles: b.obstacles, fog: null };
}

function buildRoom(): EnvironmentBuild {
  const b = new SceneBuilder();
  const W = 9;
  const H = 3;

  b.plane({ name: 'floor', size: [W, W], pos: [0, 0, 0], material: PALETTE.tile() });
  b.plane({
    name: 'ceiling',
    size: [W, W],
    pos: [0, H, 0],
    material: PALETTE.ceiling(),
    receive: false,
  });

  const wallMat = PALETTE.wall();
  const T = 0.12;

  // South wall (solid), north wall split by a doorway at x = 2.6 .. 3.8.
  b.box({ name: 'wall_south', size: [W, H, T], pos: [0, H / 2, -W / 2], material: wallMat });
  b.box({
    name: 'wall_north_left',
    size: [5.2, H, T],
    pos: [(-W / 2 + 5.2 / 2), H / 2, W / 2],
    material: wallMat,
  });
  b.box({
    name: 'wall_north_right',
    size: [3.8, H, T],
    pos: [(W / 2 - 3.8 / 2), H / 2, W / 2],
    material: wallMat,
  });
  b.box({ name: 'lintel', size: [1.2, 0.9, T], pos: [3.2, H - 0.45, W / 2], material: wallMat });
  // Door leaf, slightly ajar.
  b.box({
    name: 'door',
    size: [1.1, 2.1, 0.06],
    pos: [2.55, 1.05, W / 2 + 0.55],
    material: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.75, metalness: 0.05 }),
    rot: [0, -0.45, 0],
  });

  // East / west walls; the west wall carries a window opening.
  b.box({ name: 'wall_east', size: [T, H, W], pos: [W / 2, H / 2, 0], material: wallMat });
  b.box({
    name: 'wall_west_lower',
    size: [T, 1.0, W],
    pos: [-W / 2, 0.5, 0],
    material: wallMat,
  });
  b.box({
    name: 'wall_west_upper',
    size: [T, 0.6, W],
    pos: [-W / 2, H - 0.3, 0],
    material: wallMat,
  });
  for (const dz of [-2.9, 2.9]) {
    b.box({
      name: 'wall_west_jamb',
      size: [T, H, 1.8],
      pos: [-W / 2, H / 2, dz],
      material: wallMat,
    });
  }
  b.box({
    name: 'window_glass',
    size: [0.04, 1.4, 5.6],
    pos: [-W / 2, 1.7, 0],
    material: PALETTE.glass(),
    obstacle: false,
    cast: false,
  });

  // Furniture: rug, sofa-like bench, desk with a monitor, plant.
  b.plane({
    name: 'rug',
    size: [3.6, 2.6],
    pos: [0, 0.01, 1.2],
    material: PALETTE.rug(),
  });

  const desk = b.makeGroup('desk', true);
  const deskMat = new THREE.MeshStandardMaterial({ color: 0xb08b57, roughness: 0.65, metalness: 0.05 });
  b.into(desk, b.box({ name: 'desk_top', size: [1.8, 0.06, 0.8], pos: [0, 0.74, 0], material: deskMat, obstacle: false }));
  for (const [dx, dz] of [
    [-0.82, -0.34],
    [0.82, -0.34],
    [-0.82, 0.34],
    [0.82, 0.34],
  ] as Array<[number, number]>) {
    b.into(
      desk,
      b.box({ name: 'desk_leg', size: [0.07, 0.72, 0.07], pos: [dx, 0.36, dz], material: deskMat, obstacle: false })
    );
  }
  desk.position.set(-2.9, 0, -2.6);
  desk.rotation.y = Math.PI / 2;
  desk.updateMatrix();

  b.box({
    name: 'monitor',
    size: [0.08, 0.42, 0.72],
    pos: [-2.62, 1.02, -2.6],
    material: PALETTE.steelDark(),
    rot: [0, Math.PI / 2, 0],
  });

  const chair = b.makeGroup('chair', true);
  const chairMat = PALETTE.cabinet();
  b.into(chair, b.box({ name: 'chair_seat', size: [0.5, 0.07, 0.5], pos: [0, 0.46, 0], material: chairMat, obstacle: false }));
  b.into(chair, b.box({ name: 'chair_back', size: [0.5, 0.55, 0.07], pos: [0, 0.74, -0.22], material: chairMat, obstacle: false }));
  chair.position.set(-2.0, 0, -1.2);
  chair.rotation.y = -0.6;
  chair.updateMatrix();

  b.box({
    name: 'bookshelf',
    size: [1.2, 1.9, 0.35],
    pos: [3.9, 0.95, -3.6],
    material: PALETTE.cabinet(),
  });

  const plant = b.makeGroup('planter', true);
  b.into(
    plant,
    b.cylinder({
      name: 'pot',
      radiusTop: 0.24,
      radius: 0.18,
      height: 0.4,
      pos: [0, 0.2, 0],
      material: new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.85, metalness: 0.05 }),
      obstacle: false,
    })
  );
  b.into(plant, b.sphere({ name: 'plant_crown', radius: 0.42, pos: [0, 0.7, 0], material: PALETTE.foliage(), obstacle: false }));
  plant.position.set(-3.4, 0, 3.4);

  b.box({
    name: 'ceiling_lamp',
    size: [0.9, 0.06, 0.9],
    pos: [0, H - 0.08, 0],
    material: PALETTE.lampOn(),
    obstacle: false,
    cast: false,
  });

  b.finalize('env_room');
  return { objects: b.group, obstacles: b.obstacles, fog: null };
}

function buildStreet(): EnvironmentBuild {
  const b = new SceneBuilder();
  const LANE = 8;
  const LENGTH = 60;

  b.plane({ name: 'road', size: [LANE, LENGTH], pos: [0, 0, 0], material: PALETTE.asphalt() });

  // Sidewalks (curb included: the box is raised 0.16 m above the carriageway).
  for (const side of [-1, 1]) {
    b.box({
      name: 'sidewalk',
      size: [4, 0.16, LENGTH],
      pos: [side * (LANE / 2 + 2), 0.08, 0],
      material: PALETTE.pavement(),
      obstacle: true,
    });
  }

  // Lane markings: dashed centre line + solid edge lines.
  const paint = PALETTE.roadPaint();
  for (let z = -LENGTH / 2 + 2; z < LENGTH / 2 - 1; z += 6) {
    b.box({
      name: 'lane_dash',
      size: [0.16, 0.006, 2.4],
      pos: [0, 0.004, z],
      material: paint,
      obstacle: false,
      cast: false,
    });
  }
  for (const side of [-1, 1]) {
    b.box({
      name: 'lane_edge',
      size: [0.12, 0.006, LENGTH - 2],
      pos: [side * (LANE / 2 - 0.35), 0.004, 0],
      material: paint,
      obstacle: false,
      cast: false,
    });
  }

  // Zebra crossing across the carriageway ahead of the robot.
  for (let i = 0; i < 8; i++) {
    b.box({
      name: 'zebra',
      size: [0.6, 0.006, 3.4],
      pos: [-LANE / 2 + 0.6 + i * 0.95, 0.004, 9],
      material: paint,
      obstacle: false,
      cast: false,
    });
  }

  // Street furniture: lamps, trees, cones, bollards.
  for (let i = -2; i <= 2; i++) {
    buildStreetLamp(b, [-(LANE / 2 + 1.2), 0, i * 13], Math.PI / 2);
    buildStreetLamp(b, [LANE / 2 + 1.2, 0, i * 13 + 6.5], -Math.PI / 2);
  }
  for (let i = -2; i <= 2; i++) {
    buildTree(b, [-(LANE / 2 + 3.2), 0, i * 14 + 7], 0.9 + (i % 2 === 0 ? 0.2 : 0.35));
    buildTree(b, [LANE / 2 + 3.2, 0, i * 14], 0.9 + (i % 2 === 0 ? 0.3 : 0.15));
  }
  buildCone(b, [-1.6, 0, 6]);
  buildCone(b, [0, 0, 6.6]);
  buildCone(b, [1.6, 0, 6]);

  for (const side of [-1, 1]) {
    for (let i = -3; i <= 3; i++) {
      b.cylinder({
        name: 'bollard',
        radius: 0.05,
        height: 0.9,
        pos: [side * (LANE / 2 + 0.35), 0.45, i * 6.5 + 3],
        material: PALETTE.steel(),
        obstacle: true,
      });
    }
  }

  // Bus stop shelter on the far sidewalk: open frame + glazed back panel.
  const shelter = b.makeGroup('bus_shelter', true);
  const frame = PALETTE.steelDark();
  for (const dx of [-1.4, 1.4]) {
    b.into(
      shelter,
      b.box({ name: 'shelter_post', size: [0.08, 2.4, 0.08], pos: [dx, 1.2, -0.6], material: frame, obstacle: false })
    );
    b.into(
      shelter,
      b.box({ name: 'shelter_post', size: [0.08, 2.4, 0.08], pos: [dx, 1.2, 0.6], material: frame, obstacle: false })
    );
  }
  b.into(
    shelter,
    b.box({ name: 'shelter_roof', size: [3.1, 0.1, 1.5], pos: [0, 2.45, 0], material: frame, obstacle: false })
  );
  b.into(
    shelter,
    b.box({ name: 'shelter_glass', size: [3.1, 2.2, 0.05], pos: [0, 1.2, -0.62], material: PALETTE.glass(), obstacle: false, cast: false })
  );
  shelter.position.set(6.4, 0.16, -12);
  shelter.rotation.y = Math.PI / 2;
  shelter.updateMatrix();

  b.finalize('env_street');
  return { objects: b.group, obstacles: b.obstacles, fog: null };
}

function buildLab(): EnvironmentBuild {
  const b = new SceneBuilder();
  const W = 10;
  const H = 3.2;

  b.plane({ name: 'floor', size: [W, W], pos: [0, 0, 0], material: PALETTE.concrete() });
  b.plane({ name: 'ceiling', size: [W, W], pos: [0, H, 0], material: PALETTE.ceiling(), receive: false });

  const wallMat = PALETTE.wall();
  const T = 0.12;
  b.box({ name: 'wall_south', size: [W, H, T], pos: [0, H / 2, -W / 2], material: wallMat });
  b.box({ name: 'wall_north', size: [W, H, T], pos: [0, H / 2, W / 2], material: wallMat });
  b.box({ name: 'wall_west', size: [T, H, W], pos: [-W / 2, H / 2, 0], material: wallMat });

  // Cleanroom panel joints: thin dark strips every 2.5 m.
  const joint = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6, metalness: 0.2 });
  for (const x of [-2.5, 0, 2.5]) {
    b.box({ name: 'panel_joint', size: [0.02, H, W], pos: [x, H / 2, 0], material: joint, obstacle: false, cast: false });
  }

  // Optical breadboard: steel honeycomb table on four legs.
  const table = b.makeGroup('optical_table', true);
  const steelTop = new THREE.MeshStandardMaterial({ color: 0x707a86, roughness: 0.32, metalness: 0.9 });
  b.into(
    table,
    b.box({ name: 'breadboard', size: [2.4, 0.1, 1.2], pos: [0, 0.8, 0], material: steelTop, obstacle: false })
  );
  for (const [dx, dz] of [
    [-1.1, -0.5],
    [1.1, -0.5],
    [-1.1, 0.5],
    [1.1, 0.5],
  ] as Array<[number, number]>) {
    b.into(
      table,
      b.box({ name: 'table_leg', size: [0.08, 0.75, 0.08], pos: [dx, 0.375, dz], material: PALETTE.steelDark(), obstacle: false })
    );
  }
  table.position.set(-3.2, 0, -1.4);
  table.rotation.y = Math.PI / 6;
  table.updateMatrix();

  // Instrument cabinet + equipment rack + whiteboard.
  b.box({ name: 'cabinet', size: [0.9, 1.8, 0.6], pos: [3.9, 0.9, -4.0], material: PALETTE.cabinet() });
  b.box({
    name: 'equipment_rack',
    size: [0.6, 1.6, 0.8],
    pos: [4.2, 0.8, 2.6],
    material: PALETTE.steelDark(),
  });
  b.box({
    name: 'whiteboard',
    size: [3.2, 1.4, 0.06],
    pos: [-1.5, 1.7, -W / 2 + 0.1],
    material: PALETTE.white(),
  });

  // Mobile cart with casters.
  const cart = b.makeGroup('cart', true);
  for (const y of [0.3, 0.75]) {
    b.into(
      cart,
      b.box({ name: 'cart_shelf', size: [1.1, 0.05, 0.6], pos: [0, y, 0], material: PALETTE.steel(), obstacle: false })
    );
  }
  for (const [dx, dz] of [
    [-0.48, -0.24],
    [0.48, -0.24],
    [-0.48, 0.24],
    [0.48, 0.24],
  ] as Array<[number, number]>) {
    b.into(
      cart,
      b.cylinder({ name: 'cart_post', radius: 0.025, height: 0.8, pos: [dx, 0.4, dz], material: PALETTE.steelDark(), obstacle: false })
    );
  }
  cart.position.set(2.6, 0, 1.4);
  cart.rotation.y = -0.8;
  cart.updateMatrix();

  const luminaire = PALETTE.lampOn();
  for (const z of [-3, 0, 3]) {
    b.box({
      name: 'luminaire',
      size: [4.6, 0.08, 0.35],
      pos: [0, H - 0.1, z],
      material: luminaire,
      obstacle: false,
      cast: false,
    });
  }

  b.finalize('env_lab');
  return { objects: b.group, obstacles: b.obstacles, fog: null };
}

const BUILDERS: Record<EnvironmentPresetId, () => EnvironmentBuild> = {
  none: buildEmpty,
  workshop: buildWorkshop,
  room: buildRoom,
  street: buildStreet,
  lab: buildLab,
};

export function buildEnvironment(id: EnvironmentPresetId): EnvironmentBuild {
  const build = (BUILDERS[id] ?? buildEmpty)();
  const mood = ENVIRONMENT_MOODS[id] ?? ENVIRONMENT_MOODS[DEFAULT_SCENE_MOOD_ID];
  return {
    ...build,
    fog: mood.fog ? new THREE.Fog(mood.fog.color, mood.fog.near, mood.fog.far) : null,
  };
}

/** Recursively release geometries / materials of a generated scene. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose?.();
  });
}
