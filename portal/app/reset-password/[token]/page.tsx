import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { CompleteResetForm } from "@/components/auth/reset-forms";

export const metadata: Metadata = { title: "Choose a New Password" };

export default async function ResetTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { token: pathToken } = await params;
  const { token: queryToken } = await searchParams;

  /**
   * The token is the PATH SEGMENT — that is what `resetLink()` builds, and
   * what the hidden field below carries.
   *
   * `?token=` is accepted as a FALLBACK because links were already sent in
   * the old `/reset-password/confirm?token=…` shape. Those URLs resolve
   * against this same route with `params.token === "confirm"`, so without
   * the fallback every outstanding reset link would keep failing exactly
   * as it did before the fix.
   *
   * The query wins when present, because that is the one shape where the
   * path segment is not the token.
   */
  const token = queryToken ?? pathToken;

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="This link expires 30 minutes after it was sent."
      footer={
        <>
          Link expired?{" "}
          <Link href="/reset-password" className="text-black underline-offset-4 hover:underline dark:text-white">
            Request a new one
          </Link>
        </>
      }
    >
      <CompleteResetForm token={token} />
    </AuthShell>
  );
}
