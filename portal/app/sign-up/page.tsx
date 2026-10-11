import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import SignUpForm from './SignUpForm';

export const metadata = { title: 'Create account' };
export const dynamic = 'force-dynamic';

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <main className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="hint-text mt-2">
            Start free. Add a plan whenever you need more.
          </p>
        </div>

        <SignUpForm />

        <p className="hint-text mt-6 text-center">
          Already registered?{' '}
          <a href="/sign-in" className="text-[var(--accent)] hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}