import { redirect } from 'next/navigation';
import { load } from '@/lib/kase-api-session';
import { ProblemState, StateCard } from '../components/primitives';
import { DashShell } from '../dash-shell';
import { listAllAudits, requireWorkspace } from '../data';

export const metadata = { title: 'Findings | Kase' };

/** Findings belong to an audit, so this entry point opens the newest one. */
export default async function FindingsIndex() {
  const { api, email } = await requireWorkspace();
  const audits = await load(() => listAllAudits(api));
  if (audits.ok && audits.data[0]) redirect(`/dashboard/audits/${audits.data[0].id}/findings`);

  return (
    <DashShell title="Findings" email={email} active="findings">
      {audits.ok ? (
        <StateCard title="No findings yet">
          <p>Findings are recorded per audit. Once an audit has run, its findings open here.</p>
        </StateCard>
      ) : (
        <ProblemState failure={audits} />
      )}
    </DashShell>
  );
}
