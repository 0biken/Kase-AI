import { redirect } from 'next/navigation';
import type { KaseApi } from '@/lib/kase-api';
import { workspace, type Workspace } from '@/lib/kase-api-session';
import type { AuditRow } from '@/lib/workspace-types';

/** Every workspace page starts here: no session, no screen. */
export async function requireWorkspace(): Promise<Workspace> {
  const ws = await workspace();
  if (!ws) redirect('/signin');
  return ws;
}

/** Audits across every project the member's organization has, newest first. */
export async function listAllAudits(api: KaseApi): Promise<AuditRow[]> {
  const projects = await api.listProjects();
  const perProject = await Promise.all(projects.map((p) => api.listAudits(p.id)));
  return perProject.flat().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function pickFilters(params: Record<string, string | string[] | undefined>) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  return { severity: one(params.severity), category: one(params.category), gateEligible: one(params.gateEligible) };
}
