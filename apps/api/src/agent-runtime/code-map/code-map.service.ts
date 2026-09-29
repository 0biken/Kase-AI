import { EvidenceCaptureService } from '../../evidence/evidence-capture.service';
import { readSource, sourceFiles } from './source-safety';
import { readFile, realpath } from 'fs/promises';
import { deterministicId } from '../../findings/finding-persistence.service';
import { Injectable, Logger } from '@nestjs/common';
import { Project, SyntaxKind, ClassDeclaration, MethodDeclaration, SourceFile } from 'ts-morph';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { buildNestGraph, nestStaticRoutes } from '../../correlation/nest-source-graph';

export interface RouteMapping {
  method: string;
  pathTemplate: string;
  framework: 'nestjs' | 'fastapi';
  handlerSymbol: string;
  controllerClass: string;
  handlerMethod: string;
}

export interface SourceLocation {
  file: string;
  enclosingSymbol: string;
  line: number;
}

export interface CallEdge {
  fromSymbol: string;
  toSymbol: string;
  via: string;
  location: SourceLocation;
}

export interface CodeMapEntry {
  handlerSymbol: string;
  handlerLocation: SourceLocation;
  chain: CallEdge[];
  reachableSymbols: string[];
}

const MAX_DEPTH = 4;

@Injectable()
export class CodeMapService {
  private readonly logger = new Logger(CodeMapService.name);

  constructor(private readonly prisma: PrismaService) {}


  async checkoutRoot(auditId: string, projectId: string): Promise<string> {
    const audit = await this.prisma.audit.findFirst({ where: { id: auditId, projectId }, include: { buildProvenance: true } });
    const sha = audit?.buildProvenance?.commitSha;
    if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Audit commit unavailable');
    const root = await realpath(path.resolve(process.env.KASE_CHECKOUT_ROOT ?? path.join(process.cwd(), '.kase-checkouts')));
    const checkout = await realpath(path.join(root, sha.toLowerCase()));
    if (path.relative(root, checkout) !== sha.toLowerCase()) throw new Error('Checkout escapes root');
    if ((await readFile(path.join(checkout, '.kase-complete'), 'utf8')).trim() !== sha.toLowerCase()) throw new Error('Checkout provenance mismatch');
    return checkout;
  }
  async routes(auditId: string, projectId: string) {
    return (await this.prisma.codeMap.findFirst({ where: { auditId, projectId }, include: { routeMappings: { take: 300 } } }))?.routeMappings ?? [];
  }
  async source(auditId: string, projectId: string, args: { file: string; symbol?: string; maxLines: number }) {
    const lines = (await readSource(await this.checkoutRoot(auditId, projectId), args.file)).split('\n');
    const found = args.symbol ? lines.findIndex(line => line.includes(args.symbol!.split('.').pop()!)) : 0;
    if (found < 0) throw new Error('Symbol not found');
    const start = Math.max(0, found - Math.floor(args.maxLines / 4));
    return { file: args.file, startLine: start + 1, source: new EvidenceCaptureService().capture(auditId, lines.slice(start, start + args.maxLines).join('\n'), { maxBytes: 65536 }).bytes.toString('utf8') };
  }
  async search(auditId: string, projectId: string, args: { query: string; maxResults: number }) {
    const root = await this.checkoutRoot(auditId, projectId);
    const results: Array<{file: string; line: number; excerpt: string}> = [];
    let bytes = 0;
    for (const file of await sourceFiles(root)) {
      const text = await readSource(root, file);
      bytes += Buffer.byteLength(text);
      if (bytes > 20 * 1024 * 1024) throw new Error('Search exceeds byte limit');
      for (const [index, line] of text.split('\n').entries()) {
        if (line.includes(args.query)) results.push({ file, line: index + 1, excerpt: new EvidenceCaptureService().capture(auditId, line, { maxBytes: 500 }).bytes.toString('utf8') });
        if (results.length >= args.maxResults) return results;
      }
    }
    return results;
  }
  async buildForAudit(auditId: string, projectId: string, repositoryId: string, commitSha: string, checkout: string) {
    const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
    let bytes = 0;
    for (const file of await sourceFiles(checkout)) {
      if (!/\.tsx?$/.test(file)) continue;
      const text = await readSource(checkout, file);
      bytes += Buffer.byteLength(text);
      if (bytes > 20 * 1024 * 1024) throw new Error('Code map exceeds byte limit');
      project.createSourceFile('/' + file.split(path.sep).join('/'), text);
    }
    const mappings = nestStaticRoutes(project, '/').map(route => {
      const graph = buildNestGraph(project, '/', route);
      if (!graph || graph.truncated) throw new Error('Code map traversal incomplete');
      const cls = project.getSourceFileOrThrow('/' + route.handler.file).getClasses()
        .find(candidate => candidate.getName() === route.handler.enclosingSymbol.split('.')[0])!;
      return { id: deterministicId('routeMapping', auditId + ':' + route.id), method: route.method,
        pathTemplate: route.pathTemplate, framework: 'nestjs', handlerSymbol: route.handler.enclosingSymbol,
        file: route.handler.file, line: route.handler.line,
        middleware: cls.getDecorators().filter(decorator => decorator.getName() === 'UseGuards').map(decorator => decorator.getText()),
        serviceSymbols: graph.reachable.slice(1).map(source => source.enclosingSymbol), source: route.source };
    });
    await this.prisma.codeMap.upsert({ where: { auditId }, create: { id: deterministicId('codeMap', auditId), auditId, projectId, repositoryId, commitSha, framework: 'nestjs', routeMappings: { create: mappings } }, update: {} });
  }

