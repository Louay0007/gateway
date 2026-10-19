/**
 * /device — Zaino Desktop device-code approval page.
 *
 * The desktop app opens this URL (verification_url from /api/auth/device)
 * in the system browser, showing user_code. The person signs in to the
 * portal (Auth.js) and approves the device here; approval mints the
 * device-scoped gateway key which the desktop app collects by polling
 * /api/auth/device/token.
 *
 * No secret ever renders on this page: the key plaintext travels from the
 * server to the desktop app only, through the token endpoint.
 */

import { redirect } from 'next/navigation';
import type { Metadata } from "next";
import { currentUser } from '@/lib/auth/authorize';
import { store } from '@/lib/auth/device/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApproveForm } from './device-approve-form';

export const metadata: Metadata = { title: "Approve Desktop Sign-In" };

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>;
}) {
  const { user_code } = await searchParams;
  // currentUser() and not auth(): a token that parses but no longer resolves
  // (stale password stamp) would render an ApproveForm whose submit then
  // fails the membership check server-side. Sending it back to /sign-in is
  // also what keeps the sign-in/device pair from redirecting forever.
  const user = await currentUser();
  const code = user_code ? await store.findByUserCode(user_code) : null;

  if (!user_code) {
    redirect('/sign-in');
  }
  if (!user) {
    // After sign-in the portal returns here to finish the approval.
    redirect(
      `/sign-in?callbackUrl=${encodeURIComponent(
        `/device?user_code=${encodeURIComponent(user_code)}`,
      )}`,
    );
  }
  if (!code) {
    return <UnknownCode />;
  }

  switch (code.status) {
    case 'expired':
      return <ExpiredCode />;
    case 'consumed':
      return <ConsumedCode />;
    case 'revoked':
      return <RevokedCode />;
    case 'approved':
      return <ApprovedCode />;
    case 'pending':
      if (isExpired(code.expiresAt)) {
        return <ExpiredCode />;
      }
      return <ApproveForm userCode={code.userCode} email={user.email} />;
  }
}

function isExpired(expiresAt: Date | null): boolean {
  return !expiresAt || new Date() >= expiresAt;
}

function UnknownCode() {
  return (
    <Card className="w-full max-w-md mx-auto mt-12">
      <CardHeader>
        <CardTitle>Sign-in code not found</CardTitle>
        <CardDescription>
          This device-code approval link doesn't match any sign-in request.
          Start a new sign-in in Zaino Desktop and try again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end">
        <a href="/dashboard" className="mt-6 block w-fit text-sm text-primary hover:underline">
          Go to dashboard
        </a>
      </CardContent>
    </Card>
  );
}

function ExpiredCode() {
  return (
    <Card className="w-full max-w-md mx-auto mt-12">
      <CardHeader>
        <CardTitle>Sign-in code expired</CardTitle>
        <CardDescription>
          Device codes expire 15 minutes after they are created. Start a new
          sign-in in Zaino Desktop and approve again promptly.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end">
        <a href="/dashboard" className="mt-6 block w-fit text-sm text-primary hover:underline">
          Go to dashboard
        </a>
      </CardContent>
    </Card>
  );
}

function ConsumedCode() {
  return (
    <Card className="w-full max-w-md mx-auto mt-12">
      <CardHeader>
        <CardTitle>Sign-in code already used</CardTitle>
        <CardDescription>
          This code was already collected by Zaino Desktop. You are signed
          in — return to the desktop app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end">
        <a href="/dashboard" className="mt-6 block w-fit text-sm text-primary hover:underline">
          Go to dashboard
        </a>
      </CardContent>
    </Card>
  );
}

function RevokedCode() {
  return (
    <Card className="w-full max-w-md mx-auto mt-12">
      <CardHeader>
        <CardTitle>Sign-in code revoked</CardTitle>
        <CardDescription>
          This sign-in was cancelled. Start a new sign-in in Zaino Desktop
          to try again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end">
        <a href="/dashboard" className="mt-6 block w-fit text-sm text-primary hover:underline">
          Go to dashboard
        </a>
      </CardContent>
    </Card>
  );
}

function ApprovedCode() {
  return (
    <Card className="w-full max-w-md mx-auto mt-12">
      <CardHeader>
        <CardTitle>Device approved</CardTitle>
        <CardDescription>
          Zaino Desktop can now collect your key and account details. Return
          to the desktop app — signing in will complete automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end">
        <a href="/dashboard" className="mt-6 block w-fit text-sm text-primary hover:underline">
          Go to dashboard
        </a>
      </CardContent>
    </Card>
  );
}
