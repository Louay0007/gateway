/**
 * MaintenanceBanner — a single notice strip for the page header.
 *
 * Rendered *inside* the fixed <nav> (see
 * components/shadcn-space/blocks/hero-33/navbar.tsx) so it travels with the
 * header instead of needing a magic `top-[72px]` offset that breaks the
 * moment the nav's height changes.
 *
 * Deliberately dumb: no dismiss button, no timers, no state. A maintenance
 * notice that the visitor can dismiss is a maintenance notice that gets
 * dismissed and forgotten.
 */
export function MaintenanceBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="w-full border-b border-black/10 bg-white px-4 py-1.5 text-center text-sm font-medium text-black"
    >
      {message}
    </div>
  );
}
