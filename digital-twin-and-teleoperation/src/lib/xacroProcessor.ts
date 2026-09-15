/**
 * XACRO → URDF expansion for the browser.
 *
 * ROS robot descriptions are authored as `.xacro` templates: properties,
 * macros, conditionals and includes that `xacro` resolves on the ROS host
 * before anything downstream sees a plain URDF. Feeding those templates
 * straight to `URDFLoader` fails — `<xacro:property>` / `<xacro:macro>` are not
 * URDF elements and `${...}` never gets evaluated — which is why xacro models
 * used to render as nothing at all.
 *
 * This module implements the subset of XACRO that real robot descriptions use:
 *
 *   - `<xacro:property>` — attribute and body form, global / local scope
 *   - `${...}` expressions — arithmetic, logic, comparisons and common math
 *   - `<xacro:macro>` — positional, defaulted and `*block` parameters plus
 *     `<xacro:insert_block>`
 *   - `<xacro:include>` — resolved against the other files the user uploaded
 *   - `<xacro:if>` / `<xacro:unless>`
 *   - `<xacro:arg>` and `$(arg …)` / `$(find …)` substitution
 *
 * Everything works on the parsed DOM so that comments and element order are
 * preserved; only XACRO constructs are stripped. Problems are collected as
 * warnings rather than thrown, so a partially expanded model still renders and
 * the upload panel can explain what was skipped.
 */

import { evaluateExpression, stringifyValue } from '@/lib/xacroExpression';
import type { SymbolLookup, XacroValue } from '@/lib/xacroExpression';

const XACRO_NS = 'http://www.ros.org/wiki/xacro';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

const TEXT_NODE = 3;
const CDATA_NODE = 4;
const ELEMENT_NODE = 1;

export interface XacroOptions {
  /** Text of every other uploaded model file, keyed by its root-relative path. */
  files?: Record<string, string>;
  /** `$(arg …)` overrides, mirroring `xacro file.xacro name:=value`. */
  args?: Record<string, string>;
}

export interface XacroResult {
  /** Plain URDF text, or the source text when nothing could be expanded. */
  text: string;
  /** Whether any XACRO construct was actually expanded. */
  expanded: boolean;
  /** Non-fatal problems worth surfacing in the UI. */
  warnings: string[];
}

interface Scope {
  parent: Scope | null;
  /** Already evaluated symbol values (properties, macro parameters). */
  values: Map<string, XacroValue>;
  /** `<xacro:insert_block>` payloads grouped by parameter name. */
  blocks: Map<string, Node[][]>;
}

interface MacroParam {
  name: string;
  /** Raw default expression, or null when the caller must supply it. */
  defaultExpr: string | null;
  isBlock: boolean;
}

interface MacroDefinition {
  name: string;
  params: MacroParam[];
  body: Element;
}

function createScope(parent: Scope | null): Scope {
  return {
    parent,
    values: new Map(),
    blocks: new Map(),
  };
}

/**
 * A lot of published `.xacro` files use the `xacro:` prefix without declaring
 * it. `DOMParser` in XML mode rejects that outright, so the missing
 * declarations are injected into the first start tag before parsing.
 */
function ensureNamespaces(text: string): string {
  const declared = new Set<string>();
  for (const match of text.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=/g)) {
    declared.add(match[1]);
  }

  const used = new Set<string>();
  for (const match of text.matchAll(/<([A-Za-z_][\w.-]*):/g)) used.add(match[1]);
  for (const match of text.matchAll(/\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\s*=/g)) {
    used.add(match[1]);
  }

  const missing = [...used].filter((prefix) => !declared.has(prefix));
  if (missing.length === 0) return text;

  const insertAt = findFirstStartTagEnd(text);
  if (insertAt < 0) return text;

  const declarations = missing
    .map((prefix) => ` xmlns:${prefix}="${XACRO_NS}"`)
    .join('');
  return text.slice(0, insertAt) + declarations + text.slice(insertAt);
}

/** Index of the `>` closing the first element start tag (skipping prolog). */
function findFirstStartTagEnd(text: string): number {
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (i >= text.length) return -1;

    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<!', i) || text.startsWith('<?', i)) {
      const end = text.indexOf('>', i);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text[i] !== '<') return -1;

    let quote: string | null = null;
    for (let j = i + 1; j < text.length; j += 1) {
      const char = text[j];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '>') return j;
    }
    return -1;
  }
  return -1;
}

