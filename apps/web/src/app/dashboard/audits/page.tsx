import { load } from '@/lib/kase-api-session';
import { AuditsList } from '../components/audits-list';
import { ProblemState } from '../components/primitives';
import { DashShell } from '../dash-shell';
import { listAllAudits, requireWorkspace } from '../data';

export const metadata = { title: 'Audits | Kase' };

export default async function AuditsPage() {
  const { api, email } = await requireWorkspace();
  const audits = await load(() => listAllAudits(api));

  return (
    <DashShell title="Audits" email={email} active="audits">
      {audits.ok ? <AuditsList audits={audits.data} basePath="/dashboard" /> : <ProblemState failure={audits} />}
    </DashShell>
  );
}
