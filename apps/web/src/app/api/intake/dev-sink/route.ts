import { NextResponse } from 'next/server';

/**
 * Local UI-verification endpoint only. It intentionally discards the payload:
 * test waitlist entries and security reports must not become accidental local
 * files or console output. Production refuses this route and must use a real,
 * access-controlled triage webhook instead.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ message: 'Development intake sink is disabled.' }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
