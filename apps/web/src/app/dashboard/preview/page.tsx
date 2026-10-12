import { notFound } from 'next/navigation';
import { DashboardView } from '../dashboard-view';

export const metadata = { robots: { index: false, follow: false } };

/**
 * Local-only look at the dashboard without signing in, for design work when
 * no OAuth provider is configured. It renders static content and reads no
 * workspace data. Production builds answer 404, so this is never a way
 * around sign-in.
 */
export default function DashboardPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return <DashboardView email="preview@localhost" />;
}
