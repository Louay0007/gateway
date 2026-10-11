import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { userByEmail } from '@/lib/auth/authorize';
import { ensureSessionReady } from '@/lib/auth/provision';
import DashboardNav from './DashboardNav';

export const dynamic = 'force-dynamic';

/**
 * Dashboard shell.
 *
 * Provisioning runs here AND in the page (via the shared, request-scoped
 * `ensureSessionReady`). That is deliberate: a layout and its page render
 * concurrently, so whichever reaches the cached function first performs
 * the work and the other awaits the same promise. Calling it in only one
 * place races — the page can read memberships before provisioning commits,
 * bouncing a brand-new user to /sign-in on their first load.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect('/sign-in');

  const current = await userByEmail(session.user.email);
  if (current) {
    await ensureSessionReady(current.id);
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <DashboardNav email={session.user.email} name={session.user.name ?? undefined} />
      <main className="flex-1">{children}</main>
    </div>
  );
}