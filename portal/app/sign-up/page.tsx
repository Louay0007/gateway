import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasLiveSession } from "@/lib/auth/authorize";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create Your Zaino AI Account",
  description:
    "Sign up for Zaino AI — get instant API keys, usage-based billing, and D17 payment for Tunisia.",
};

export default async function SignUpPage() {
  // Same gate as /sign-in: a parseable-but-stale token must reach a form
  // that replaces it, not a redirect pair it can never satisfy.
  if (await hasLiveSession()) redirect("/dashboard");
  return (
    <AuthShell
      title="Create your account"
      subtitle="One account for keys, usage, and billing."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="text-gray-900 dark:text-gray-100 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
