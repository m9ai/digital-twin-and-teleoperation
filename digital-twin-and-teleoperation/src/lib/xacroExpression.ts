/**
 * Expression evaluator for `${...}` substitutions inside XACRO files.
 *
 * XACRO expressions are Python expressions, but the subset used by real robot
 * descriptions is small: arithmetic, comparisons, boolean logic and the common
 * `math` functions. A tiny recursive-descent parser keeps this dependency-free
 * and, unlike `eval`, cannot touch anything outside the expression itself.
 *
 * Supported syntax:
 *   - numbers (`1`, `0.35`, `1e-3`), strings (`'x'`, `"y"`), booleans, `pi`
 *   - operators: `+ - * / % **`, unary `-`, `== != < <= > >=`, `and or not`
 *     (and their C spellings `&& || !`)
 *   - ternaries on both sides: `a ? b : c` and `a if cond else b`
 *   - functions: `sin cos tan asin acos atan atan2 sqrt abs floor ceil round
 *     exp log pow min max hypot degrees radians str int float copysign`
 */

export type XacroValue = number | string | boolean;

export type SymbolLookup = (name: string) => XacroValue | undefined;

export class XacroExpressionError extends Error {
  constructor(message: string, readonly source: string) {
    super(message);
    this.name = 'XacroExpressionError';
  }
}

type TokenKind = 'number' | 'string' | 'name' | 'operator';

interface Token {
  kind: TokenKind;
  value: string;
}

/** Longest-first so that `**` wins over `*`, `<=` over `<`, … */
const OPERATORS = [
  '**',
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '(',
  ')',
  ',',
  '?',
  ':',
];

const CONSTANTS: Record<string, XacroValue> = {
  true: true,
  false: false,
  pi: Math.PI,
  PI: Math.PI,
  'xacro.M_PI': Math.PI,
  'math.pi': Math.PI,
  'math.PI': Math.PI,
  e: Math.E,
};

type FunctionImpl = (args: XacroValue[]) => XacroValue;

function toNumber(value: XacroValue): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`无法转换为数字：${String(value)}`);
  }
  return parsed;
}

function single(name: string, fn: (n: number) => number): FunctionImpl {
  return (args) => {
    if (args.length !== 1) throw new Error(`${name}() 需要 1 个参数`);
    return fn(toNumber(args[0]));
  };
}

const FUNCTIONS: Record<string, FunctionImpl> = {
  sin: single('sin', Math.sin),
  cos: single('cos', Math.cos),
  tan: single('tan', Math.tan),
  asin: single('asin', Math.asin),
  acos: single('acos', Math.acos),
  atan: single('atan', Math.atan),
  sqrt: single('sqrt', Math.sqrt),
  abs: single('abs', Math.abs),
  floor: single('floor', Math.floor),
  ceil: single('ceil', Math.ceil),
  degrees: single('degrees', (n) => (n * 180) / Math.PI),
  radians: single('radians', (n) => (n * Math.PI) / 180),
  exp: single('exp', Math.exp),
  log: single('log', Math.log),
  log10: single('log10', Math.log10),
  sign: single('sign', Math.sign),
  str: (args) => args.map((a) => String(a)).join(''),
  int: (args) => Math.trunc(toNumber(args[0])),
  float: (args) => toNumber(args[0]),
  round: (args) => (args.length > 1 ? Number(toNumber(args[0]).toFixed(toNumber(args[1]))) : Math.round(toNumber(args[0]))),
  atan2: (args) => Math.atan2(toNumber(args[0]), toNumber(args[1])),
  pow: (args) => Math.pow(toNumber(args[0]), toNumber(args[1])),
  copysign: (args) => Math.abs(toNumber(args[0])) * Math.sign(toNumber(args[1])),
  hypot: (args) => Math.hypot(...args.map(toNumber)),
  min: (args) => Math.min(...args.map(toNumber)),
  max: (args) => Math.max(...args.map(toNumber)),
  mod: (args) => toNumber(args[0]) % toNumber(args[1]),
  fmod: (args) => toNumber(args[0]) % toNumber(args[1]),
};

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const char = src[i];

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      let value = '';
      i += 1;
      while (i < src.length && src[i] !== char) {
        if (src[i] === '\\' && i + 1 < src.length) {
          value += src[i + 1];
          i += 2;
          continue;
        }
        value += src[i];
        i += 1;
      }
      i += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]*([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      const value = match?.[0] ?? char;
      i += value.length;
      tokens.push({ kind: 'number', value });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
      const value = match?.[0] ?? char;
      i += value.length;
      tokens.push({ kind: 'name', value });
      continue;
    }

    const operator = OPERATORS.find((candidate) => src.startsWith(candidate, i));
    if (operator) {
      i += operator.length;
      tokens.push({ kind: 'operator', value: operator });
      continue;
    }

    throw new XacroExpressionError(`无法识别的字符 “${char}”`, src);
  }

  return tokens;
}

function truthy(value: XacroValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value.length > 0;
}

function compare(a: XacroValue, b: XacroValue, operator: string): boolean {
  if (operator === '==') return a === b;
  if (operator === '!=') return a !== b;
  const left = toNumber(a);
  const right = toNumber(b);
  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    default:
      throw new Error(`不支持的比较运算符 ${operator}`);
  }
}

