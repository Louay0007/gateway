/**
 * Marketing layout — passthrough for public pages.
 *
 * Theme is controlled per-route: the landing page (/) forces light mode
 * via its own inline script; all other marketing routes (docs, download,
 * pricing, changelog, privacy, terms) respect the user's theme preference
 * through the root ThemeProvider.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}