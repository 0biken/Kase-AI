import { AuditFrame } from '../../../../components/audit-frame';
import { GateNotEvaluated, GatePanel } from '../../../../components/gate-panel';
import { SampleBadge } from '../../../../components/primitives';
import { DashShell } from '../../../../dash-shell';
import { PREVIEW_BASE, PREVIEW_EMAIL, devOnly, sampleAudit } from '../../../_fixtures';

export default async function GatePreview({ params }: { params: Promise<{ auditId: string }> }) {
  devOnly();
  const { auditId } = await params;
  const { audit, findings, gate } = sampleAudit(auditId);

  return (
    <DashShell title="Release gate" eyebrow={`Audit ${auditId}`} email={PREVIEW_EMAIL} active="audits" basePath={PREVIEW_BASE} badge={<SampleBadge />}>
      <AuditFrame audit={audit} tab="gate" basePath={PREVIEW_BASE}>
        {gate ? <GatePanel gate={gate} findings={findings} /> : <GateNotEvaluated auditId={auditId} />}
      </AuditFrame>
    </DashShell>
  );
}
