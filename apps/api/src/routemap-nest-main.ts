import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dumpNestRoutes } from './adapters/routemap/nest-route-dump';
import type { RuntimeRouteArtifact } from './adapters/routemap/route-artifact';

/**
 * `kase-routemap` runner for NestJS targets. Runs inside the sandboxed
 * worker against the audited checkout:
 *
 *   node dist/routemap-nest-main.js --module <checkout>/dist/app.module.js \
 *     --export AppModule --commit <sha> [--global-prefix api] [--out routes.json]
 *
 * The target is booted with its *own* @nestjs/core (resolved from the module
 * path), initialised but never listening, then closed. Its routes are read
 * from the DI container and written as a commit-bound route artifact.
 */
export interface NestRunOptions { modulePath: string; exportName: string; commitSha: string; globalPrefix?: string; now?: Date }

export async function runNestDump(options: NestRunOptions): Promise<RuntimeRouteArtifact> {
  if (!/^[0-9a-f]{40}$/iu.test(options.commitSha)) throw new Error('--commit must be a full 40-character SHA');
  const modulePath = resolve(options.modulePath);
  const targetRequire = createRequire(modulePath);
  targetRequire('reflect-metadata');
  const { NestFactory } = targetRequire('@nestjs/core') as typeof import('@nestjs/core');
  const rootModule = (targetRequire(modulePath) as Record<string, unknown>)[options.exportName];
  if (typeof rootModule !== 'function') throw new Error(`Export ${options.exportName} not found in ${modulePath}`);

  const app = await NestFactory.create(rootModule as never, { logger: false, abortOnError: false });
  try {
    await app.init();
    return dumpNestRoutes(app, { commitSha: options.commitSha, globalPrefix: options.globalPrefix, now: options.now });
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const { values } = parseArgs({ strict: true, options: {
    module: { type: 'string' }, export: { type: 'string', default: 'AppModule' }, commit: { type: 'string' },
    'global-prefix': { type: 'string' }, out: { type: 'string' },
  } });
  if (!values.module || !values.commit) {
    console.error('Usage: routemap-nest-main --module <app.module.js> --commit <sha> [--export AppModule] [--global-prefix p] [--out file]');
    process.exit(2);
  }
  runNestDump({ modulePath: values.module, exportName: values.export!, commitSha: values.commit, globalPrefix: values['global-prefix'] })
    .then(artifact => {
      const text = JSON.stringify(artifact, null, 2) + '\n';
      if (values.out) writeFileSync(values.out, text, 'utf8'); else process.stdout.write(text);
    })
    .catch(error => { console.error(`routemap failed: ${(error as Error).message}`); process.exit(1); });
}
