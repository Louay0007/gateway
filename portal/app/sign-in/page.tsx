import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasLiveSession } from "@/lib/auth/authorize";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign In to Zaino AI",
  description:
    "Sign in to Zaino AI — manage API keys, view usage, and handle billing for your organisation.",
};

/**
 * /sign-in — signed-in visitors bounce to /dashboard (an authed user has
 * no business on the sign-in form). callbackUrl passes through only when
 * it is a same-site relative path; the server action re-validates.
 *
 * The redirect is gated on hasLiveSession(), NOT on auth(): a JWT that
 * parses but no longer resolves to a live user (stale password stamp, or a
 * deleted domain row) must land here on the form, because /dashboard's
 * shell gate rejects the same token and would otherwise bounce back
 * forever. See hasLiveSession.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  if (await hasLiveSession()) redirect("/dashboard");
  const params = await searchParams;
  const raw = params.callbackUrl ?? "/dashboard";
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to manage your keys and usage."
      footer={
        <>
          No account yet?{" "}
          <Link href="/sign-up" className="text-black underline-offset-4 hover:underline dark:text-white">
            Create one
          </Link>
        </>
      }
    >
      <SignInForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
