import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { RequestResetForm } from "@/components/auth/reset-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account email and we will send a reset link."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/sign-in" className="text-black underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <RequestResetForm />
    </AuthShell>
  );
}
