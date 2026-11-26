import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MethodologyGuard } from './methodology.guard';
import { PromptBuilder } from './prompt-builder';
import { graphTemplate } from '../orchestrator/job-graph';

const source = resolve(__dirname, '../../../..', 'methodology/v1');

describe('security-audit methodology module', () => {
  let dir: string; let previous: string | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kase-sec-methodology-'));
    await cp(source, dir, { recursive: true });
    previous = process.env.KASE_METHODOLOGY_ROOT; process.env.KASE_METHODOLOGY_ROOT = dir;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.KASE_METHODOLOGY_ROOT; else process.env.KASE_METHODOLOGY_ROOT = previous;
  });

  it('verifies the vendored security files and pins the upstream commit', async () => {
    const guard = new MethodologyGuard();
    await guard.verifyIntegrity();
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.referenceFiles).filter(f => f.startsWith('security/'))).toHaveLength(15);
    expect(manifest.upstreamSecurityAudit).toMatchObject({ license: 'MIT', commit: expect.stringMatching(/^[a-f0-9]{40}$/) });
  });

  it('rejects tampering with or adding to the security module', async () => {
    const guard = new MethodologyGuard();
    await writeFile(join(dir, 'security/HUNTING.md'), 'modified');
    await expect(guard.verifyIntegrity()).rejects.toThrow();
    await cp(join(source, 'security/HUNTING.md'), join(dir, 'security/HUNTING.md'));
    await guard.verifyIntegrity();
    await writeFile(join(dir, 'security/extra.md'), 'x');
    await expect(guard.verifyIntegrity()).rejects.toThrow();
  });

  it('appends the module to the whitebox prompt only when requested', () => {
    const text = (m: any) => m.content[0].text as string;
    const base = text(new PromptBuilder().buildSystemPrompt('whitebox', {}));
    const withModule = text(new PromptBuilder().buildSystemPrompt('whitebox', {}, ['security']));
    expect(base).not.toContain('Kase security-audit module');
    expect(withModule).toContain('Kase security-audit module');
    expect(withModule).toContain('# Attack Classes');
    expect(withModule.indexOf('whitebox')).toBeLessThan(withModule.indexOf('Kase security-audit module'));
  });
});

describe('security category in the job graph', () => {
  it('implies the whitebox agent and its prerequisites without adding a job of its own', () => {
    const kinds = graphTemplate('full', ['security']).map(j => j.kind);
    expect(kinds).toEqual(expect.arrayContaining(['semgrep', 'code_map', 'whitebox_agent']));
    expect(kinds.filter(k => k === 'whitebox_agent')).toHaveLength(1);
    expect(kinds).not.toContain('security');
    expect(graphTemplate('full', ['whitebox', 'security']).filter(j => j.kind === 'whitebox_agent')).toHaveLength(1);
  });
});
