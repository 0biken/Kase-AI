import { applyFindingFilters } from '@/lib/workspace-types';
import { AuditFrame } from '../../../../components/audit-frame';
import { FindingsFilters, FindingsTable } from '../../../../components/findings';
import { SampleBadge } from '../../../../components/primitives';
import { DashShell } from '../../../../dash-shell';
import { pickFilters } from '../../../../data';
import { PREVIEW_BASE, PREVIEW_EMAIL, devOnly, sampleAudit } from '../../../_fixtures';

interface Props {
  params: Promise<{ auditId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FindingsPreview({ params, searchParams }: Props) {
  devOnly();
  const { auditId } = await params;
  const filters = pickFilters(await searchParams);
  const { audit, findings } = sampleAudit(auditId);

  return (
    <DashShell title="Findings" eyebrow={`Audit ${auditId}`} email={PREVIEW_EMAIL} active="audits" basePath={PREVIEW_BASE} badge={<SampleBadge />}>
      <AuditFrame audit={audit} tab="findings" basePath={PREVIEW_BASE}>
        <FindingsFilters
          action={`${PREVIEW_BASE}/audits/${auditId}/findings`}
          filters={filters}
          categories={[...new Set(findings.map((f) => f.category))].sort()}
        />
        <FindingsTable
          findings={applyFindingFilters(findings, filters)}
          filtered={Boolean(filters.severity || filters.category || filters.gateEligible)}
        />
      </AuditFrame>
    </DashShell>
  );
}
