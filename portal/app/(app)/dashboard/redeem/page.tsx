import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import { auth } from "@/auth";
import { requireActiveOrg } from "@/lib/auth/authorize";
import { RedeemForm } from "@/components/trial/redeem-form";
import { getTrialStatus, hasRedeemableTrialCode } from "@/lib/trial/service";
import { compact } from "@/lib/dashboard/format";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Redeem Trial Code" };

/**
 * /dashboard/redeem — a one-time onboarding action.
 *
 * The page used to be a centred `max-w-lg` column with its own `h1`, which
 * put a second masthead under the shell header and left the console's
 * left-aligned grid for a marketing-style centred block. It now uses the
 * same `PageHeader` + card rhythm as every other console page.
 *
 * The duplicated utility classes are gone too (`bg-warning/10
 * bg-warning/10`, `text-success text-success`, `hover:bg-muted
 * hover:bg-primary/80`) — they were the visible symptom of this page
 * having been edited by copy-paste, and the last one made the primary CTA
 * flash grey on hover.
 */
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
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageHeader
        size="console"
        lede={
          campaignEnded
            ? "The free trial campaign has ended. A paid plan is the way in now."
            : "A promo code unlocks temporary access to every paid tier — smart, frontier and fable."
        }
      />

      {trial?.active ? (
        <Card className="border-success/30 bg-success/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              Trial active
            </CardTitle>
            <CardDescription>
              Expires{" "}
              {new Date(trial.expiresAt!).toLocaleDateString("en-TN", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">Days remaining</dt>
                <dd className="font-medium tabular-nums">
                  {trial.daysRemaining} day{trial.daysRemaining !== 1 ? "s" : ""}
                </dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">Token allowance</dt>
                <dd className="font-medium tabular-nums">
                  {/* 0049: the partner trial has no token pool at all — an
                      empty token_limits map is how "unlimited" is stored.
                      Summing it would print "0 shared tokens", the opposite
                      of the grant. */}
                  {trial.tokens === null ? "Unlimited" : compact(trial.tokens)}
                </dd>
              </div>
            </dl>
            <div>
              <Button size="sm" nativeButton={false} render={<Link href="/dashboard/keys" />}>
                Go to API keys
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enter your code</CardTitle>
              <CardDescription>
                Paste the trial code you received and redeem it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RedeemForm />
            </CardContent>
          </Card>

          <Card className="border-warning/30 bg-warning/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-warning">
                <AlertCircle className="size-4" aria-hidden />
                After the trial
              </CardTitle>
              <CardDescription>
                When the trial expires, API access pauses automatically. Your
                keys and usage history are preserved — a paid plan restores
                service immediately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href="/pricing" />}
              >
                View plans
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}