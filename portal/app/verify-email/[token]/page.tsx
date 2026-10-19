import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ConfirmEmailForm } from "@/components/auth/verify-email-forms";

export const metadata: Metadata = { title: "Confirm Your Email" };

/**
 * /verify-email/[token] — the page the confirmation mail links to.
 *
 * The token is the PATH SEGMENT, matching `verifyLink()` in
 * lib/auth/verify-tokens.ts. The page renders a form; only submitting it
 * consumes the token, so a mail scanner fetching the URL cannot verify the
 * address or burn the link.
 */
export default async function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AuthShell
      title="Confirm your email"
      subtitle="Confirming proves you can receive mail at this address — that is where we send payment updates."
      footer={
        <>
          Back to{" "}
          <Link href="/dashboard" className="text-black underline-offset-4 hover:underline">
            your dashboard
          </Link>
        </>
      }
    >
      <ConfirmEmailForm token={token} />
    </AuthShell>
  );
}