function parseXacroDocument(text: string, warnings: string[], label: string): Document | null {
  const attempt = (source: string): Document | null => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    return doc.querySelector('parsererror') ? null : doc;
  };

  const direct = attempt(text);
  if (direct) return direct;

  const patched = ensureNamespaces(text);
  if (patched !== text) {
    const retried = attempt(patched);
    if (retried) return retried;
  }

  warnings.push(`${label} 不是良构的 XML，无法展开`);
  return null;
}

/** Cheap check used to avoid touching vanilla URDF files at all. */
export function looksLikeXacro(text: string): boolean {
  if (/xmlns:[\w.-]+="[^"]*ros\.org\/wiki\/xacro"/.test(text)) return true;
  return /<[A-Za-z_][\w.-]*:(property|macro|include|insert_block|if|unless|arg)\b/.test(text);
}

/** Split a `params="a b:=2 c:=${x * 2} *origin"` string, keeping `${…}` intact. */
function splitParams(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '$' && raw[i + 1] === '{') {
      depth += 1;
      current += '${';
      i += 1;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth -= 1;
      current += '}';
      continue;
    }
    if (depth === 0 && /\s/.test(char)) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current) parts.push(current);
  return parts;
}

/** index of the `}` closing a `${…}` starting at `open + 2`. */
function findClosingBrace(text: string, from: number): number {
  let depth = 1;
  let quote: string | null = null;

  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

class XacroExpander {
  private readonly macros = new Map<string, MacroDefinition>();
  private readonly rootScope = createScope(null);
  private readonly args = new Map<string, string>();
  private readonly includeStack: string[] = [];
  /** Prefixes bound to the XACRO namespace, discovered from the document. */
  private xacroUsage = 0;

  constructor(
    private readonly doc: Document,
    private readonly files: Record<string, string>,
    args: Record<string, string> | undefined,
    private readonly warnings: string[]
  ) {
    if (args) {
      for (const [key, value] of Object.entries(args)) this.args.set(key, value);
    }
  }

  run(): boolean {
    this.collectMacros(this.doc.documentElement);
    this.processChildren(this.doc.documentElement, this.rootScope);
    return this.xacroUsage > 0;
  }

  private warn(message: string): void {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** Macro definitions are hoisted so that definition order does not matter. */
  private collectMacros(node: Element): void {
    for (const child of Array.from(node.children)) {
      if (this.isXacro(child) && child.localName === 'macro') {
        this.registerMacro(child);
        continue;
      }
      this.collectMacros(child);
    }
  }

  private registerMacro(el: Element): void {
    const name = el.getAttribute('name');
    if (!name) {
      this.warn('发现没有 name 属性的 <xacro:macro>，已忽略');
      return;
    }

    const params: MacroParam[] = [];
    for (const token of splitParams(el.getAttribute('params') ?? '')) {
      if (token.startsWith('**')) {
        this.warn(`宏 ${name} 使用了暂不支持的 **${token.slice(2)} 参数`);
        continue;
      }
      if (token.startsWith('*')) {
        params.push({ name: token.slice(1), defaultExpr: null, isBlock: true });
        continue;
      }
      const assign = token.indexOf(':=');
      if (assign > 0) {
        params.push({
          name: token.slice(0, assign),
          defaultExpr: token.slice(assign + 2),
          isBlock: false,
        });
        continue;
      }
      params.push({ name: token, defaultExpr: null, isBlock: false });
    }

    this.macros.set(name, {
      name,
      params,
      body: el.cloneNode(true) as Element,
    });
  }

  private isXacro(el: Element): boolean {
    return el.namespaceURI === XACRO_NS;
  }

  private processChildren(parent: Element, scope: Scope): void {
    for (const child of Array.from(parent.childNodes)) {
      if (child.parentNode !== parent) continue;
      this.processNode(parent, child, scope);
    }
  }

  private processNode(parent: Node, node: Node, scope: Scope): void {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
      const text = node.textContent;
      if (text && text.includes('$')) {
        node.textContent = this.substitute(text, scope);
      }
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;

    const el = node as Element;

    if (this.isXacro(el)) {
      this.xacroUsage += 1;
      this.processDirective(parent, el, scope);
      return;
    }

    this.substituteAttributes(el, scope);
    this.processChildren(el, scope);
  }

  private processDirective(parent: Node, el: Element, scope: Scope): void {
    switch (el.localName) {
      case 'property':
        this.handleProperty(el, parent, scope);
        return;
      case 'macro':
        // Already hoisted by `collectMacros`.
        parent.removeChild(el);
        return;
      case 'include':
        this.handleInclude(el, parent, scope);
        return;
      case 'insert_block':
        this.handleInsertBlock(el, parent, scope);
        return;
      case 'if':
        this.handleConditional(el, parent, scope, true);
        return;
      case 'unless':
        this.handleConditional(el, parent, scope, false);
        return;
      case 'arg':
        this.handleArg(el, parent);
        return;
      default: {
        const macro = this.macros.get(el.localName);
        if (macro) {
          this.expandMacro(macro, el, parent, scope);
          return;
        }
        this.warn(`不支持的 XACRO 指令 <${el.nodeName}>，已忽略`);
        parent.removeChild(el);
      }
    }
  }

  private handleArg(el: Element, parent: Node): void {
    const name = el.getAttribute('name');
    if (name && !this.args.has(name)) {
      this.args.set(name, el.getAttribute('default') ?? '');
    }
    parent.removeChild(el);
  }

  private handleProperty(el: Element, parent: Node, scope: Scope): void {
    const name = el.getAttribute('name');
    if (!name) {
      this.warn('发现没有 name 属性的 <xacro:property>，已忽略');
      parent.removeChild(el);
      return;
    }

    const rawValue = el.getAttribute('value');
    const expression = rawValue !== null ? rawValue : (el.textContent ?? '');
    const target = el.getAttribute('scope') === 'local' ? scope : this.rootScope;

    // Like `xacro`, the value is evaluated here against whatever is visible
    // now, so ordering matters and a later redefinition simply wins.
    target.values.set(name, this.evaluateValue(expression.trim(), scope));
    parent.removeChild(el);
  }

  /**
   * Turn a raw property / parameter source into a typed value.
   * Whole-string `${…}` stays typed so that `<xyz>` arithmetic keeps working,
   * everything else falls back to textual substitution.
   */
  private evaluateValue(raw: string, scope: Scope): XacroValue {
    if (!raw.includes('$')) {
      const numeric = Number(raw);
      return raw !== '' && Number.isFinite(numeric) ? numeric : raw;
    }

    const single = /^\$\{([\s\S]*)\}$/.exec(raw);
    if (single) {
      try {
        return this.evaluate(single[1], scope);
      } catch (err) {
        this.warn(`表达式 \${${single[1]}} 求值失败：${errorMessage(err)}`);
        return this.substitute(raw, scope);
      }
    }

    return this.substitute(raw, scope);
  }

  private handleConditional(
    el: Element,
    parent: Node,
    scope: Scope,
    positive: boolean
  ): void {
    const raw = el.getAttribute('value');
    let truthy = false;

    if (raw !== null) {
      try {
        truthy = Boolean(this.evaluate(this.substitute(raw, scope), scope));
      } catch (err) {
        this.warn(`<${el.nodeName}> 条件求值失败：${errorMessage(err)}`);
      }
    }

    this.replaceWithChildren(parent, el, positive ? truthy : !truthy, scope);
  }

  private handleInsertBlock(el: Element, parent: Node, scope: Scope): void {
    const name = el.getAttribute('name');
    const groups = name ? scope.blocks.get(name) : undefined;
    const nodes = groups?.shift() ?? [];

    if (name && !groups) {
      this.warn(`<xacro:insert_block name="${name}"> 没有对应的宏参数内容`);
    }

    this.expandBlockInto(parent, el, nodes, scope);
    parent.removeChild(el);
  }

  private handleInclude(el: Element, parent: Node, scope: Scope): void {
    const raw = el.getAttribute('filename') ?? '';
    const filename = this.substitute(raw, scope);
    const content = this.findIncludedFile(filename);

    if (!content) {
      this.warn(`未能找到 <xacro:include filename="${filename}"> 引用的文件`);
      parent.removeChild(el);
      return;
    }

    if (this.includeStack.includes(filename)) {
      this.warn(`检测到循环 <xacro:include>（${filename}），已跳过`);
      parent.removeChild(el);
      return;
    }

    const label = `<xacro:include filename="${filename}">`;
    const includeDoc = parseXacroDocument(content, this.warnings, label);
    if (!includeDoc) {
      parent.removeChild(el);
      return;
    }

    this.includeStack.push(filename);
    try {
      const root = includeDoc.documentElement;
      this.collectMacros(root);
      this.pullChildrenInto(parent, el, root, scope);
    } finally {
      this.includeStack.pop();
    }

    parent.removeChild(el);
  }

  private findIncludedFile(filename: string): string | null {
    const normalized = this.normalizePath(filename);
    if (!normalized) return null;

    const entries = Object.entries(this.files);
    const key = normalized.toLowerCase();

    const exact = entries.find(([path]) => normalizeSlashes(path).toLowerCase() === key);
    if (exact) return exact[1];

    const suffix = entries.find(([path]) =>
      normalizeSlashes(path).toLowerCase().endsWith(`/${key}`)
    );
    if (suffix) return suffix[1];

    const basename = key.split('/').pop() ?? '';
    const byName = entries.find(
      ([path]) => normalizeSlashes(path).split('/').pop()?.toLowerCase() === basename
    );
    return byName ? byName[1] : null;
  }

  /** `$(find pkg)/a/b.xacro` and `package://pkg/a/b.xacro` → `pkg/a/b.xacro`. */
  private normalizePath(reference: string): string {
    let path = reference.trim();
    path = path.replace(/\$\(\s*find\s+([^)]+)\)/g, '$1');
    path = path.replace(/^package:\/\//i, '');
    return normalizeSlashes(path).replace(/^\.?\//, '');
  }

  private expandMacro(
    macro: MacroDefinition,
    callEl: Element,
    parent: Node,
    callSiteScope: Scope
  ): void {
    const scope = createScope(callSiteScope);
    const supplied = new Map<string, string>();

    for (const attr of Array.from(callEl.attributes)) {
      if (attr.namespaceURI === XMLNS_NS) continue;
      supplied.set(attr.name, attr.value);
    }

    for (const param of macro.params) {
      if (param.isBlock) continue;
      const raw = supplied.get(param.name);
      if (raw !== undefined) {
        supplied.delete(param.name);
        // Arguments are evaluated in the caller's context, exactly like xacro.
        scope.values.set(param.name, this.evaluateValue(raw, callSiteScope));
        continue;
      }
      if (param.defaultExpr !== null) {
        scope.values.set(param.name, this.evaluateValue(param.defaultExpr, callSiteScope));
        continue;
      }
      this.warn(`宏 <${macro.name}> 缺少必需参数 ${param.name}`);
      scope.values.set(param.name, '');
    }

    for (const param of macro.params) {
      if (!param.isBlock) continue;
      // `*param` carries the caller's child element itself, so that
      // `<xacro:foo><origin xyz="0 0 0"/></xacro:foo>` inserts `<origin/>`.
      const groups = Array.from(callEl.children)
        .filter((child) => child.localName === param.name)
        .map((child) => [child]);
      scope.blocks.set(param.name, groups);
    }

    for (const name of supplied.keys()) {
      this.warn(`宏 <${macro.name}> 收到了未声明的参数 ${name}，已忽略`);
    }

    this.copyChildrenInto(parent, callEl, macro.body.childNodes, scope);
    parent.removeChild(callEl);
  }

  /**
   * Move `source` children into `parent` before `anchor`, expanding whatever
   * XACRO constructs they contain first. Nodes may live in another document
   * (macros hoisted out of an `<xacro:include>`), hence the import.
   */
  private copyChildrenInto(
    parent: Node,
    anchor: Node,
    source: ArrayLike<Node>,
    scope: Scope
  ): void {
    const doc = this.doc;
    const holder = doc.createElement('xacro-fragment');
    for (const node of Array.from(source)) {
      holder.appendChild(doc.importNode(node, true));
    }
    this.processChildren(holder, scope);
    while (holder.firstChild) {
      parent.insertBefore(holder.firstChild, anchor);
    }
  }

  private pullChildrenInto(
    parent: Node,
    anchor: Node,
    sourceRoot: Element,
    scope: Scope
  ): void {
    this.copyChildrenInto(parent, anchor, sourceRoot.childNodes, scope);
  }

  private expandBlockInto(parent: Node, anchor: Node, nodes: Node[], scope: Scope): void {
    const doc = this.doc;
    const holder = doc.createElement('xacro-fragment');
    for (const node of nodes) {
      holder.appendChild(doc.importNode(node, true));
    }
    this.processChildren(holder, scope);
    while (holder.firstChild) {
      parent.insertBefore(holder.firstChild, anchor);
    }
  }

  /** Inline a kept `<xacro:if>` / `<xacro:unless>` body where the tag stood. */
  private replaceWithChildren(
    parent: Node,
    el: Element,
    keep: boolean,
    scope: Scope
  ): void {
    if (!keep) {
      parent.removeChild(el);
      return;
    }
    this.processChildren(el, scope);
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  }

  private substituteAttributes(el: Element, scope: Scope): void {
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI === XMLNS_NS) continue;
      if (attr.value.includes('$')) {
        attr.value = this.substitute(attr.value, scope);
      }
    }
  }

  /**
   * Replace every `$(…)` command and `${…}` expression in a piece of text.
   * Failures are reported as warnings and left untouched so that the rest of
   * the model can still be built.
   */
  private substitute(text: string, scope: Scope): string {
    let output = '';
    let index = 0;

    while (index < text.length) {
      const dollar = text.indexOf('$', index);
      if (dollar < 0 || dollar === text.length - 1) {
        output += text.slice(index);
        break;
      }

      output += text.slice(index, dollar);
      const next = text[dollar + 1];

      if (next === '(') {
        const end = text.indexOf(')', dollar + 2);
        if (end < 0) {
          output += text.slice(dollar);
          break;
        }
        output += this.evaluateCommand(text.slice(dollar + 2, end));
        index = end + 1;
        continue;
      }

      if (next === '{') {
        const end = findClosingBrace(text, dollar + 2);
        if (end < 0) {
          output += text.slice(dollar);
          break;
        }
        const expression = text.slice(dollar + 2, end);
        try {
          output += stringifyValue(this.evaluate(expression, scope));
        } catch (err) {
          this.warn(`表达式 \${${expression}} 求值失败：${errorMessage(err)}`);
          output += text.slice(dollar, end + 1);
        }
        index = end + 1;
        continue;
      }

      output += '$';
      index = dollar + 1;
    }

    return output;
  }

  /** `$(arg name)`, `$(find pkg)`, `$(env VAR)`, `$(optenv VAR default)`. */
  private evaluateCommand(body: string): string {
    const parts = body.trim().split(/\s+/);
    const command = parts[0];

    switch (command) {
      case 'arg':
        return this.args.get(parts[1] ?? '') ?? '';
      case 'find':
        // Keep `package://` so the mesh resolver recognises it downstream.
        return `package://${parts[1] ?? ''}`;
      case 'optenv':
        return parts[2] ?? '';
      case 'env':
        return '';
      default:
        this.warn(`不支持的替换命令 $(${body.trim()})`);
        return '';
    }
  }

  private evaluate(expression: string, scope: Scope): XacroValue {
    return evaluateExpression(expression, this.lookupFor(scope));
  }

  /** Symbol resolution walks the scope chain outwards to the globals. */
  private lookupFor(scope: Scope): SymbolLookup {
    return (name: string): XacroValue | undefined => {
      let cursor: Scope | null = scope;
      while (cursor) {
        const value = cursor.values.get(name);
        if (value !== undefined) return value;
        cursor = cursor.parent;
      }
      return undefined;
    };
  }
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Expand a XACRO document into plain URDF text.
 *
 * Never throws: on failure the source is returned unchanged alongside a
 * warning so that the caller can still surface the original problem (usually
 * through `validateURDF` in the editor).
 */
export function expandXacro(source: string, options: XacroOptions = {}): XacroResult {
  const warnings: string[] = [];

  if (!looksLikeXacro(source)) {
    return { text: source, expanded: false, warnings };
  }

  try {
    const doc = parseXacroDocument(source, warnings, '模型文件');
    if (!doc) {
      return { text: source, expanded: false, warnings };
    }

    const expander = new XacroExpander(doc, options.files ?? {}, options.args, warnings);
    const expanded = expander.run();
    const text = new XMLSerializer().serializeToString(doc);
    return { text, expanded, warnings };
  } catch (err) {
    warnings.push(`XACRO 展开失败：${errorMessage(err)}`);
    return { text: source, expanded: false, warnings };
  }
}
