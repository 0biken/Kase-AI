import { DashboardView } from '../dashboard-view';
import { PREVIEW_BASE, PREVIEW_EMAIL, devOnly } from './_fixtures';

export const metadata = { robots: { index: false, follow: false } };

/**
 * Local-only look at the dashboard without signing in, for design work when
 * no OAuth provider is configured. It renders static content and sample data
 * and reads no workspace data. Production builds answer 404, so this is never
 * a way around sign-in.
 */
export default function DashboardPreview() {
  devOnly();
  return <DashboardView email={PREVIEW_EMAIL} basePath={PREVIEW_BASE} />;
}
