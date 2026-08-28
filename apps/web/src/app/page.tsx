import { auth } from '@/auth';

/**
 * Placeholder. The dashboard screens in 16-web are M6 work; this exists so
 * the app has a root route and so sign-in has somewhere to land.
 */
export default async function Home() {
  const session = await auth();

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem', lineHeight: 1.6 }}>
      <h1>Kase</h1>
      {session ? (
        <p>
          Signed in as <strong>{session.user?.email}</strong>.
        </p>
      ) : (
        <p>
          <a href="/signin">Sign in</a>
        </p>
      )}
    </main>
  );
}
