"use server";

import { AuthError } from "next-auth";
import { z } from "zod";

import { adminSignIn, adminSignOut } from "@/lib/auth/admin-auth";

/**
 * Console sign-in actions — the username + password pair from `admin-auth.ts`.
 *
 * Deliberately separate from `lib/auth/actions.ts`. The two pages have
 * different failure vocabularies (a username is not an email), different
 * callback constraints (this one may only ever land under `/admin`), and
 * different sessions. Sharing one action would mean a shape that fits
 * neither.
 */

export interface AdminAuthFormState {
  error?: string;
  fieldErrors?: { username?: string; password?: string };
}

const usernameSchema = z
  .string()
  .trim()
  .min(1, "Enter your username.")
  .max(64, "That username is too long.")
  // No email check and no charset narrowing beyond "no spaces": the stored
  // value is normalized server-side and compared on a lower() index.
  .regex(/^\S+$/, "A username cannot contain spaces.");

const passwordSchema = z
  .string()
  .min(1, "Enter your password.")
  .max(256);

export async function adminSignInAction(
  _prev: AdminAuthFormState,
  formData: FormData,
): Promise<AdminAuthFormState> {
  const raw = {
    username: String(formData.get("username") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  };

  const parsedUser = usernameSchema.safeParse(raw.username);
  const parsedPw = passwordSchema.safeParse(raw.password);

  const fieldErrors: NonNullable<AdminAuthFormState["fieldErrors"]> = {};
  if (!parsedUser.success) fieldErrors.username = parsedUser.error.issues[0]?.message;
  if (!parsedPw.success) fieldErrors.password = parsedPw.error.issues[0]?.message;
  if (fieldErrors.username || fieldErrors.password) return { fieldErrors };

  // The target is pinned to /admin as well as being same-site relative: this
  // must never become an open redirect into the customer product, and
  // `startsWith("/admin")` rejects the `//evil` protocol-relative form.
  const target = String(formData.get("next") ?? "/admin/ops");
  const safeTarget =
    target.startsWith("/admin") && !target.startsWith("//") ? target : "/admin/ops";

  try {
    await adminSignIn("staff", {
      username: raw.username,
      password: raw.password,
      redirectTo: safeTarget,
    });
    // adminSignIn throws NEXT_REDIRECT on success; execution does not reach here.
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      // ONE message for bad password, unknown username, revoked account and
      // a throttled login. The endpoint must not become an enumeration
      // oracle, and the backend already spends the same KDF on all four.
      return {
        error:
          "Those credentials did not match our records, or the account is temporarily locked.",
      };
    }
    // Re-throw the framework's own redirect control-flow signal.
    throw e;
  }
}

export async function adminSignOutAction(): Promise<void> {
  // Lands on the form with a reason rather than a bare one, matching the
  // fix /sign-in got for passwordChanged=1.
  await adminSignOut({ redirectTo: "/admin/login?signedOut=1" });
}
