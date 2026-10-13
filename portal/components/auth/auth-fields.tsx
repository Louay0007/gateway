"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * AuthField — label + input + error, the only field shape in auth.
 *
 * Native <label>/<input> (no component wrapper): the browser owns focus,
 * autofill, and password-manager behaviour. `aria-invalid` +
 * `aria-describedby` wire the server-returned error to the input so
 * screen readers announce it. `autoComplete` values follow the WHATWG
 * tokens so managers offer the right credential.
 *
 * Pro polish (ui-ux-pro-max rulebook):
 * - 16px text kills iOS auto-zoom-on-focus (the #1 mobile auth annoyance).
 * - h-11 (44px) meets the 44px touch minimum; the error reserves no space
 *   but `aria-live` announces it the moment the server responds.
 * - Focus ring is always visible (never `outline-none` without a
 *   replacement): border + soft ring in the theme's ring token.
 * - `aria-live="polite"` on the error: with useActionState the message
 *   arrives without a page load, so it must assertively announce.
 *
 * Reveal toggle (type="password" only):
 * - `type="button"` — never submits the form (the #1 toggle bug).
 * - `onMouseDown={preventDefault}` — clicking the icon keeps the caret
 *   in the input, so reveal mid-typing never interrupts typing.
 * - Full 44px-wide hit area, `aria-label` + `aria-pressed` so screen
 *   readers announce state ("Show password", pressed), lucide Eye/EyeOff.
 * - The input gets `pr-11` so text never slides under the icon.
 */
export function AuthField({
  id,
  name,
  label,
  type,
  autoComplete,
  error,
  defaultValue,
  describedBy,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  type: string;
  autoComplete: string;
  error?: string;
  defaultValue?: string;
  describedBy?: string;
  onChange?: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-black">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isPassword && revealed ? "text" : type}
          autoComplete={autoComplete}
          required
          defaultValue={defaultValue}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[describedBy, errorId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "h-11 w-full rounded-lg border bg-white text-base text-black outline-none",
            "placeholder:text-gray-400 transition-colors duration-150",
            "focus:border-black focus:ring-2 focus:ring-black/10",
            isPassword ? "pr-11 pl-3.5" : "px-3.5",
            error ? "border-red-500" : "border-gray-300",
          )}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            onMouseDown={(e) => e.preventDefault()}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-gray-500 transition-colors duration-150 hover:text-black focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none motion-reduce:transition-none"
          >
            {revealed ? (
              <EyeOff className="size-4.5" aria-hidden />
            ) : (
              <Eye className="size-4.5" aria-hidden />
            )}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" aria-live="polite" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
