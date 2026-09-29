import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeMapService } from '../agent-runtime/code-map/code-map.service';

describe('M5 production code-map builder', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kase-m5-map-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  it('persists resolved service symbols and distinct same-named controller routes', async () => {
    await writeFile(join(root, 'service.ts'), 'export class InvoiceService { find() { return 1; } }');
    for (const [file, prefix] of [['public.ts', 'invoices'], ['admin.ts', 'admin/invoices']]) {
      await writeFile(join(root, file), `import {Controller,Get} from '@nestjs/common';
        import {InvoiceService as Service} from './service';
        @Controller('${prefix}') class ControllerA {
          constructor(private service: Service) {}
          @Get(':id') find() { return this.service.find(); }
        }`);
    }
    const db: any = { codeMap: { upsert: jest.fn() } };
    await new CodeMapService(db).buildForAudit('audit', 'project', 'repo', 'a'.repeat(40), root);
    const mappings = db.codeMap.upsert.mock.calls[0][0].create.routeMappings.create;
    expect(mappings).toHaveLength(2);
    expect(new Set(mappings.map((mapping: any) => mapping.id)).size).toBe(2);
    expect(mappings.every((mapping: any) => mapping.serviceSymbols.join() === 'InvoiceService.find')).toBe(true);
  });
});
