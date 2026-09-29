import { lstat, realpath, readdir, readFile } from 'fs/promises';
import { resolve, relative, isAbsolute, join } from 'path';

export async function safeSourceFile(root: string, file: string): Promise<string> {
  if (isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.split(/[\\/]/).includes('..') || file.includes('\0')) throw new Error('Source path outside checkout');
  if (file.split(/[\\/]/).some(part => part.startsWith('.') || ['node_modules', 'vendor', 'dist'].includes(part)) || !/\.(ts|tsx|js|jsx|py|json|yaml|yml|go|java|rb|rs)$/.test(file)) throw new Error('Only repository source files are readable');
  const base = await realpath(root);
  const candidate = resolve(base, file);
  if (!inside(base, candidate)) throw new Error('Source path outside checkout');
  let cursor = base;
  for (const part of relative(base, candidate).split(/[\\/]/)) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic links are not readable source');
  }
  const actual = await realpath(candidate);
  if (!inside(base, actual)) throw new Error('Source path outside checkout');
  const stat = await lstat(actual);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Source file is not bounded text');
  return actual;
}
function inside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
export async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let visited = 0;
  async function walk(dir: string, depth: number) {
    if (depth > 20) throw new Error('Source tree exceeds depth limit');
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (++visited > 20000) throw new Error('Source tree exceeds entry limit');
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'vendor'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (/\.(ts|tsx|js|jsx|py|json|yaml|yml|go|java|rb|rs)$/.test(entry.name)) files.push(file);
    }
  }
  await walk('', 0);
  return files.sort();
}
export async function readSource(root: string, file: string): Promise<string> {
  const text = await readFile(await safeSourceFile(root, file), 'utf8');
  if (text.includes('\0')) throw new Error('Binary source is forbidden');
  return text;
}
