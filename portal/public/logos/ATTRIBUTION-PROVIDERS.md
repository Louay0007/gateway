# Sign-in provider marks — attribution

Official vendor artwork used **nominatively** on the sign-in and sign-up
surfaces to label which identity provider a button starts ("Continue with
Google", "Continue with GitHub", "Continue with Apple"). The marks identify
the provider; they do not imply endorsement of Zaino AI by Google, GitHub or
Apple.

These three are **inlined as React components** rather than self-hosted files
(`portal/assets/brand/provider-icons.tsx`) because GitHub and Apple are
monochrome by specification — they must be drawn in the surface's foreground
colour, which is only possible with an inline `<svg>` using `currentColor`.
Shipping them as colour images would be wrong in both themes. Google is the
exception and must stay a four-colour mark (see below).

| Mark | Source | Rights | Notes |
|---|---|---|---|
| Google "G" | Google Identity branding asset (`developers.google.com/identity`) | **Trademark of Google LLC**; use governed by the Google Sign-In branding guidelines | Four fixed fills (`#4285F4`, `#34A853`, `#FBBC05`, `#EA4335`). **Do not recolour, flatten to `currentColor`, or alter the proportions** — that breaches the guidelines. |
| GitHub | [github/github-mark](https://github.com/github/github-mark), via Simple Icons | **Trademark of GitHub, Inc.**; [GitHub logo policy](https://github.com/logos) | Monochrome by specification. Permitted use: linking to GitHub, or describing a GitHub integration. Must not imply endorsement. |
| Apple | Apple "Sign in with Apple" glyph, via Simple Icons | **Trademark of Apple Inc.**; use governed by the Apple Sign-In guidelines | Monochrome by specification. Apple publishes a **mandatory button asset** with defined minimum height and clear space — this repository renders the glyph inside its own button, which is acceptable only where the label is adjacent text. Building a standalone Apple-branded button from this glyph requires adopting Apple's own asset. |

## Rules for future edits

1. **Google's mark is never themed.** It is the only colour mark in the set;
   a "brand-aware" refactor that maps it to tokens breaks the licence.
2. **GitHub and Apple stay `currentColor`.** They are legible on both themes
   from one component, which is why there is no dark-mode asset.
3. **Every mark is `aria-hidden`.** The accessible name is the button's own
   text ("Continue with Google"). An exposed image would make a screen reader
   announce the provider twice.
4. **No mark is rendered without its text label.** An icon-only button has no
   accessible name and is prohibited by two of the three providers' terms.
5. If a provider publishes a new asset, replace the path data and update the
   row above in the same commit. An unrecorded artwork change is an
   unattributed trademark use.
