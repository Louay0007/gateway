import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireActiveOrg } from "@/lib/auth/authorize";
import { RedeemForm } from "@/components/trial/redeem-form";
import { getTrialStatus } from "@/lib/trial/service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Redeem Trial Code" };

export default async function RedeemPage() {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  let orgId: string;
  try {
    const { orgId: resolved } = await requireActiveOrg();
    orgId = resolved;
  } catch {
    redirect("/sign-up");
  }

  const trial = await getTrialStatus(orgId);

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
          Redeem a Free Trial
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Enter a promo code to unlock 3 days of free access to Haiku 5.5
            and Sonnet 5.5.
        </p>
      </div>

      {trial?.active ? (
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-900 dark:text-green-300">
              <CheckCircle2 className="h-5 w-5" />
              Trial Active
            </CardTitle>
            <CardDescription className="text-green-800 dark:text-green-300">
              Your free trial is live and will expire on{" "}
              {new Date(trial.expiresAt!).toLocaleDateString("en-TN", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
              <Clock className="h-4 w-4" />
              <span>{trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""} remaining</span>
            </div>
            <div className="text-sm text-green-800 dark:text-green-300">
              <strong>Limits:</strong>{" "}
              {Object.entries(trial.promptLimits)
                .map(([model, limit]) => `${limit} ${model} prompts`)
                .join(", ")}{" "}
              total across the trial period.
            </div>
            <div className="pt-2">
              <Link href="/dashboard/keys" className="flex w-full items-center justify-center rounded-md border border-green-300 bg-transparent px-4 py-2 text-sm font-medium text-green-900 hover:bg-green-100 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-900/50">
                Go to API Keys
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Enter Your Code</CardTitle>
              <CardDescription>
                Paste the trial code you received and click Redeem.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RedeemForm />
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-300">
                <AlertCircle className="h-5 w-5" />
                After Your Trial
              </CardTitle>
              <CardDescription className="text-amber-800 dark:text-amber-300">
                When your trial expires, API access pauses automatically. Upgrade to a paid plan to continue — your keys and usage history are preserved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/pricing" className="flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-gray-700 dark:hover:bg-gray-600">
                View Pricing Plans
              </Link>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}