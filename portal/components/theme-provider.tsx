'use client';

/**
 * Theme provider — next-themes, light by default.
 *
 * The light theme is the default: the dashboard, auth pages, and the
 * marketing hero all read on the white token set first. Dark remains
 * fully supported — every token pair in globals.css exists for both, and
 * the dashboard's toggle (sidebar + header) flips the class on <html>,
 * which is the only place a global theme can live;
 * `suppressHydrationWarning` on <html> (set in the root layout) is the
 * documented companion.
 *
 * `enableSystem` stays off deliberately: a developer's OS preference
 * flipping the app to dark in a review screenshot is noise, and the
 * toggle in the dashboard can turn it on when there's a reason.
 */

import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
