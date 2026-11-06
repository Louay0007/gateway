import Navbar from '@/components/shadcn-space/blocks/hero-33/navbar';
import { currentUser } from '@/lib/auth/authorize';
import { initialsFor } from '@/lib/dashboard/format';

/**
 * The public navbar, with the visitor's identity resolved on the server.
 *
 * The navbar itself is a client component (scroll state, sheet), so it
 * cannot call `auth()`. Resolving here keeps the avatar correct on first
 * paint — a client-side fetch would flash "Sign in" at a signed-in user
 * on every marketing page.
 *
 * Cost: reading cookies makes these routes dynamic. They are served by
 * Caddy on one VPS with no CDN, so a dynamic render is the same hop.
 */
export default async function SiteNav({
  active,
  tone,
}: {
  active?: string;
  /** "light" is the home landing's orange-over-hero treatment. */
  tone?: 'dark' | 'light';
}) {
  const user = await currentUser();
  return (
    <Navbar
      tone={tone}
      active={active}
      signedIn={Boolean(user)}
      name={user?.name ?? null}
      image={user?.image ?? null}
      initials={user ? initialsFor(user.name, user.email) : null}
    />
  );
}
