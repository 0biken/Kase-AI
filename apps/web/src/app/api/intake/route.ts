import { NextResponse } from 'next/server';

const kinds = new Set(['waitlist', 'request', 'security-report']);

export async function POST(request: Request) {
  const intakeUrl = process.env.KASE_INTAKE_WEBHOOK_URL;
  if (!intakeUrl) {
    return NextResponse.json(
      { message: 'Requests are not configured yet. Set KASE_INTAKE_WEBHOOK_URL to enable this form.' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const kind = typeof body?.kind === 'string' ? body.kind : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const company = typeof body?.company === 'string' ? body.company.trim() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  if (!kinds.has(kind) || !name || !email || !message || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ message: 'Provide a name, valid work email, and message.' }, { status: 422 });
  }
  if ([name, email, company, message].some((value) => value.length > 4000)) {
    return NextResponse.json({ message: 'One or more fields are too long.' }, { status: 422 });
  }

  const response = await fetch(intakeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, name, email, company: company || null, message, receivedAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!response?.ok) {
    return NextResponse.json({ message: 'We could not receive your request. Please try again shortly.' }, { status: 502 });
  }
  return NextResponse.json({ message: 'Received.' }, { status: 202 });
}
