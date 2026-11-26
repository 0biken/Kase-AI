import { load } from '@/lib/kase-api-session';
import { applyFindingFilters } from '@/lib/workspace-types';
import { AuditFrame } from '../../../components/audit-frame';
import { FindingsFilters, FindingsTable } from '../../../components/findings';
import { ProblemState } from '../../../components/primitives';
import { DashShell } from '../../../dash-shell';
import { pickFilters, requireWorkspace } from '../../../data';

export const metadata = { title: 'Findings | Kase' };

interface Props {
  params: Promise<{ auditId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FindingsPage({ params, searchParams }: Props) {
  const { auditId } = await params;
  const filters = pickFilters(await searchParams);
  const { api, email } = await requireWorkspace();

  // One request for the whole audit: the category options need the unfiltered
  // set anyway, and filtering it here matches the API's own filter semantics.
  const result = await load(async () => ({ audit: await api.getAudit(auditId), findings: await api.listFindings(auditId) }));

  return (
    <DashShell title="Findings" eyebrow={`Audit ${auditId}`} email={email} active="audits">
      {result.ok ? (
        <AuditFrame audit={result.data.audit} tab="findings" basePath="/dashboard">
          <FindingsFilters
            action={`/dashboard/audits/${auditId}/findings`}
            filters={filters}
            categories={[...new Set(result.data.findings.map((f) => f.category))].sort()}
          />
          <FindingsTable
            findings={applyFindingFilters(result.data.findings, filters)}
            filtered={Boolean(filters.severity || filters.category || filters.gateEligible)}
          />
        </AuditFrame>
      ) : (
        <ProblemState failure={result} />
      )}
    </DashShell>
  );
}
