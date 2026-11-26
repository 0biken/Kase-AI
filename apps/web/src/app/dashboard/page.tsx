import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { DashboardView } from './dashboard-view';

export default async function Dashboard() {
  const session = await auth();
  if (!session) redirect('/signin');

  return <DashboardView email={session.user?.email ?? 'Kase member'} />;
}
