import { signIn } from '@/auth';
import { DENIAL_MESSAGES, type SignInDenialReason } from '@/auth/invite';
import { providerStatuses } from '@/auth/providers';

const LABELS: Record<string, string> = {
  github: 'Continue with GitHub',
  google: 'Continue with Google',
  apple: 'Continue with Apple',
};

/**
 * Sign-in scaffolding, not finished UI — 16-web's screens are M6, and
 * anything user-facing carries WCAG 2.1 AA with axe in CI (16 §5).
 *
 * Only providers that are actually configured are offered: rendering an
 * Apple button in a deployment with no Apple credentials sends people into a
 * dead end rather than telling them it is unavailable.
 */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const statuses = providerStatuses();
  const available = statuses.filter((s) => s.configured);

  const message =
    error && error in DENIAL_MESSAGES
      ? DENIAL_MESSAGES[error as SignInDenialReason]
      : error
        ? 'Sign-in failed. Please try again.'
        : null;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem', maxWidth: '28rem', lineHeight: 1.6 }}>
      <h1>Sign in to Kase</h1>

      {message && (
        <p role="alert" style={{ padding: '0.75rem 1rem', border: '1px solid #b00', borderRadius: 6 }}>
          {message}
        </p>
      )}

      {available.length === 0 ? (
        <p role="alert">
          No sign-in providers are configured. Set the <code>KASE_*_CLIENT_ID</code> and{' '}
          <code>KASE_*_CLIENT_SECRET</code> environment variables.
        </p>
      ) : (
        available.map((s) => (
          <form
            key={s.id}
            action={async () => {
              'use server';
              await signIn(s.id, { redirectTo: '/' });
            }}
          >
            <button type="submit" style={{ display: 'block', width: '100%', padding: '0.75rem', marginBottom: '0.75rem' }}>
              {LABELS[s.id]}
            </button>
          </form>
        ))
      )}

      <p style={{ fontSize: '0.875rem', color: '#555' }}>
        Kase is invite-only. Signing in with a provider does not create an account on its own —
        an organization admin has to invite your address first.
      </p>
    </main>
  );
}
