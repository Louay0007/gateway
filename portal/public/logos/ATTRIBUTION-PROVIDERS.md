# Sign-in provider marks — attribution

Official vendor artwork used **nominatively** on the sign-in and sign-up
surfaces to label which identity provider a button starts ("Continue with
Google", "Continue with GitHub"). The marks identify the provider; they do
not imply endorsement of Zaino AI by Google or GitHub.

Both marks are **inlined as React components** rather than self-hosted files
(`portal/assets/brand/provider-icons.tsx`) because GitHub is monochrome by
specification — it must be drawn in the surface's foreground colour, which is
only possible with an inline `<svg>` using `currentColor`. Shipping it as a
colour image would be wrong in both themes. Google is the exception and must
stay a four-colour mark (see below).

> Apple sign-in was removed from the product. Its glyph and its row in the
> table below are gone with it; re-adding Apple means restoring the icon, the
> `apple` `ProviderId`, the adapter and this attribution row.

| Mark | Source | Rights | Notes |
|---|---|---|---|
| Google "G" | Google Identity branding asset (`developers.google.com/identity`) | **Trademark of Google LLC**; use governed by the Google Sign-In branding guidelines | Four fixed fills (`#4285F4`, `#34A853`, `#FBBC05`, `#EA4335`). **Do not recolour, flatten to `currentColor`, or alter the proportions** — that breaches the guidelines. |
| GitHub | [github/github-mark](https://github.com/github/github-mark), via Simple Icons | **Trademark of GitHub, Inc.**; [GitHub logo policy](https://github.com/logos) | Monochrome by specification. Permitted use: linking to GitHub, or describing a GitHub integration. Must not imply endorsement. |

## Rules for future edits

1. **Google's mark is never themed.** It is the only colour mark in the set;
   a "brand-aware" refactor that maps it to tokens breaks the licence.
2. **GitHub stays `currentColor`.** It is legible on both themes from one
   component, which is why there is no dark-mode asset.
3. **Every mark is `aria-hidden`.** The accessible name is the button's own
   text ("Continue with Google"). An exposed image would make a screen reader
   announce the provider twice.
4. **No mark is rendered without its text label.** An icon-only button has no
   accessible name and is prohibited by the remaining providers' terms.
5. If a provider publishes a new asset, replace the path data and update the
   row above in the same commit. An unrecorded artwork change is an
   unattributed trademark use.
