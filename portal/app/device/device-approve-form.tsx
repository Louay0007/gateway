/** Client island: the approve button posts to the verify endpoint. 'use client' stays in its own file so the page can remain a server component. */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ApproveForm({
  userCode,
  email,
}: {
  userCode: string;
  email: string;
}) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [revoked, setRevoked] = useState(0);

  async function approve() {
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/auth/device/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: userCode }),
      });
      if (!res.ok) {
        // The API answers `{ error: { code, message } }` (lib/api/errors.ts).
        // Reading `body.error` as a string showed every real message —
        // "subscription not active", "code expired" — as "[object Object]".
        const body = await res.json().catch(() => ({}));
        const msg =
          typeof body?.error?.message === 'string'
            ? body.error.message
            : `Approval failed (${res.status})`;
        throw new Error(msg);
      }
      const body = await res.json().catch(() => ({}));
      const count = Number(body?.revokedDevices ?? 0);
      setRevoked(Number.isFinite(count) && count > 0 ? count : 0);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Approval failed');
      setStatus('error');
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto mt-12">
      <CardHeader>
        <CardTitle>Sign in to Zaino Desktop</CardTitle>
        <CardDescription>
          Approve Zaino Desktop for <strong>{email}</strong>. This signs the
          device into your organization — your key is then collected
          automatically by the desktop app. Nothing secret is shown on this
          page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'error' ? (
          <p className="text-sm text-destructive">
            {errorMsg || 'Approval failed — try again, or start a new sign-in in Zaino Desktop.'}
          </p>
        ) : null}
        <div className="mt-4 mb-2 text-xs text-muted-foreground">
          Code: <span className="font-mono select-all">{userCode}</span>
        </div>
        {status === 'done' && revoked > 0 ? (
          <p className="mb-2 text-sm text-muted-foreground">
            Signed out on {revoked} other {revoked === 1 ? 'computer' : 'computers'}.{' '}
            Only one device can be signed in at a time.
          </p>
        ) : null}
        <Button
          onClick={approve}
          disabled={status === 'submitting' || status === 'done'}
          className="w-full"
        >
          {status === 'submitting'
            ? 'Approving…'
            : status === 'done'
            ? 'Approved'
            : 'Approve device'}
        </Button>
      </CardContent>
    </Card>
  );
}
