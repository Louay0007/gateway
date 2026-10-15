/**
 * Brand marks — original geometric glyphs drawn for the docs surface.
 *
 * These are NOT the vendors' trademark files: no hotlinked SVGs, no copied
 * logotypes. Each mark is a minimal inline shape that labels a wire-format
 * or tool the gateway interoperates with, rendered next to the wordmark in
 * text. That keeps the docs honest about compatibility ("OpenAI-compatible")
 * without reproducing anyone's official logo.
 */

export function OpenAIMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M16 8.5v15M9.5 12.25l13 7.5M22.5 12.25l-13 7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="3" fill="currentColor" />
    </svg>
  );
}

export function AnthropicMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <path
        d="M9 26V8l14 9.5L9 26Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 8l7-3.5L23 8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CodexMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <rect
        x="4"
        y="5"
        width="24"
        height="22"
        rx="5"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path
        d="m11 12 4 4-4 4M17 20h4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClaudeMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <path
        d="M6 9c2-3.5 6-5 10-5s8 1.5 10 5c-1 1.5-3 2-4.5 2.5C20 8 13 7.5 10.5 11.5 9 11 7 10.5 6 9Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M7 13.5c3-1 6.5-1.2 9-1.2s6 .2 9 1.2c-.5 5-2.5 8.5-5 10.5-1.7 1.3-6.3 1.3-8 0-2.5-2-4.5-5.5-5-10.5Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="12.5" cy="17" r="1.2" fill="currentColor" />
      <circle cx="19.5" cy="17" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function ZainoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="#000" />
      <path
        d="M10 9h12l-6.5 7.5H22V23H10l6.5-7.5H10V9Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
