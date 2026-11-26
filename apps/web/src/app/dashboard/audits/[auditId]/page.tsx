import { redirect } from 'next/navigation';

/** An audit opens on its findings. */
export default async function AuditIndex({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  redirect(`/dashboard/audits/${encodeURIComponent(auditId)}/findings`);
}
