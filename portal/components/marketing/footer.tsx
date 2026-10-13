/**
 * Marketing footer.
 *
 * Links point at surfaces that exist or are the next ones to be built;
 * nothing here is a lie the moment it ships — dead links are worse than
 * absent sections. The auth routes (/sign-in, /sign-up) are API-backed
 * pages that land with the auth UI; until then they render the 404 from
 * the empty route set, which is honest.
 */

const columns = [
  {
    title: 'Product',
    links: [
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
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-gray-200/60 py-12 bg-white">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="flex flex-col justify-between gap-10 sm:flex-row">
          <div>
            <p className="font-semibold tracking-tight text-black">Zaino AI</p>
            <p className="mt-2 max-w-xs text-sm text-gray-600">
              One API for every model, priced for the way Tunisia pays.
            </p>
          </div>
          <div className="flex gap-14">
            {columns.map((column) => (
              <div key={column.title}>
                <p className="text-sm font-medium text-black">{column.title}</p>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="text-sm text-gray-600 transition-colors hover:text-black"
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
        <p className="mt-10 text-xs text-gray-500">
          © {new Date().getFullYear()} Zaino AI. Usage is non-refundable once
          consumed.
        </p>
      </div>
    </footer>
  );
}
