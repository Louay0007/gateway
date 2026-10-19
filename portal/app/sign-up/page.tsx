import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create Your Zaino AI Account",
  description:
    "Sign up for Zaino AI — get instant API keys, usage-based billing, and D17 payment for Tunisia.",
};

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  return (
    <AuthShell
      title="Create your account"
      subtitle="One account for keys, usage, and billing."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="text-black underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
