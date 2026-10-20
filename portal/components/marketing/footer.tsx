import Logo from "@/assets/logo/logo";

/**
 * Marketing footer.
 *
 * Links point at surfaces that exist or are the next ones to be built;
 * nothing here is a lie the moment it ships — dead links are worse than
 * absent sections. The auth routes (/sign-in, /sign-up) are API-backed
 * pages that land with the auth UI; until then they render the 404 from
 * the empty route set, which is honest.
 *
 * The brand lockup sits beside the name (mark tile + wordmark); the
 * footer canvas is white in both themes, so `tone="light"` pins the
 * wordmark black instead of following a dark theme into invisibility.
 */

const columns = [
  {
    title: 'Product',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign in', href: '/sign-in' },
      { label: 'Create an account', href: '/sign-up' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-gray-200/60 dark:border-gray-800 py-12 bg-white dark:bg-gray-950">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="flex flex-col justify-between gap-10 sm:flex-row">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo tone="auto" wordmark={false} />
              <p className="font-semibold tracking-tight text-gray-900 dark:text-gray-100">Zaino AI</p>
            </div>
            <p className="mt-2 max-w-xs text-sm text-gray-600 dark:text-gray-400">
              One API for every model, priced for the way Tunisia pays.
            </p>
          </div>
          <div className="flex gap-14">
            {columns.map((column) => (
              <div key={column.title}>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{column.title}</p>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-sm text-gray-600 dark:text-gray-400 transition-colors hover:text-gray-900 dark:hover:text-gray-100"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-10 text-xs text-gray-500 dark:text-gray-400">
          © {new Date().getFullYear()} Zaino AI. Usage is non-refundable once
          consumed.
        </p>
      </div>
    </footer>
  );
}
