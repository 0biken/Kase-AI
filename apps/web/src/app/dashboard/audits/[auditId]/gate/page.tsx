import { load } from '@/lib/kase-api-session';
import { AuditFrame } from '../../../components/audit-frame';
import { GateNotEvaluated, GatePanel } from '../../../components/gate-panel';
import { ProblemState } from '../../../components/primitives';
import { DashShell } from '../../../dash-shell';
import { requireWorkspace } from '../../../data';

export const metadata = { title: 'Release gate | Kase' };

export default async function GatePage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const { api, email } = await requireWorkspace();

  const result = await load(async () => {
    const [audit, gate, findings] = await Promise.all([api.getAudit(auditId), api.getGate(auditId), api.listFindings(auditId)]);
    return { audit, gate, findings };
  });

  return (
    <DashShell title="Release gate" eyebrow={`Audit ${auditId}`} email={email} active="audits">
      {result.ok ? (
        <AuditFrame audit={result.data.audit} tab="gate" basePath="/dashboard">
          {result.data.gate ? <GatePanel gate={result.data.gate} findings={result.data.findings} /> : <GateNotEvaluated auditId={auditId} />}
        </AuditFrame>
      ) : (
        <ProblemState failure={result} />
      )}
    </DashShell>
  );
}
