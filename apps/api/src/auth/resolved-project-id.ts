import type { Request } from 'express';
import { ProblemException } from '../common/problem-details';

/** ProjectScopeGuard writes this value after resolving and authorizing a flat audit route. */
export function resolvedProjectId(request: Request): string {
  const raw = request.params.__resolvedProjectId;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new ProblemException('INTERNAL', 'Audit scope did not resolve a project');
  return value;
}
