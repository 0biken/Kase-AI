import { AuditsList } from '../../components/audits-list';
import { SampleBadge } from '../../components/primitives';
import { DashShell } from '../../dash-shell';
import { PREVIEW_BASE, PREVIEW_EMAIL, SAMPLE_AUDITS, devOnly } from '../_fixtures';

export default function AuditsPreview() {
  devOnly();
  return (
    <DashShell title="Audits" email={PREVIEW_EMAIL} active="audits" basePath={PREVIEW_BASE} badge={<SampleBadge />}>
      <AuditsList audits={SAMPLE_AUDITS} basePath={PREVIEW_BASE} />
    </DashShell>
  );
}
