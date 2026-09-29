import { Node, Project, SyntaxKind, type ClassDeclaration, type MethodDeclaration } from 'ts-morph';
import * as path from 'node:path';
import { symbolKey, type ResolvedRoute, type SymbolGraph, type SymbolLocation } from './correlation.types';
import { normalizeRoutePath } from './route-resolution';

const HTTP_DECORATORS = new Map(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options'].map(name => [name, name.toUpperCase()]));

function location(method: MethodDeclaration, root: string): SymbolLocation {
  const file = path.relative(root, method.getSourceFile().getFilePath()).replace(/\\/gu, '/');
  if (file.startsWith('../') || path.isAbsolute(file)) throw new Error('Symbol is outside the source root');
  return { file, enclosingSymbol: `${method.getParentIfKindOrThrow(SyntaxKind.ClassDeclaration).getName()}.${method.getName()}`, line: method.getStartLineNumber() };
}

function literalArgument(decorator: import('ts-morph').Decorator): string | undefined {
  const args = decorator.getArguments();
  if (!args.length) return '';
  return args.length === 1 && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : undefined;
}

export function nestStaticRoutes(project: Project, root: string): ResolvedRoute[] {
  const routes: ResolvedRoute[] = [];
  for (const file of project.getSourceFiles()) {
    const imported = new Map<string, string>();
    for (const statement of file.getImportDeclarations()) {
      if (statement.getModuleSpecifierValue() !== '@nestjs/common') continue;
      for (const binding of statement.getNamedImports()) imported.set(binding.getAliasNode()?.getText() ?? binding.getName(), binding.getName());
    }
    for (const cls of file.getClasses()) {
      const controller = cls.getDecorators().find(decorator => imported.get(decorator.getName()) === 'Controller');
      if (!controller || !cls.getName()) continue;
      const prefix = literalArgument(controller);
      if (prefix === undefined) continue;
      for (const method of cls.getMethods()) for (const decorator of method.getDecorators()) {
        const verb = HTTP_DECORATORS.get(imported.get(decorator.getName()) ?? '');
        if (!verb) continue;
        const suffix = literalArgument(decorator);
        if (suffix === undefined) continue;
        const routePath = '/' + [prefix, suffix].filter(Boolean).map(part => part.replace(/^\/+|\/+$/gu, '')).join('/');
        try { normalizeRoutePath(routePath); } catch { continue; }
        const handler = location(method, root);
        routes.push({ id: JSON.stringify([verb, routePath, symbolKey(handler)]), method: verb, pathTemplate: routePath, handler, source: 'static_parse' });
        if (routes.length > 5000) throw new Error('Route count limit exceeded');
      }
    }
  }
  return routes.sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolves a declared constructor type via its module binding, never a global class-name search. */
function injectedClass(cls: ClassDeclaration, property: string): ClassDeclaration | undefined {
  const parameter = cls.getConstructors()[0]?.getParameters().find(item => item.getName() === property && item.isParameterProperty());
  if (!parameter) return undefined;
  const type = parameter.getTypeNode();
  if (!type) return undefined;
  // Custom provider tokens/factories cannot be established by static type analysis.
  if (parameter.getDecorators().length) return undefined;
  const symbol = type.getType().getSymbol();
  const declarations = symbol?.getDeclarations().filter(Node.isClassDeclaration) ?? [];
  return declarations.length === 1 ? declarations[0] : undefined;
}

export function buildNestGraph(project: Project, root: string, route: ResolvedRoute,
  limits = { maxDepth: 8, maxNodes: 256, maxCalls: 4096 }): SymbolGraph | undefined {
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value >= 1)) throw new Error('Invalid graph limits');
  // ts-morph's in-memory filesystem is POSIX even on Windows. Compare
  // root-relative keys instead of passing a host drive path into that filesystem.
  const file = project.getSourceFiles().find(source => path.relative(root, source.getFilePath()).replace(/\\/gu, '/') === route.handler.file.replace(/\\/gu, '/'));
  const matches = file?.getClasses().flatMap(cls => cls.getMethods()).filter(method => symbolKey(location(method, root)) === symbolKey(route.handler)) ?? [];
  if (matches.length !== 1) return undefined;
  const handler = location(matches[0], root);
  const graph: SymbolGraph = { handler, reachable: [{ ...handler, depth: 0, path: [symbolKey(handler)] }], truncated: false };
  const seen = new Set([symbolKey(handler)]);
  const queue = [{ method: matches[0], depth: 0, path: [symbolKey(handler)] }];
  let calls = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    const cls = current.method.getParentIfKindOrThrow(SyntaxKind.ClassDeclaration);
    for (const call of current.method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (++calls > limits.maxCalls) { graph.truncated = true; return graph; }
      // A nested function declaration is not proof that its body executes.
      if (call.getFirstAncestor(node => Node.isMethodDeclaration(node) || Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) !== current.method) continue;
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) continue;
      const receiver = callee.getExpression();
      let targetClass: ClassDeclaration | undefined;
      if (receiver.getKind() === SyntaxKind.ThisKeyword) targetClass = cls;
      else if (Node.isPropertyAccessExpression(receiver) && receiver.getExpression().getKind() === SyntaxKind.ThisKeyword) targetClass = injectedClass(cls, receiver.getName());
      const target = targetClass?.getMethod(callee.getName());
      if (!target) continue;
      let source: SymbolLocation;
      try { source = location(target, root); } catch { continue; }
      const key = symbolKey(source);
      if (seen.has(key)) continue;
      if (current.depth >= limits.maxDepth || seen.size >= limits.maxNodes) { graph.truncated = true; continue; }
      seen.add(key);
      const next = { method: target, depth: current.depth + 1, path: [...current.path, key] };
      graph.reachable.push({ ...source, depth: next.depth, path: next.path });
      queue.push(next);
    }
  }
  return graph;
}
