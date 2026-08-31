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
    <main className="site-shell">
      <nav className="site-nav" aria-label="Primary navigation"><a className="wordmark" href="/"><span className="mark">K</span>kase</a></nav>
      <section className="docs-page" style={{ maxWidth: '620px', paddingTop: '58px' }}>
      <div className="eyebrow">Secure workspace</div>
      <h1>Sign in to Kase.</h1>
      <p>Access is provisioned by invitation. Your identity is verified before a workspace session is created.</p>
      <div className="bezel" style={{ marginTop: '34px' }}><div className="bezel-inner intake-form">

      {message && (
        <p role="alert" className="form-note error" style={{ marginBottom: '18px' }}>
          {message}
        </p>
      )}

      {available.length === 0 ? (
          <p role="alert" className="form-note error">
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
            <button className="button button-primary" style={{ width: '100%', marginBottom: '10px' }} type="submit">
              {LABELS[s.id]}
            </button>
          </form>
        ))
      )}

      <p className="form-note">
        Kase is invite-only. Signing in with a provider does not create an account on its own.
        an organization admin has to invite your address first.
      </p>
      </div></div></section></main>
  );
}
