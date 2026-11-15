import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasLiveSession } from "@/lib/auth/authorize";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { SocialButtons, SocialDivider, SocialNotice } from "@/components/auth/social-buttons";
import { enabledProviders } from "@/lib/auth/oauth";

export const metadata: Metadata = {
  title: "Create Your Zaino AI Account",
  description:
    "Sign up for Zaino AI — get instant API keys, usage-based billing, and D17 payment for Tunisia.",
};

/**
 * /sign-up — same social row as /sign-in (plan §7 lists both).
 *
 * The buttons start the SAME flow: an unknown email at the provider creates
 * an identity here, a known one signs in. There is no separate "register"
 * path at a provider, so one set of buttons serves both pages and there is
 * only one flow to get wrong.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ social?: string }>;
}) {
  // Same gate as /sign-in: a parseable-but-stale token must reach a form
  // that replaces it, not a redirect pair it can never satisfy. Same
  // destination too — /chat, so signup, sign-in and the landing page all
  // agree on where a session begins.
  if (await hasLiveSession()) redirect("/chat");

  const params = await searchParams;
  const providers = enabledProviders();

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account for keys, usage, and billing."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SocialNotice reason={params.social} />
      <SocialButtons providers={providers} returnTo="/chat" />
      {providers.length > 0 ? <SocialDivider /> : null}
      <SignUpForm />
    </AuthShell>
  );
}
