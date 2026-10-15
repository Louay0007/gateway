/**
 * Admin route-group layout.
 *
 * The `/admin` console and the `/admin/d17` queue live OUTSIDE the
 * `(app)` group, which is where `<Toaster/>` is otherwise mounted. Without
 * this layout every `toast.success` / `toast.error` on both surfaces would
 * be emitted into a context that renders nothing — the operator clicks
 * Suspend, the server cuts the gateway, and the UI stays silent.
 *
 * The root layout already provides `ThemeProvider`, so sonner's theme
 * resolution works here exactly as it does in the product shell.
 */

import { Toaster } from "@/components/ui/sonner";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <Toaster position="bottom-right" />
    </>
  );
}
