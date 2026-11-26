import { redirect } from 'next/navigation';
import { PREVIEW_BASE, SAMPLE_DEFAULT_AUDIT_ID, devOnly } from '../_fixtures';

/** Opens the sample audit that has findings, as the real page opens the newest audit. */
export default function FindingsIndexPreview() {
  devOnly();
  redirect(`${PREVIEW_BASE}/audits/${SAMPLE_DEFAULT_AUDIT_ID}/findings`);
}
