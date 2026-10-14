"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, KeyRound, TriangleAlert, UserRound } from "lucide-react";

import { PasswordChecklist } from "@/components/auth/password-checklist";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, PanelSkeleton } from "@/components/dashboard/states";
import { apiSend, useApi } from "@/lib/api/use-api";
import type { OrgListItem } from "@/lib/api/types";
import { toast } from "sonner";

/**
 * SettingsForms — account, organization, password, deletion.
 *
 * Every card here now has a backend. Previously all four submitted into a
 * `toast("saved")` and reloaded to the same value, which is the worst
 * possible version of a settings page: it looks finished, and it lies.
 *
 *   profile name   → PATCH  /api/profile            (self-scoped)
 *   org name/slug  → PATCH  /api/orgs/[id]          (owner only)
 *   password       → POST   /api/profile/password   (re-auth + session kill)
 *   delete account → POST   /api/account/delete     (owner only, type-to-confirm)
 *
 * The delete card is the one place this page is deliberately slow: it asks
 * for the slug, states exactly what survives (the ledger) and what does not
 * (every key), and the server checks the slug too — a confirmation that
 * lives only in the UI is not a confirmation.
 */
export function SettingsForms() {
  return (
    <>
      <ProfileCard />
      <OrgCard />
      <PasswordCard />
      <DangerCard />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Profile
// ───────────────────────────────────────────────────────────────────────

function ProfileCard() {
  const router = useRouter();
  const orgs = useApi<{ orgs: OrgListItem[] }>("/api/orgs");
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The display name lives on `users`, which no endpoint exposes for
  // reading — `/api/orgs` is org-scoped by design. So the field starts
  // empty and is saved optimistically against the server's copy: blank
  // means "unchanged", and a successful save fills it in. Showing the
  // previous mock name here would be inventing it again.
  const saved = name.length > 0;

  async function save() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);

    const result = await apiSend<{ name: string }>("/api/profile", {
      method: "PATCH",
      body: { name: name.trim() },
    });
    setSaving(false);

    if ("error" in result) {
      setError(result.error.message);
      return;
    }
    setName(result.data.name);
    toast.success("Profile updated.");
    orgs.reload();
    router.refresh();
  }

  return (
    <Card id="profile">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="size-4" />
          Profile
        </CardTitle>
        <CardDescription>How you appear across the dashboard.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:max-w-md">
        <div className="grid gap-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder={saved ? undefined : "Your name"}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby="profile-name-hint"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          <p id="profile-name-hint" className="text-xs text-muted-foreground">
            {error ?? "Up to 120 characters."}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="profile-email">Email</Label>
          {/* readOnly, not disabled: the field is informational (email is
              changed by an operator), and a disabled Input dims to 50%
              opacity, which dropped this placeholder to 1.64:1 — the
              remaining Lighthouse color-contrast failure on this page. A
              readOnly field stays non-editable but keeps full-contrast,
              selectable text. */}
          <Input id="profile-email" readOnly placeholder="Your sign-in address" />
          <p className="text-xs text-muted-foreground">
            Email changes are handled by an operator. It is the identity your
            session resolves to, and changing it would detach your usage history.
          </p>
        </div>

        <div>
          <Button size="sm" disabled={!name.trim() || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Organization
// ───────────────────────────────────────────────────────────────────────

function OrgCard() {
  const { data, error, loading, reload } = useApi<{ orgs: OrgListItem[] }>("/api/orgs");
  const org = data?.orgs?.[0] ?? null;

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  // Seeded once, when the org first arrives — writing to state during
  // render would fight the user typing.
  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (org && seeded.current !== org.id) {
      seeded.current = org.id;
      setName(org.name);
      setSlug(org.slug);
    }
  }, [org]);

  const isOwner = org?.role === "owner";
  const slugValid = /^[a-z0-9-]+$/.test(slug) && slug.length >= 2;
  const dirty = org ? name !== org.name || slug !== org.slug : false;

  async function save() {
    if (!org || saving) return;
    setSaving(true);
    setFieldError(null);

    const result = await apiSend<{ organization: OrgListItem }>(
      `/api/orgs/${org.id}`,
      { method: "PATCH", body: { name, slug } },
    );
    setSaving(false);

    if ("error" in result) {
      // Validation errors belong on the field they are about, not in a
      // banner above a four-card page.
      if (result.error.code === "validation") setFieldError(result.error.message);
      else toast.error(result.error.message);
      return;
    }

    // The server may have picked a different slug on collision.
    setName(result.data.organization.name);
    setSlug(result.data.organization.slug);
    reload();
    toast.success("Organization updated.");
  }

  if (loading) return <PanelSkeleton rows={2} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <Card id="organization">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4" />
          Organization
        </CardTitle>
        <CardDescription>
          The billing entity. Keys, usage, and the subscription all belong to it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:max-w-md">
        {!org ? (
          <p className="text-sm text-muted-foreground">
            This account has no organization yet.
          </p>
        ) : !isOwner ? (
          <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
            You are a member of <span className="font-medium">{org.name}</span> with
            the <span className="font-medium">{org.role}</span> role. Only the owner
            can rename the account or change its slug.
          </p>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="org-name">Name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            disabled={!isOwner}
            aria-invalid={Boolean(fieldError) || undefined}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="org-slug">Slug</Label>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">/</span>
            <Input
              id="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              maxLength={48}
              disabled={!isOwner}
              aria-invalid={!slugValid || Boolean(fieldError) || undefined}
              aria-describedby="org-slug-hint"
            />
          </div>
          <p id="org-slug-hint" className="text-xs text-muted-foreground">
            {isOwner
              ? "Lowercase letters, numbers, and dashes only — at least 2 characters. If it is taken we pick a nearby one and save it here."
              : "The account's public handle."}
          </p>
        </div>

        {fieldError ? (
          <p role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        ) : null}

        {isOwner ? (
          <div>
            <Button
              size="sm"
              disabled={!dirty || !slugValid || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save organization"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Password
// ───────────────────────────────────────────────────────────────────────

function PasswordCard() {
  const router = useRouter();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    current.length > 0 && next.length >= 12 && next === confirm && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setErrors({});

    const result = await apiSend<{ changed: boolean; reauthenticate: boolean }>(
      "/api/profile/password",
      { body: { currentPassword: current, newPassword: next } },
    );
    setSaving(false);

    if ("error" in result) {
      // The service tags which field failed; without a field we cannot
      // place it, so it goes on the one field the customer most likely got
      // wrong.
      const field = result.error.message.toLowerCase().includes("current")
        ? "currentPassword"
        : "newPassword";
      setErrors({ [field]: result.error.message });
      return;
    }

    // Every session was invalidated server-side, including this one. Going
    // anywhere else would bounce to sign-in anyway; going there directly is
    // honest about what just happened.
    toast.success("Password updated. Sign in again on your other devices.");
    router.push("/sign-in?passwordChanged=1");
  }

  return (
    <Card id="password">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          Password
        </CardTitle>
        <CardDescription>
          Changing your password signs out every device, including this one.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:max-w-md">
        <div className="grid gap-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            aria-invalid={Boolean(errors.currentPassword) || undefined}
            aria-describedby="current-password-error"
          />
          {errors.currentPassword ? (
            <p
              id="current-password-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {errors.currentPassword}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={Boolean(errors.newPassword) || mismatch || undefined}
            aria-describedby="password-hint"
          />
          <PasswordChecklist password={next} />
          {errors.newPassword ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.newPassword}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch || undefined}
            aria-describedby="confirm-password-error"
          />
          {mismatch ? (
            <p
              id="confirm-password-error"
              role="alert"
              className="text-xs text-destructive"
            >
              Passwords do not match.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? "Updating…" : "Update password"}
          </Button>
          {current ? (
            <a
              href="/reset-password"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Forgotten your current password?
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Deletion
// ───────────────────────────────────────────────────────────────────────

function DangerCard() {
  const { data, loading } = useApi<{ orgs: OrgListItem[] }>("/api/orgs");
  const org = data?.orgs?.[0] ?? null;
  const isOwner = org?.role === "owner";

  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const matches = org ? typed.trim().toLowerCase() === org.slug.toLowerCase() : false;

  async function destroy() {
    if (!org || busy || !matches) return;
    setBusy(true);
    setError(null);

    const result = await apiSend<{ deleted: boolean; revokedKeys: number }>(
      "/api/account/delete",
      { body: { confirmSlug: typed.trim() } },
    );
    setBusy(false);

    if ("error" in result) {
      setError(result.error.message);
      return;
    }

    // The org is now `deleted`, so every dashboard route answers 404. There
    // is nowhere in the product to show a confirmation, so say it here.
    toast.success(
      `Account deleted. ${result.data.revokedKeys} key${result.data.revokedKeys === 1 ? "" : "s"} revoked.`,
      { duration: 8000 },
    );
    setOpen(false);
    setTyped("");
    window.location.assign("/");
  }

  if (loading) return null;

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <TriangleAlert className="size-4" />
          Delete account
        </CardTitle>
        <CardDescription>
          Cancels the subscription and revokes every key. Your usage history is
          kept — it is the billing record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isOwner ? (
          <p className="text-sm text-muted-foreground">
            Only the account owner can delete it.
          </p>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        )}
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setTyped("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {org?.name}?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Every API key stops working immediately,
              the subscription is canceled, and the dashboard becomes
              unreachable. Your usage history is retained for billing.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-2">
            <Label htmlFor="confirm-slug">
              Type <span className="font-mono">{org?.slug}</span> to confirm
            </Label>
            <Input
              id="confirm-slug"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={typed.length > 0 && !matches ? true : undefined}
              aria-describedby="confirm-slug-hint"
            />
            <p id="confirm-slug-hint" className="text-xs text-muted-foreground">
              {error ??
                (typed.length > 0 && !matches
                  ? "That does not match the account slug."
                  : "The server checks this too, so it cannot be skipped.")}
            </p>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Keep account</Button>} />
            <Button
              variant="destructive"
              disabled={!matches || busy}
              onClick={() => void destroy()}
            >
              {busy ? "Deleting…" : "Delete this account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}