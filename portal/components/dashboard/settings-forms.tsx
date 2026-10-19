"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, TriangleAlert, UserRound } from "lucide-react";

import { PasswordChecklist } from "@/components/auth/password-checklist";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { useShellIdentity } from "@/components/dashboard/shell-identity";
import { apiSend, useApi } from "@/lib/api/use-api";
import type { OrgListItem, ProfileView } from "@/lib/api/types";
import { initialsFor } from "@/lib/dashboard/format";
import { toast } from "sonner";

/**
 * SettingsForms — account, organization, password, deletion.
 *
 * Every card here now has a backend. Previously all four submitted into a
 * `toast("saved")` and reloaded to the same value, which is the worst
 * possible version of a settings page: it looks finished, and it lies.
 *
 *   profile read   → GET    /api/profile            (self-scoped)
 *   profile write  → PATCH  /api/profile            (self-scoped)
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
      <PasswordCard />
      <DangerCard />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Profile
// ───────────────────────────────────────────────────────────────────────

/**
 * What a 256 KiB data URL may be. The server re-checks all of this
 * (magic bytes, decoded size) — the accept attribute and size check here
 * only fail fast, before a doomed upload crosses the network.
 */
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 256 * 1024;

function ProfileCard() {
  const router = useRouter();
  const { refresh: refreshShell } = useShellIdentity();
  const { data, error, loading, reload, set } = useApi<ProfileView>("/api/profile");
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Seeded once, when the profile first arrives — writing to state during
  // render would fight the user typing.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (data && !seeded.current) {
      seeded.current = true;
      setName(data.name);
    }
  }, [data]);

  const dirty = data ? name.trim() !== data.name : false;

  async function saveName() {
    if (saving || !dirty) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setSaveError("Enter a name.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    const result = await apiSend<{ name: string; image: string | null }>("/api/profile", {
      method: "PATCH",
      body: { name: trimmed },
    });
    setSaving(false);

    if ("error" in result) {
      setSaveError(result.error.message);
      return;
    }
    set((prev) => (prev ? { ...prev, name: result.data.name } : prev));
    // The sidebar and header read the shell snapshot, not this component's
    // state. Without this they keep showing the old name until a reload.
    refreshShell();
    toast.success("Profile updated.");
    router.refresh();
  }

  async function uploadPicture(file: File) {
    setImageError(null);
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Pictures are limited to 256 KB.");
      return;
    }
    setUploading(true);

    let dataUrl: string;
    try {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read that file."));
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    } catch (e) {
      setUploading(false);
      setImageError(e instanceof Error ? e.message : "Could not read that file.");
      return;
    }

    const result = await apiSend<{ name: string; image: string | null }>("/api/profile", {
      method: "PATCH",
      body: { image: dataUrl },
    });
    setUploading(false);

    if ("error" in result) {
      setImageError(result.error.message);
      return;
    }
    set((prev) => (prev ? { ...prev, image: result.data.image } : prev));
    refreshShell();
    toast.success("Profile picture updated.");
    router.refresh();
  }

  async function removePicture() {
    setImageError(null);
    setUploading(true);
    const result = await apiSend<{ name: string; image: string | null }>("/api/profile", {
      method: "PATCH",
      body: { image: null },
    });
    setUploading(false);

    if ("error" in result) {
      setImageError(result.error.message);
      return;
    }
    set((prev) => (prev ? { ...prev, image: null } : prev));
    refreshShell();
    toast.success("Profile picture removed.");
    router.refresh();
  }

  if (loading) return <PanelSkeleton rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PanelSkeleton rows={3} />;

  const verified = data.emailVerifiedAt !== null;
  const memberSince = new Date(data.createdAt).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <Card id="profile">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="size-4" />
          Profile
        </CardTitle>
        <CardDescription>How you appear across the dashboard.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:max-w-md">
        <div className="flex items-center gap-4">
          {data.image ? (
            <img
              src={data.image}
              alt={data.name || ""}
              className="size-16 shrink-0 rounded-full object-cover ring-1 ring-border"
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-medium ring-1 ring-border">
              {initialsFor(data.name, data.email)}
            </div>
          )}
          <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{data.name || data.email}</span>
              {verified ? (
                <Badge variant="secondary" className="text-[11px]">
                  Verified
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[11px] text-amber-600 border-amber-600/40">
                  Unverified
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Member since {memberSince}</p>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(",")}
                className="hidden"
                aria-label="Upload profile picture"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadPicture(file);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? "Uploading…" : data.image ? "Change picture" : "Upload picture"}
              </Button>
              {data.image ? (
                <Button size="sm" variant="ghost" disabled={uploading} onClick={() => void removePicture()}>
                  Remove
                </Button>
              ) : null}
            </div>
            {imageError ? (
              <p role="alert" className="text-xs text-destructive">
                {imageError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">PNG, JPEG, or WebP up to 256 KB.</p>
            )}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaveError(null);
            }}
            maxLength={120}
            placeholder="Your name"
            aria-invalid={Boolean(saveError) || undefined}
            aria-describedby="profile-name-hint"
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
            }}
          />
          <p id="profile-name-hint" className="text-xs text-muted-foreground">
            {saveError ?? "Up to 120 characters. Shown beside your picture in the header."}
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
          <Input id="profile-email" readOnly value={data.email} />
          <p className="text-xs text-muted-foreground">
            {verified
              ? "Verified. Email changes are handled by an operator — it is the identity your session resolves to."
              : "Not verified yet — check your inbox for the verification link. You cannot pay or create keys until it is verified."}
          </p>
        </div>

        <div>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void saveName()}>
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
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