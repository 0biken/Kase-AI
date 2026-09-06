import ts from 'typescript';

export function resolveEnclosingSymbol(sourceText: string, fileName: string, line: number): string {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const position = source.getPositionOfLineAndCharacter(Math.max(0, line - 1), 0);
  let best: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getFullStart() <= position && node.getEnd() >= position) {
      if (isNamedScope(node)) best = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(source);
  if (!best) return '<module>';
  const method = nameOf(best);
  let parent = best.parent;
  while (parent && !ts.isClassDeclaration(parent)) parent = parent.parent;
  const className = parent && ts.isClassDeclaration(parent) ? parent.name?.text : undefined;
  return className && method ? `${className}.${method}` : method ?? className ?? '<anonymous>';
}

function isNamedScope(node: ts.Node): boolean {
  return ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function nameOf(node: ts.Node): string | undefined {
  if ('name' in node && node.name && ts.isIdentifier(node.name as ts.Node)) return (node.name as ts.Identifier).text;
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return undefined;
}
