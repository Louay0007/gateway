import type { ProviderId } from "@/lib/auth/oauth/types";
import { GitHubIcon, GoogleIcon } from "@/assets/brand/provider-icons";

/**
 * "Continue with …" — the provider row above the email form. Plan §7.
 *
 * RENDERED ONLY WHEN CONFIGURED. The list comes from the server
 * (`enabledProviders()`), so a provider whose env vars are missing has no
 * button at all. A button that redirects to a consent screen we cannot
 * complete is worse than no button: the user has already committed by the
 * time it fails.
 *
 * A PLAIN ANCHOR, not a form. The start route sets a cookie and 302s, so a
 * full navigation is exactly the semantics needed — no client JS, no
 * hydration dependency, works with JS disabled. It also means these buttons
 * never interact with the form's `useActionState`.
 *
 * STYLING — matches the auth form exactly, because a social button that
 * looks like a different design system than the field beneath it reads as a
 * third-party embed:
 *   - h-11 (44px): the same touch minimum as AuthField and the submit
 *     button. Anything shorter makes the tap row ragged on a phone.
 *   - `border-border` + `bg-card`: the system's own hairline and surface,
 *     so it follows the theme instead of hardcoding grey.
 *   - text-base on mobile / text-sm on desktop: 16px kills iOS
 *     auto-zoom-on-focus, the same rule AuthField follows. It also stops
 *     the long "Continue with Google" label from wrapping at 320px.
 *   - `focus-visible` ring in the ring token, never `outline-none` alone.
 *   - `active:scale-[0.99]` + `motion-reduce` for the 100ms press feedback
 *     the rest of the auth surface has.
 *   - Icon in a fixed 18px box with a 12px gap, so the labels start at the
 *     same x regardless of mark width. Without the fixed box a narrower
 *     glyph shifts its label left and the column looks broken.
 *
 * TEXT, NOT LOGOS, AS THE LABEL. The mark is decorative and `aria-hidden`;
 * the accessible name is the words. Google requires its exact wording in a
 * sign-in context, and "Continue with Google" satisfies that while staying
 * a sentence a screen reader can read.
 */
const PROVIDERS: Record<
  ProviderId,
  { label: string; Icon: (p: { className?: string }) => React.ReactElement }
> = {
  google: { label: "Continue with Google", Icon: GoogleIcon },
  github: { label: "Continue with GitHub", Icon: GitHubIcon },
};

export function SocialButtons({
  providers,
  returnTo,
}: {
  /** Resolved on the server from env — never computed on the client. */
  providers: ProviderId[];
  /** Same-site path to land on after sign-in; validated server-side. */
  returnTo?: string;
}) {
  if (providers.length === 0) return null;

  const suffix = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  return (
    <ul className="m-0 list-none space-y-2.5 p-0">
      {providers.map((id) => {
        const { label, Icon } = PROVIDERS[id];
        return (
          <li key={id}>
            <a
              href={`/api/oauth/${id}/start${suffix}`}
              // Cross-origin redirect follows — keep crawlers out of it.
              rel="nofollow"
              className="group flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 text-base font-medium text-foreground transition-[background-color,transform] duration-100 hover:bg-muted active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none motion-reduce:active:scale-100 sm:text-sm"
            >
              {/*
                Fixed 18px box, always. The three marks have different
                intrinsic widths; without this the labels do not align and
                the Apple row looks indented.
              */}
              <Icon className="size-[18px] shrink-0" />
              <span>{label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The complete social block: buttons + the divider that separates them from
 * the email form.
 *
 * WHY THE DIVIDER LIVES HERE. It was the caller's job, gated on
 * `providers.length > 0` — which became a lie once the row always renders.
 * A divider is not independently meaningful: it says "there are buttons
 * above you". Owning both in one component means the two can never
 * disagree, and the pages stop carrying a condition that is always true.
 */
export function SocialBlock({
  providers,
  returnTo,
}: {
  providers: ProviderId[];
  returnTo?: string;
}) {
  if (providers.length === 0) return null;
  return (
    <>
      <SocialButtons providers={providers} returnTo={returnTo} />
      <SocialDivider />
    </>
  );
}

/**
 * The divider between social and email. One, always the same words.
 *
 * Rendered only by `SocialBlock` — never directly — so it cannot appear
 * above a form that is the only option.
 *
 * `aria-hidden`: it is purely visual. A screen reader hears the buttons then
 * the form; "or continue with email" read aloud between them adds nothing a
 * listener needs.
 */
export function SocialDivider() {
  return (
    <div className="my-5 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs font-medium tracking-wide text-muted-foreground">
        or continue with email
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The one-line notice shown when a social sign-in did not complete.
 *
 * Fixed copy for a fixed set of reasons — the query string only ever selects
 * a sentence, it never supplies one. That is what keeps `?social=…` from
 * becoming a reflected-text primitive on the sign-in page.
 *
 * FROZEN MAP, OWN-PROPERTY LOOKUP. A plain object literal inherits
 * `Object.prototype`, so `NOTICES['toString']`, `['constructor']` or
 * `['__proto__']` (all reachable as `?social=…`) resolve to a FUNCTION.
 * React throws when a function is rendered as a child, which turned a
 * query string into a 500 on the sign-in page. `Object.hasOwn` makes the
 * lookup total; `null` prototype removes the inherited keys entirely.
 */
const NOTICES: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null), {
    cancelled: "Sign-in was cancelled. You can try again or use your password.",
    expired: "That sign-in link expired. Please start again.",
    failed: "We could not complete that sign-in. Please try again.",
    // The unconfigured-provider case. The buttons are always shown; a click
    // on one whose credentials are not set yet lands here. "Not available
    // right now" was accurate but read as an outage — this says what is
    // actually true and offers the path that works today.
    unavailable:
      "Google and GitHub sign-in are not enabled on this deployment yet. Use your email and password below.",
    unknown_provider: "That sign-in method is not available right now.",
    // The provider proved the address, but an account here already holds it
    // without having confirmed it. Creating a second identity on the same
    // address is impossible (0041's unique index), so the answer is the
    // recovery that actually exists: confirm it, or reset the password.
    email_taken:
      "That email address already belongs to an account here that has not been confirmed yet. Sign in with your password — or reset it — to confirm the address, then try again.",
  } satisfies Record<string, string>),
);

export function socialNotice(reason: string | undefined): string | null {
  if (!reason) return null;
  // Own-property check AND a string check: the first blocks prototype keys,
  // the second blocks anything that slipped through typing.
  const message = Object.hasOwn(NOTICES, reason) ? NOTICES[reason] : undefined;
  if (typeof message !== "string") {
    // An unknown reason still needs a sentence — returning null would render
    // an empty alert, and returning undefined crashes React.
    return NOTICES["failed"] as string;
  }
  return message;
}

/**
 * The notice as a component, so both auth pages render it identically.
 *
 * `role="status"` + `aria-live="polite"`: the message arrives on a fresh page
 * load rather than as a live update, but the polite live region is what makes
 * it announced after the redirect instead of silently present.
 */
export function SocialNotice({ reason }: { reason: string | undefined }) {
  const message = socialNotice(reason);
  if (!message) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="mb-5 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-muted-foreground"
    >
      {message}
    </p>
  );
}