class ExpressionParser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly lookup: SymbolLookup
  ) {}

  parse(): XacroValue {
    const value = this.ternary();
    if (this.peek()) {
      throw new XacroExpressionError(`多余的内容 “${this.peek()?.value ?? ''}”`, '');
    }
    return value;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private matches(value: string): boolean {
    const token = this.peek();
    return token !== undefined && token.kind === 'operator' && token.value === value;
  }

  private matchesName(value: string): boolean {
    const token = this.peek();
    return token !== undefined && token.kind === 'name' && token.value === value;
  }

  private consumeOperator(value: string): void {
    if (!this.matches(value)) {
      throw new XacroExpressionError(`缺少 “${value}”`, '');
    }
    this.pos += 1;
  }

  private ternary(): XacroValue {
    const condition = this.logicalOr();
    if (this.matches('?')) {
      this.pos += 1;
      const yes = this.ternary();
      this.consumeOperator(':');
      const no = this.ternary();
      return truthy(condition) ? yes : no;
    }
    return condition;
  }

  private logicalOr(): XacroValue {
    let left = this.logicalAnd();
    while (this.matchesName('or') || this.matches('||')) {
      this.pos += 1;
      const right = this.logicalAnd();
      left = truthy(left) ? left : right;
    }
    return left;
  }

  private logicalAnd(): XacroValue {
    let left = this.comparison();
    while (this.matchesName('and') || this.matches('&&')) {
      this.pos += 1;
      const right = this.comparison();
      left = !truthy(left) ? left : right;
    }
    return left;
  }

  private comparison(): XacroValue {
    let left = this.additive();
    for (;;) {
      const token = this.peek();
      if (!token || token.kind !== 'operator') break;
      if (!['==', '!=', '<', '<=', '>', '>='].includes(token.value)) break;
      this.pos += 1;
      left = compare(left, this.additive(), token.value);
    }
    return left;
  }

  private additive(): XacroValue {
    let left = this.multiplicative();
    for (;;) {
      if (this.matches('+')) {
        this.pos += 1;
        const right = this.multiplicative();
        left = (left as number) + (right as number);
        continue;
      }
      if (this.matches('-')) {
        this.pos += 1;
        const right = this.multiplicative();
        left = (left as number) - (right as number);
        continue;
      }
      break;
    }
    return left;
  }

  private multiplicative(): XacroValue {
    let left = this.unary();
    for (;;) {
      if (this.matches('*')) {
        this.pos += 1;
        left = (left as number) * (this.unary() as number);
        continue;
      }
      if (this.matches('/')) {
        this.pos += 1;
        left = (left as number) / (this.unary() as number);
        continue;
      }
      if (this.matches('%')) {
        this.pos += 1;
        left = (left as number) % (this.unary() as number);
        continue;
      }
      break;
    }
    return left;
  }

  private unary(): XacroValue {
    if (this.matches('-')) {
      this.pos += 1;
      return -(this.unary() as number);
    }
    if (this.matches('+')) {
      this.pos += 1;
      return this.unary();
    }
    if (this.matchesName('not') || this.matches('!')) {
      this.pos += 1;
      return !truthy(this.unary());
    }
    return this.power();
  }

  private power(): XacroValue {
    const base = this.primary();
    if (this.matches('**')) {
      this.pos += 1;
      // Right associative, matching Python.
      return Math.pow(base as number, this.power() as number);
    }
    return base;
  }

  private primary(): XacroValue {
    const token = this.peek();
    if (!token) throw new XacroExpressionError('表达式意外结束', '');

    if (token.kind === 'number') {
      this.pos += 1;
      return Number.parseFloat(token.value);
    }

    if (token.kind === 'string') {
      this.pos += 1;
      return token.value;
    }

    if (this.matches('(')) {
      this.pos += 1;
      const value = this.ternary();
      this.consumeOperator(')');
      return value;
    }

    if (token.kind === 'name') {
      this.pos += 1;

      // Python style conditional: `<value> if <cond> else <value>`
      if (this.matchesName('if')) {
        this.pos += 1;
        const condition = this.ternary();
        if (!this.matchesName('else')) {
          throw new XacroExpressionError('条件表达式缺少 else', '');
        }
        this.pos += 1;
        const otherwise = this.ternary();
        return truthy(condition) ? this.resolveSymbol(token.value) : otherwise;
      }

      if (this.matches('(')) {
        this.pos += 1;
        const args: XacroValue[] = [];
        if (!this.matches(')')) {
          for (;;) {
            args.push(this.ternary());
            if (this.matches(',')) {
              this.pos += 1;
              continue;
            }
            break;
          }
        }
        this.consumeOperator(')');
        const fn = FUNCTIONS[token.value];
        if (!fn) throw new XacroExpressionError(`不支持的函数 ${token.value}()`, '');
        return fn(args);
      }

      return this.resolveSymbol(token.value);
    }

    throw new XacroExpressionError(`无法识别的符号 “${token.value}”`, '');
  }

  private resolveSymbol(name: string): XacroValue {
    if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
      return CONSTANTS[name];
    }
    const value = this.lookup(name);
    if (value === undefined) {
      throw new XacroExpressionError(`未定义的符号 “${name}”`, '');
    }
    return value;
  }
}

/**
 * Evaluate one XACRO expression, e.g. `2 * ${?}` bodies like `0.4 / 2 + pi`.
 *
 * `lookup` supplies property / parameter values and is consulted lazily so a
 * property that references another one defined further down still resolves.
 */
export function evaluateExpression(source: string, lookup: SymbolLookup): XacroValue {
  const trimmed = source.trim();
  if (!trimmed) throw new XacroExpressionError('表达式为空', source);
  return new ExpressionParser(tokenize(trimmed), lookup).parse();
}

/** Render an evaluated expression back into URDF text. */
export function stringifyValue(value: XacroValue): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    // Keep output compact so `<origin xyz="${a} ${b} ${c}"/>` stays readable.
    return String(Number.parseFloat(value.toPrecision(12)));
  }
  return value;
}
