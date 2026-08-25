import { Project, SyntaxKind, ClassDeclaration, MethodDeclaration, SourceFile } from 'ts-morph';
import * as path from 'path';
import { CodeMapEntry, CallEdge, SourceLocation, RouteMapping } from './types';

const MAX_DEPTH = 4;

export class CodeMap {
  private project: Project;
  private root: string;

  constructor(tsConfigFilePath: string) {
    this.project = new Project({ tsConfigFilePath });
    this.root = path.dirname(tsConfigFilePath);
  }

  private rel(file: SourceFile): string {
    return path.relative(this.root, file.getFilePath()).split(path.sep).join('/');
  }

  private findClass(name: string): ClassDeclaration | undefined {
    for (const sf of this.project.getSourceFiles()) {
      const cls = sf.getClass(name);
      if (cls) return cls;
    }
    return undefined;
  }

  /**
   * Maps constructor-injected property names to their declared class.
   *
   *   constructor(private readonly invoiceService: InvoiceService) {}
   *     -> { invoiceService: 'InvoiceService' }
   *
   * This is what lets `this.invoiceService.find()` resolve to a real symbol.
   * NestJS DI is constructor-based by convention, so the declared parameter
   * type is a reliable, purely syntactic resolution — no type checker needed,
   * which keeps this fast and robust on partial codebases.
   */
  private injectedProperties(cls: ClassDeclaration): Map<string, string> {
    const map = new Map<string, string>();
    const ctor = cls.getConstructors()[0];
    if (!ctor) return map;

    for (const param of ctor.getParameters()) {
      const typeNode = param.getTypeNode();
      if (!typeNode) continue;
      map.set(param.getName(), typeNode.getText());
    }
    return map;
  }

  private locationOf(method: MethodDeclaration, className: string): SourceLocation {
    return {
      file: this.rel(method.getSourceFile()),
      enclosingSymbol: `${className}.${method.getName()}`,
      line: method.getStartLineNumber(),
    };
  }

  /**
   * Walks outward from a route handler through injected-service calls.
   *
   * The controller is almost never where an authorization bug lives, so a
   * correlation that stops at the handler points reviewers at the wrong file.
   * This is the hop that makes the finding actionable.
   */
  buildForHandler(controllerClass: string, handlerMethod: string): CodeMapEntry | null {
    const cls = this.findClass(controllerClass);
    if (!cls) return null;

    const handler = cls.getMethod(handlerMethod);
    if (!handler) return null;

    const handlerLocation = this.locationOf(handler, controllerClass);
    const chain: CallEdge[] = [];
    const reachable = new Set<string>([handlerLocation.enclosingSymbol]);

    const walk = (
      currentClass: ClassDeclaration,
      currentClassName: string,
      currentMethod: MethodDeclaration,
      depth: number,
    ): void => {
      if (depth > MAX_DEPTH) return;

      const injected = this.injectedProperties(currentClass);
      const fromSymbol = `${currentClassName}.${currentMethod.getName()}`;

      for (const call of currentMethod.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        if (!callee.isKind(SyntaxKind.PropertyAccessExpression)) continue;

        const calledMethodName = callee.getName();          // 'find'
        const receiver = callee.getExpression();            // 'this.invoiceService'
        if (!receiver.isKind(SyntaxKind.PropertyAccessExpression)) continue;
        if (receiver.getExpression().getKind() !== SyntaxKind.ThisKeyword) continue;

        const propertyName = receiver.getName();            // 'invoiceService'
        const targetClassName = injected.get(propertyName);
        if (!targetClassName) continue;

        const targetClass = this.findClass(targetClassName);
        if (!targetClass) continue;

        const targetMethod = targetClass.getMethod(calledMethodName);
        if (!targetMethod) continue;

        const location = this.locationOf(targetMethod, targetClassName);
        const toSymbol = location.enclosingSymbol;

        if (reachable.has(toSymbol)) continue;              // cycle guard
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
  }

  buildForRoutes(routes: RouteMapping[]): Map<string, CodeMapEntry> {
    const out = new Map<string, CodeMapEntry>();
    for (const route of routes) {
      const entry = this.buildForHandler(route.controllerClass, route.handlerMethod);
      if (entry) out.set(route.handlerSymbol, entry);
    }
    return out;
  }
}
