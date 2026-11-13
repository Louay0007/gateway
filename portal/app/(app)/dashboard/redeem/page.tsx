import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireActiveOrg } from "@/lib/auth/authorize";
import { RedeemForm } from "@/components/trial/redeem-form";
import { getTrialStatus, hasRedeemableTrialCode } from "@/lib/trial/service";
import { compact } from "@/lib/dashboard/format";
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

  const [trial, campaignEndedRaw] = await Promise.all([
    getTrialStatus(orgId),
    hasRedeemableTrialCode(),
  ]);
  const campaignEnded = !campaignEndedRaw;

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Redeem a Free Trial
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Promo codes unlock temporary access to fast and smart. Enter one
          below if you have it.
          {/*
            The notice is driven by hasRedeemableTrialCode(), never a date
            constant. ZAINO-FREE-OCT26 expired on 31 October; 0036 added
            ZAINO-FREE-NOV26, so this is quiet today — but on 1 December it
            says the campaign ended instead of telling people to hurry and
            redeem a code the API will answer 410 for.
          */}
          {campaignEnded && (
            <> The free trial campaign has now ended.</>
          )}
        </p>
      </div>

      {trial?.active ? (
        <Card className="border-success/30 bg-success/10 border-success/30 bg-success/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-success text-success">
              <CheckCircle2 className="h-5 w-5" />
              Trial Active
            </CardTitle>
            <CardDescription className="text-success text-success">
              Your free trial is live and will expire on{" "}
              {new Date(trial.expiresAt!).toLocaleDateString("en-TN", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-success text-success">
              <Clock className="h-4 w-4" />
              <span>{trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""} remaining</span>
            </div>
            <div className="text-sm text-success text-success">
              {/* 0039: one shared pool — listing per-model figures implied
                  separate allowances that do not exist. */}
              <strong>Limits:</strong>{" "}
              {compact(
                Object.values(trial.tokenLimits ?? {}).reduce(
                  (sum, n) => sum + (Number(n) > 0 ? Number(n) : 0),
                  0,
                ),
              )}{" "}
              shared tokens across the trial period.
            </div>
            <div className="pt-2">
              <Link href="/dashboard/keys" className="flex w-full items-center justify-center rounded-md border border-success/30 bg-transparent px-4 py-2 text-sm font-medium text-success hover:bg-success/10 border-success/30 text-success hover:bg-success/20">
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

          <Card className="border-warning/30 bg-warning/10 bg-warning/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-warning text-warning">
                <AlertCircle className="h-5 w-5" />
                After Your Trial
              </CardTitle>
              <CardDescription className="text-warning">
                When your trial expires, API access pauses automatically. Upgrade to a paid plan to continue — your keys and usage history are preserved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/pricing" className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-muted hover:bg-primary/80">
                View Pricing Plans
              </Link>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}