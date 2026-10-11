import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import SignInForm from './SignInForm';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // Already signed in? Skip the form.
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  const { next } = await searchParams;

  /*
   * `next` is attacker-influenced. Validate it is a same-site relative
   * path, otherwise /sign-in?next=https://evil.example becomes an open
   * redirect that launders trust through our own domain.
   */
  const callbackUrl =
    next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  return (
    <main className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="hint-text mt-2">
            Access your keys, usage, and billing.
          </p>
        </div>

        <SignInForm callbackUrl={callbackUrl} />

        <p className="hint-text mt-6 text-center">
          No account yet?{' '}
          <a href="/sign-up" className="text-[var(--accent)] hover:underline">
            Create one
          </a>
        </p>
      </div>
    </main>
  );
}