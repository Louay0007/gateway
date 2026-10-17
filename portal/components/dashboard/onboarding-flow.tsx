"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  Copy,
  KeyRound,
  Rocket,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { apiSend } from "@/lib/api/use-api";
import type { KeyView, SubscriptionBundle } from "@/lib/api/types";
import type { CreateKeyResult } from "@/lib/keys/types";
import { toast } from "sonner";

/**
 * OnboardingFlow — guided first-run experience for new users.
 *
 * Five steps following the audit specification:
 *   1. Welcome + value proposition
 *   2. Plan selection (links to /pricing)
 *   3. Create first API key (after payment/trial)
 *   4. First request with curl snippet
 *   5. Link to full docs
 *
 * Shows only when the user has no active subscription OR no keys.
 * Dismissable and remembers dismissal in localStorage.
 */

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "plan", label: "Choose plan" },
  { id: "key", label: "Create key" },
  { id: "request", label: "First request" },
  { id: "docs", label: "Next steps" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface OnboardingFlowProps {
  bundle: SubscriptionBundle;
  keys: KeyView[];
  onComplete: () => void;
}

export function OnboardingFlow({ bundle, keys, onComplete }: OnboardingFlowProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = React.useState<StepId>("welcome");
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [creatingKey, setCreatingKey] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const hasPlan = bundle.state !== "no_subscription";
  const hasKeys = keys.length > 0;

  // Determine initial step based on current state
  React.useEffect(() => {
    if (hasPlan && hasKeys) {
      setCurrentStep("request");
    } else if (hasPlan && !hasKeys) {
      setCurrentStep("key");
    } else {
      setCurrentStep("welcome");
    }
  }, [hasPlan, hasKeys]);

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;

  const handleNext = () => {
    const idx = STEPS.findIndex((s) => s.id === currentStep);
    const next = STEPS[idx + 1];
    if (next) setCurrentStep(next.id);
  };

  const handleBack = () => {
    const idx = STEPS.findIndex((s) => s.id === currentStep);
    const prev = STEPS[idx - 1];
    if (prev) setCurrentStep(prev.id);
  };

  const handleCreateKey = async () => {
    setCreatingKey(true);
    const result = await apiSend<CreateKeyResult>("/api/keys", {
      method: "POST",
      body: { name: "My first key", models: ["fast"] },
    });
    setCreatingKey(false);

    if ("error" in result) {
      toast.error(result.error.message);
      return;
    }

    setCreatedKey(result.data.plaintext);
    toast.success("API key created successfully");
    handleNext();
  };

  const handleCopyCurl = () => {
    const key = createdKey || keys[0]?.keyPrefix || "YOUR_API_KEY";
    const curl = `curl https://api.zaino.ai/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "fast",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
    navigator.clipboard.writeText(curl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  const handleDismiss = () => {
    localStorage.setItem("zaino-onboarding-dismissed", "true");
    onComplete();
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress indicator */}
      <div className="mb-6 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {currentStepIndex + 1} of {STEPS.length}</span>
          <button
            type="button"
            onClick={handleDismiss}
            className="hover:text-foreground transition-colors"
          >
            Skip onboarding
          </button>
        </div>
        <Progress value={progress} className="h-1.5" />
        <div className="flex justify-between">
          {STEPS.map((step, i) => (
            <span
              key={step.id}
              className={`text-[10px] font-medium transition-colors ${
                i <= currentStepIndex ? "text-primary" : "text-muted-foreground/50"
              }`}
            >
              {step.label}
            </span>
          ))}
        </div>
      </div>

      {/* Step content */}
      <Card className="border-primary/20 shadow-lg">
        <CardContent className="pt-6">
          {currentStep === "welcome" && (
            <WelcomeStep onNext={handleNext} />
          )}

          {currentStep === "plan" && (
            <PlanStep
              bundle={bundle}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === "key" && (
            <KeyStep
              creating={creatingKey}
              onCreate={handleCreateKey}
              onNext={handleNext}
              onBack={handleBack}
              hasKeys={hasKeys}
            />
          )}

          {currentStep === "request" && (
            <RequestStep
              apiKey={createdKey || keys[0]?.keyPrefix}
              onCopy={handleCopyCurl}
              copied={copied}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === "docs" && (
            <DocsStep onFinish={onComplete} onBack={handleBack} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Step Components
 * ────────────────────────────────────────────────────────────────────── */

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10">
        <Rocket className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">
          Welcome to Zaino AI
        </h2>
        <p className="text-muted-foreground">
          Your gateway to Claude, GPT, and frontier models — unified billing,
          spend ceilings, and instant API keys.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <FeatureCard
          icon={Zap}
          title="Instant access"
          description="Create keys immediately after signup"
        />
        <FeatureCard
          icon={Wallet}
          title="Spend control"
          description="Hard caps prevent surprise bills"
        />
        <FeatureCard
          icon={Code2}
          title="Drop-in compatible"
          description="Works with OpenAI SDK & Codex CLI"
        />
      </div>

      <Button size="lg" onClick={onNext} className="w-full sm:w-auto">
        Get started
        <ArrowRight />
      </Button>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 text-left">
      <Icon className="mb-2 size-5 text-primary" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function PlanStep({
  bundle,
  onNext,
  onBack,
}: {
  bundle: SubscriptionBundle;
  onNext: () => void;
  onBack: () => void;
}) {
  const hasPlan = bundle.state !== "no_subscription";
  const trialEligible = bundle.trial?.eligible ?? false;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          Choose your plan
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {trialEligible
            ? "Start with a free 7-day trial — no payment required."
            : "Pick a plan to unlock API access."}
        </p>
      </div>

      {hasPlan ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center dark:border-green-900/30 dark:bg-green-950/20">
          <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
            <Check className="size-5" />
            <span className="font-medium">You have an active plan</span>
          </div>
          <p className="mt-1 text-sm text-green-600 dark:text-green-500">
            {bundle.plan?.name} · {bundle.plan?.models?.length ?? 0} models available
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <PlanCard
            name="Starter"
            price="$19"
            features={["2 API keys", "$5 included spend", "fast + smart models"]}
            recommended={false}
          />
          <PlanCard
            name="Pro"
            price="$99"
            features={["10 API keys", "$30 included spend", "All models including frontier"]}
            recommended
          />
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        {hasPlan ? (
          <Button onClick={onNext}>
            Continue
            <ArrowRight />
          </Button>
        ) : (
          <Button nativeButton={false} render={<Link href="/pricing" />}>
            View plans
            <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}

function PlanCard({
  name,
  price,
  features,
  recommended,
}: {
  name: string;
  price: string;
  features: string[];
  recommended: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl border p-5 ${
        recommended
          ? "border-primary bg-primary/5"
          : "border-border bg-card"
      }`}
    >
      {recommended && (
        <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          Recommended
        </Badge>
      )}
      <p className="text-lg font-semibold">{name}</p>
      <p className="text-2xl font-bold">{price}
        <span className="text-sm font-normal text-muted-foreground">/mo</span>
      </p>
      <ul className="mt-4 space-y-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KeyStep({
  creating,
  onCreate,
  onNext,
  onBack,
  hasKeys,
}: {
  creating: boolean;
  onCreate: () => void;
  onNext: () => void;
  onBack: () => void;
  hasKeys: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="size-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          Create your first API key
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Keys authenticate your requests. You can create up to your plan limit.
        </p>
      </div>

      {hasKeys ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center dark:border-green-900/30 dark:bg-green-950/20">
          <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
            <Check className="size-5" />
            <span className="font-medium">You already have API keys</span>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            This will create a key named &quot;My first key&quot; with access to
            your plan&apos;s allowed models.
          </p>
          <Button
            size="lg"
            onClick={onCreate}
            disabled={creating}
            className="min-w-[160px]"
          >
            {creating ? (
              <>Creating…</>
            ) : (
              <>
                <KeyRound />
                Create API key
              </>
            )}
          </Button>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        {hasKeys && (
          <Button onClick={onNext}>
            Continue
            <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}

function RequestStep({
  apiKey,
  onCopy,
  copied,
  onNext,
  onBack,
}: {
  apiKey?: string;
  onCopy: () => void;
  copied: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  const curlSnippet = `curl https://api.zaino.ai/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey || "YOUR_API_KEY"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "fast",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Code2 className="size-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          Make your first request
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Test your key with this curl command. It uses the{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">fast</code>{" "}
          model tier.
        </p>
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">
          {curlSnippet}
        </pre>
        <Button
          variant="secondary"
          size="sm"
          className="absolute right-2 top-2"
          onClick={onCopy}
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">Model tiers</p>
        <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">fast</Badge>
            <span>Claude Haiku / GPT-4o-mini — quick responses</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">smart</Badge>
            <span>Claude Sonnet / GPT-4o — balanced quality</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">frontier</Badge>
            <span>Claude Opus / o1 — best reasoning</span>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>
          Continue
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function DocsStep({
  onFinish,
  onBack,
}: {
  onFinish: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">
          You&apos;re all set!
        </h2>
        <p className="text-muted-foreground">
          Your gateway is ready. Explore the docs for integration guides,
          SDK setup, and advanced configuration.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DocLink
          href="/dashboard/docs"
          title="Integration guide"
          description="Codex CLI, Claude Code, OpenAI SDK setup"
        />
        <DocLink
          href="/dashboard/keys"
          title="Manage keys"
          description="Create, revoke, and monitor API keys"
        />
        <DocLink
          href="/dashboard/usage"
          title="Usage dashboard"
          description="Track requests, tokens, and spend"
        />
        <DocLink
          href="/dashboard/billing"
          title="Billing & plans"
          description="Upgrade, view payments, manage subscription"
        />
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button size="lg" onClick={onFinish}>
          Go to dashboard
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function DocLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md"
    >
      <p className="font-medium group-hover:text-primary">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </Link>
  );
}