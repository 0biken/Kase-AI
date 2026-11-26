import type { SymbolLocation } from '../../correlation/correlation.types';

/**
 * Locates Python handler symbols (`package.module.Qual.name`) in the checked
 * out source, for binding a FastAPI runtime route dump.
 *
 * This is a deliberately small indentation-based scanner, not a Python parser:
 * it recognises `class` and `def` / `async def` headers and rebuilds the
 * `__qualname__` Python itself would report, including `<locals>` for nested
 * functions. Anything it cannot see stays unlocated, and the binder rejects
 * that route instead of guessing a source location.
 */

const HEADER = /^([ \t]*)(?:async[ \t]+)?(def|class)[ \t]+([A-Za-z_][A-Za-z0-9_]*)\b/u;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** `pkg/sub/mod.py` → `pkg.sub.mod`; `pkg/__init__.py` → `pkg`. */
export function pythonModuleName(file: string): string | null {
  if (!file.endsWith('.py')) return null;
  const parts = file.slice(0, -3).split('/');
  if (parts[parts.length - 1] === '__init__') parts.pop();
  if (!parts.length || parts.some(part => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(part))) return null;
  return parts.join('.');
}

export interface PythonSymbol extends SymbolLocation { module: string; qualname: string }

export function scanPythonSymbols(file: string, text: string): PythonSymbol[] {
  const module = pythonModuleName(file);
  if (!module || text.length > MAX_FILE_BYTES) return [];
  const symbols: PythonSymbol[] = [];
  const stack: Array<{ indent: number; kind: 'def' | 'class'; qualname: string }> = [];
  let inString: string | null = null;
  text.split(/\r?\n/u).forEach((line, index) => {
    // Skip the bodies of triple-quoted strings so docstrings never look like code.
    if (inString) { if (line.includes(inString)) inString = null; return; }
    const triple = /("""|''')/u.exec(line);
    if (triple && line.split(triple[1]).length === 2) { inString = triple[1]; }
    const match = HEADER.exec(line);
    if (!match) return;
    const indent = match[1].replace(/\t/gu, '        ').length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    const name = match[3];
    const qualname = !parent ? name : parent.kind === 'def' ? `${parent.qualname}.<locals>.${name}` : `${parent.qualname}.${name}`;
    const kind = match[2] as 'def' | 'class';
    stack.push({ indent, kind, qualname });
    if (kind === 'def') symbols.push({ file, enclosingSymbol: qualname, line: index + 1, module, qualname });
  });
  return symbols;
}

/** Builds a locator over a checkout's Python files: path → contents. */
export function pythonSymbolLocator(files: ReadonlyMap<string, string>): (symbol: string) => SymbolLocation[] {
  const index = new Map<string, SymbolLocation[]>();
  for (const [file, text] of files) for (const found of scanPythonSymbols(file, text)) {
    const key = `${found.module}.${found.qualname}`;
    index.set(key, [...(index.get(key) ?? []), { file: found.file, enclosingSymbol: found.enclosingSymbol, line: found.line }]);
  }
  return symbol => [...(index.get(symbol) ?? [])];
}
