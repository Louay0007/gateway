'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { canCreateKey, canRevokeKey } from '@/lib/keys/policy';
import type { KeyView } from '@/lib/keys/types';
import type { OrgRole } from '@/db/schema';

/**
 * Keys surface — C-05.
 *
 * The plaintext returned by POST /api/keys lives in this component's
 * state and nowhere else. It is never written to localStorage, never put
 * in a query string, and never re-fetched — the server has no copy of it
 * either. Closing the dialog destroys it; if the customer did not save
 * it, the correct move is to revoke and mint another, not to look for a
 * copy.
 *
 * Permission buttons are hidden here AND enforced in lib/keys/service.ts.
 * Hiding is courtesy; the service is the rule.
 */

interface Props {
  keys: KeyView[];
  allowedModels: string[];
  maxKeys: number;
  role: OrgRole;
  apiBaseUrl: string;
}

interface Created {
  plaintext: string;
  name: string;
  keyPrefix: string;
}

export default function KeysManager({ keys, allowedModels, maxKeys, role, apiBaseUrl }: Props) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [models, setModels] = useState<string[]>(allowedModels);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const mayCreate = canCreateKey(role);
  const atLimit = keys.length >= maxKeys;
  const plansPending = allowedModels.length === 0;

  // The selection is initialised from props, which are a snapshot. After a
  // plan change the server sends a new allowlist and `router.refresh()`
  // re-renders with it; without this, the form would keep offering a model
  // the plan no longer includes — and the create would fail anyway, on the
  // customer's terms rather than ours. Keyed on the joined list so a
  // re-render with equal models does not discard a live selection.
  const allowlistKey = allowedModels.join(',');
  useEffect(() => {
    const allowed = new Set(allowlistKey.split(','));
    setModels((current) => current.filter((m) => allowed.has(m)));
  }, [allowlistKey]);

  function toggleModel(model: string) {
    setModels((current) =>
      current.includes(model)
        ? current.filter((m) => m !== model)
        : [...current, model],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, models }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setError(body?.error?.message ?? 'The key could not be created.');
        return;
      }

      setCreated({
        plaintext: body.plaintext,
        name: body.key.name,
        keyPrefix: body.key.keyPrefix,
      });
      setName('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(key: KeyView) {
    const ok = window.confirm(
      `Revoke "${key.name}"? Requests using it start failing immediately, and it cannot be restored.`,
    );
    if (!ok) return;

    setRevokingId(key.id);
    setError(null);
    try {
      const res = await fetch(`/api/keys/${key.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? 'The key could not be revoked.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">API keys</h1>
        <p className="hint-text tnum">
          {keys.length} of {maxKeys} used
        </p>
      </div>

      {error && (
        <p role="alert" className="error-text mt-4">
          {error}
        </p>
      )}

      {mayCreate && (
        <section className="card mt-6 p-5">
          <h2 className="text-sm font-medium">Create a key</h2>

          {plansPending ? (
            <p className="hint-text mt-3">
              Your plan limits are still syncing. Try again in a moment.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <div>
                <label className="label" htmlFor="key-name">Name</label>
                <input
                  id="key-name"
                  className="input max-w-sm"
                  placeholder="laptop, ci, production…"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                  disabled={creating || atLimit}
                />
                <p className="hint-text mt-1.5">
                  How you will recognise this key later.
                </p>
              </div>

              <fieldset>
                <legend className="label">Models</legend>
                <div className="flex flex-wrap gap-4">
                  {allowedModels.map((model) => (
                    <label key={model} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={models.includes(model)}
                        onChange={() => toggleModel(model)}
                        disabled={creating}
                      />
                      <span className="font-mono">{model}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <button
                type="submit"
                className="btn-primary"
                disabled={creating || atLimit || name.trim().length === 0}
              >
                {creating ? 'Creating…' : 'Create key'}
              </button>

              {atLimit && (
                <p className="hint-text">
                  Your plan allows {maxKeys} key{maxKeys === 1 ? '' : 's'}. Revoke one
                  to free a slot.
                </p>
              )}
            </form>
          )}
        </section>
      )}

      <section className="mt-8">
        {keys.length === 0 ? (
          <div className="card p-5">
            <p className="text-sm text-fg-muted">No keys yet.</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--edge)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Key</th>
                  <th className="px-4 py-3 font-medium">Models</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last used</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b border-[var(--edge)] last:border-0">
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-fg-muted">{key.keyPrefix}…</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {key.models?.length ? key.models.join(', ') : '—'}
                    </td>
                    <td className="tnum px-4 py-3 text-fg-muted">{date(key.createdAt)}</td>
                    <td className="tnum px-4 py-3 text-fg-muted">
                      {key.lastUsedAt ? date(key.lastUsedAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canRevokeKey(role, key.isOwn) && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => revoke(key)}
                          disabled={revokingId === key.id}
                        >
                          {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {created && (
        <PlaintextDialog
          created={created}
          apiBaseUrl={apiBaseUrl}
          model={allowedModels[0] ?? 'fast'}
          onClose={() => setCreated(null)}
        />
      )}
    </div>
  );
}

/**
 * Deterministic date formatting.
 *
 * Not `toLocaleString()`: that renders differently on the server and on
 * the client whenever the two disagree about locale or timezone, and the
 * result is a hydration mismatch in the one table where a stale date
 * looks like a stale key.
 */
function date(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function PlaintextDialog({
  created,
  apiBaseUrl,
  model,
  onClose,
}: {
  created: Created;
  apiBaseUrl: string;
  model: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.plaintext);
      setCopied(true);
    } catch {
      // Clipboard is permission-gated and can fail silently; the key is
      // selectable on screen either way.
    }
  }

  const snippet = `curl ${apiBaseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${created.plaintext}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${model}","messages":[{"role":"user","content":"hi"}]}'`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="key-created-title"
    >
      <div className="card w-full max-w-xl p-6">
        <h2 id="key-created-title" className="text-base font-semibold">
          “{created.name}” is ready
        </h2>

        <p className="mt-2 text-sm text-[var(--warn)]">
          Copy this key now. It is shown once and cannot be retrieved again.
        </p>

        <code className="mt-4 block select-all break-all rounded-md border border-[var(--edge)] bg-[var(--surface-sunken)] p-3 font-mono text-xs">
          {created.plaintext}
        </code>

        <pre className="mt-4 overflow-x-auto rounded-md bg-[var(--surface-sunken)] p-3 text-xs">
          <code>{snippet}</code>
        </pre>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" className="btn-secondary" onClick={copy}>
            {copied ? 'Copied' : 'Copy key'}
          </button>
          <button type="button" className="btn-primary" onClick={onClose} autoFocus>
            I have saved it
          </button>
        </div>
      </div>
    </div>
  );
}