  /**
   * Builds the Code Map using ts-morph from the given tsConfig path.
   */
  buildForProject(tsConfigFilePath: string, routes: RouteMapping[]): Map<string, CodeMapEntry> {
    this.logger.log(`Building code map for ${tsConfigFilePath}`);
    const project = new Project({ tsConfigFilePath });
    const root = path.dirname(tsConfigFilePath);

    const rel = (file: SourceFile): string => {
      return path.relative(root, file.getFilePath()).split(path.sep).join('/');
    };

    const findClass = (name: string): ClassDeclaration | undefined => {
      for (const sf of project.getSourceFiles()) {
        const cls = sf.getClass(name);
        if (cls) return cls;
      }
      return undefined;
    };

    const injectedProperties = (cls: ClassDeclaration): Map<string, string> => {
      const map = new Map<string, string>();
      const ctor = cls.getConstructors()[0];
      if (!ctor) return map;

      for (const param of ctor.getParameters()) {
        const typeNode = param.getTypeNode();
        if (!typeNode) continue;
        map.set(param.getName(), typeNode.getText());
      }
      return map;
    };

    const locationOf = (method: MethodDeclaration, className: string): SourceLocation => {
      return {
        file: rel(method.getSourceFile()),
        enclosingSymbol: `${className}.${method.getName()}`,
        line: method.getStartLineNumber(),
      };
    };

    const buildForHandler = (controllerClass: string, handlerMethod: string): CodeMapEntry | null => {
      const cls = findClass(controllerClass);
      if (!cls) return null;

      const handler = cls.getMethod(handlerMethod);
      if (!handler) return null;

      const handlerLocation = locationOf(handler, controllerClass);
      const chain: CallEdge[] = [];
      const reachable = new Set<string>([handlerLocation.enclosingSymbol]);

      const walk = (
        currentClass: ClassDeclaration,
        currentClassName: string,
        currentMethod: MethodDeclaration,
        depth: number,
      ): void => {
        if (depth > MAX_DEPTH) return;

        const injected = injectedProperties(currentClass);
        const fromSymbol = `${currentClassName}.${currentMethod.getName()}`;

        for (const call of currentMethod.getDescendantsOfKind(SyntaxKind.CallExpression)) {
          const callee = call.getExpression();
          if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) continue;

          const calledMethodName = callee.getName();
          const receiver = callee.getExpression();
          if (!receiver.isKind(SyntaxKind.PropertyAccessExpression)) continue;
          if (receiver.getExpression().getKind() !== SyntaxKind.ThisKeyword) continue;

          const propertyName = receiver.getName();
          const targetClassName = injected.get(propertyName);
          if (!targetClassName) continue;

          const targetClass = findClass(targetClassName);
          if (!targetClass) continue;

          const targetMethod = targetClass.getMethod(calledMethodName);
          if (!targetMethod) continue;

          const location = locationOf(targetMethod, targetClassName);
          const toSymbol = location.enclosingSymbol;

          if (reachable.has(toSymbol)) continue;
          reachable.add(toSymbol);
          chain.push({ fromSymbol, toSymbol, via: propertyName, location });

          walk(targetClass, targetClassName, targetMethod, depth + 1);
        }
      };

      walk(cls, controllerClass, handler, 0);

      return {
        handlerSymbol: handlerLocation.enclosingSymbol,
        handlerLocation,
        chain,
        reachableSymbols: [...reachable],
      };
    };

    const out = new Map<string, CodeMapEntry>();
    for (const route of routes) {
      const entry = buildForHandler(route.controllerClass, route.handlerMethod);
      if (entry) out.set(route.handlerSymbol, entry);
    }
    return out;
  }
}
