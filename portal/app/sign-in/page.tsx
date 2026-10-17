import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to Zaino AI — manage API keys, view usage, and handle billing for your organisation.",
};

/**
 * /sign-in — signed-in visitors bounce to /dashboard (an authed user has
 * no business on the sign-in form). callbackUrl passes through only when
 * it is a same-site relative path; the server action re-validates.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
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
          <Link href="/sign-up" className="text-black underline-offset-4 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <SignInForm callbackUrl={callbackUrl} />
    </AuthShell>
  );
}
