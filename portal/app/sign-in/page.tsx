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
 * /sign-in — signed-in visitors bounce to /chat (an authed user has no
 * business on the sign-in form). callbackUrl passes through only when it is
 * a same-site relative path; the server action re-validates.
 *
 * WHY /chat AND NOT /dashboard. The landing page sends a signed-in visitor
 * to /chat (app/(marketing)/page.tsx), so defaulting the form to /dashboard
 * meant two different answers to "where do I land when I sign in": bounce
 * off `/` and you get chat, sign out and back in and you get the console.
 * Chat is the product; the console is one click away in its sidebar.
 *
 * The redirect is gated on hasLiveSession(), NOT on auth(): a JWT that
 * parses but no longer resolves to a live user (stale password stamp, or a
 * deleted domain row) must land here on the form, because the shell gate
 * rejects the same token and would otherwise bounce back forever. See
 * hasLiveSession.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  if (await hasLiveSession()) redirect("/chat");
  const params = await searchParams;
  const raw = params.callbackUrl ?? "/chat";
  const callbackUrl = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/chat";
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
