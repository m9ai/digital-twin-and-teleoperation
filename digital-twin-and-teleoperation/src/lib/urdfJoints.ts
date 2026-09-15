/**
 * URDF joint parsing & XML validation.
 *
 * The digital twin needs to know which joints are movable and what their
 * limits are so that the jog panel can build sliders with the correct range
 * instead of an arbitrary [-Pi, Pi] guess.
 */

export type URDFJointType =
  | 'revolute'
  | 'continuous'
  | 'prismatic'
  | 'fixed'
  | 'floating'
  | 'planar';

export interface URDFJointDefinition {
  name: string;
  type: URDFJointType;
  lower: number;
  upper: number;
  velocity: number;
  effort: number;
  axis: [number, number, number];
  /** Link that is the reference frame for this joint. */
  parent: string;
  /** Link moved by this joint (the one the user clicks on). */
  child: string;
}

export interface URDFLinkDefinition {
  name: string;
  /** Kilograms from the first <inertial><mass>. */
  mass: number;
}

export interface URDFValidationResult {
  ok: boolean;
  message: string | null;
  line: number | null;
}

const MOVABLE_TYPES: URDFJointType[] = ['revolute', 'continuous', 'prismatic'];
const DEFAULT_LIMIT = Math.PI;

function toNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toAxis(value: string | null): [number, number, number] {
  if (!value) return [0, 0, 1];
  const parts = value.trim().split(/\s+/).map(Number.parseFloat);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
    return [0, 0, 1];
  }
  return [parts[0], parts[1], parts[2]];
}

/**
 * Validate that `text` is well-formed XML whose root element is <robot>.
 * Returns the offending line number when the browser parser reports one so
 * that the editor can surface a precise error.
 */
export function validateURDF(text: string): URDFValidationResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, message: 'URDF 内容为空', line: null };
  }
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<robot')) {
    return {
      ok: false,
      message: 'URDF 必须以 <?xml ...?> 声明或 <robot> 根标签开头',
      line: 1,
    };
  }

  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    const raw = parserError.textContent ?? 'XML 语法错误';
    const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? raw;
    const lineMatch = /line\s*(?:number\s*)?(\d+)/i.exec(raw);
    return {
      ok: false,
      message: firstLine.trim(),
      line: lineMatch ? Number.parseInt(lineMatch[1], 10) : null,
    };
  }

  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'robot') {
    return { ok: false, message: `根元素必须是 <robot>，当前为 <${root?.nodeName ?? '?'}>` , line: 1 };
  }

  return { ok: true, message: null, line: null };
}

function toLinkRef(value: string | null): string {
  return value?.trim() ?? '';
}

/**
 * Extract every movable joint (revolute / continuous / prismatic) with its
 * URDF <limit> range. Fixed, floating and planar joints are ignored because
 * they cannot be jogged.
 */
export function parseJointDefinitions(text: string): URDFJointDefinition[] {
  const validation = validateURDF(text);
  if (!validation.ok) return [];

  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const jointNodes = Array.from(doc.querySelectorAll('joint'));
  const joints: URDFJointDefinition[] = [];

  for (const node of jointNodes) {
    const name = node.getAttribute('name');
    if (!name) continue;

    const type = (node.getAttribute('type') ?? 'fixed').toLowerCase() as URDFJointType;
    if (!MOVABLE_TYPES.includes(type)) continue;

    const limitNode = node.querySelector('limit');
    const isContinuous = type === 'continuous';

    const parent = toLinkRef(node.querySelector('parent')?.getAttribute('link') ?? null);
    const child = toLinkRef(node.querySelector('child')?.getAttribute('link') ?? null);

    joints.push({
      name,
      type,
      lower: isContinuous ? -DEFAULT_LIMIT : toNumber(limitNode?.getAttribute('lower') ?? null, -DEFAULT_LIMIT),
      upper: isContinuous ? DEFAULT_LIMIT : toNumber(limitNode?.getAttribute('upper') ?? null, DEFAULT_LIMIT),
      velocity: toNumber(limitNode?.getAttribute('velocity') ?? null, 1),
      effort: toNumber(limitNode?.getAttribute('effort') ?? null, 10),
      axis: toAxis(node.querySelector('axis')?.getAttribute('xyz') ?? null),
      parent,
      child,
    });
  }

  return joints;
}

/**
 * Extract link metadata needed for the interactive model inspector.
 */
export function parseLinkDefinitions(text: string): URDFLinkDefinition[] {
  const validation = validateURDF(text);
  if (!validation.ok) return [];

  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const linkNodes = Array.from(doc.querySelectorAll('link'));
  const links: URDFLinkDefinition[] = [];

  for (const node of linkNodes) {
    const name = node.getAttribute('name');
    if (!name) continue;

    const massNode = node.querySelector('inertial mass');
    const mass = toNumber(massNode?.getAttribute('value') ?? null, 0);

    links.push({ name, mass });
  }

  return links;
}

export function clampToJointLimits(joint: URDFJointDefinition, value: number): number {
  const min = Math.min(joint.lower, joint.upper);
  const max = Math.max(joint.lower, joint.upper);
  if (max === min) return joint.lower;
  return Math.min(max, Math.max(min, value));
}
