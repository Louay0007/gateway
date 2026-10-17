/**
 * Marketing layout — forces light theme for all public pages.
 *
 * The root ThemeProvider defaults to light but next-themes can apply
 * `class="dark"` to <html> based on the user's browser localStorage or
 * system preference. CSS variables cascade from <html class="dark"> down
 * to <body class="bg-background">, so a `.light` wrapper div alone is
 * insufficient — the body background still resolves to dark tokens.
 *
 * Fix: an inline blocking script strips `dark` from <html> and sets
 * `light` before first paint, guaranteeing white backgrounds on every
 * marketing route regardless of the visitor's saved theme preference.
 * The `.light-surface` class (defined in globals.css) re-declares light
 * tokens for the subtree as a belt-and-suspenders measure.
 */

const forceLightScript = `
(function(){
  var h = document.documentElement;
  h.classList.remove('dark');
  h.classList.add('light');
  try { localStorage.setItem('theme', 'light'); } catch(e){}
})();
`;

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: forceLightScript }} />
      <div className="light light-surface">{children}</div>
    </>
  );
}