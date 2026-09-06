import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import type { SemgrepOutput, SastAdapterFinding } from './semgrep.types';
import { Inject, Injectable } from '@nestjs/common';
import { runControlledProcess } from '../../worker/process-control';

export interface RunSemgrepInput {
  checkoutPath: string;
  rulePackPath: string;
  rulePackSha256: string;
  signal?: AbortSignal;
}

export type SemgrepExecutor = (args: readonly string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal;
}) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export const SEMGREP_EXECUTOR = Symbol('SEMGREP_EXECUTOR');

@Injectable()
export class SemgrepAdapter {
  constructor(@Inject(SEMGREP_EXECUTOR) private readonly execute: SemgrepExecutor) {}

  async run(input: RunSemgrepInput): Promise<{ raw: string; findings: SastAdapterFinding[] }> {
    const bytes = await readFile(input.rulePackPath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== input.rulePackSha256.toLowerCase()) throw new Error('Rule pack digest mismatch');
    const args = ['--json', '--metrics=off', '--disable-version-check', '--config', input.rulePackPath, input.checkoutPath];
    const result = await this.execute(args, {
      cwd: input.checkoutPath,
      signal: input.signal,
      env: {
        ...process.env,
        HOME: '/tmp',
        SEMGREP_SEND_METRICS: 'off',
        SEMGREP_ENABLE_VERSION_CHECK: '0',
        SEMGREP_SETTINGS_FILE: '/dev/null',
      },
    });
    if (result.exitCode !== 0) throw new Error(`Semgrep failed with exit code ${result.exitCode}: ${result.stderr.slice(0, 1000)}`);
    // Persist only the replayable finding payload. Semgrep's timing/profiling
    // sections vary between runs and would otherwise defeat deterministic
    // evidence IDs during crash recovery.
    const parsed = parseSemgrepOutput(result.stdout);
    const raw = JSON.stringify({ version: parsed.version, results: parsed.results, errors: parsed.errors ?? [] });
    return { raw, findings: parsed.results.map(toAdapterFinding) };
  }
}

export function parseSemgrepFindings(raw: string): SastAdapterFinding[] {
  return parseSemgrepOutput(raw).results.map(toAdapterFinding);
}

export function parseSemgrepOutput(raw: string): SemgrepOutput {
  const value = JSON.parse(raw) as Partial<SemgrepOutput>;
  if (!Array.isArray(value.results)) throw new Error('Invalid Semgrep JSON: results missing');
  return value as SemgrepOutput;
}

function toAdapterFinding(result: SemgrepOutput['results'][number]): SastAdapterFinding {
  const marker = result.check_id.lastIndexOf('kase.');
  if (marker < 0) throw new Error(`Engine-specific or unknown rule namespace rejected: ${result.check_id}`);
  const ruleId = result.check_id.slice(marker);
  return { ruleId, file: result.path.replace(/\\/gu, '/'), startLine: result.start.line,
    endLine: result.end.line, message: result.extra.message, advisorySeverity: result.extra.severity,
    metadata: result.extra.metadata ?? {} };
}

export function executeSemgrep(args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }) {
  return runControlledProcess('semgrep', args, {
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    shell: false,
    graceMs: 30_000,
  });
}
