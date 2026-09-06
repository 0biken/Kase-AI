export interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: { message: string; severity?: string; metadata?: Record<string, unknown>; lines?: string };
}
export interface SemgrepOutput { version?: string; results: SemgrepResult[]; errors?: unknown[] }

export interface SastAdapterFinding {
  ruleId: string; file: string; startLine: number; endLine: number; message: string;
  advisorySeverity?: string; metadata: Record<string, unknown>;
}
