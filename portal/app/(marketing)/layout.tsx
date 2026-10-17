/**
 * Marketing layout — forces light theme for all public pages.
 *
 * The root ThemeProvider defaults to light but next-themes SSR can
 * render with the `dark` class before hydration, causing bg-background
 * to resolve to dark tokens. Wrapping marketing routes in a `light`
 * class override ensures consistent white backgrounds regardless of
 * the SSR theme state, matching the dev server appearance.
 */

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="light">{children}</div>;
}