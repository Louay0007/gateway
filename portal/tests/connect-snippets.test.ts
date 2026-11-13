/**
 * /connect snippet contract.
 *
 * A snippet on /connect is a promise: "paste this and it works". Every one
 * of these assertions is about that promise being keepable, and they are
 * pure — no network, no database — because the shape can be checked without
 * spending a real token. The live 200 test is a separate, opt-in run
 * (`CONNECT_LIVE_KEY=zn-… npx vitest run tests/connect-snippets.live`),
 * because a unit suite must not depend on the production gateway.
 *
 * WHAT THIS CATCHES:
 *   - a snippet that points at a base URL we do not serve
 *   - a snippet that names an upstream model instead of an alias
 *   - a snippet with no test command (the opencode pattern)
 *   - the Anthropic snippets using the /v1-suffixed base URL, which 404s
 *   - the Claude Code block omitting ANTHROPIC_API_KEY="" — the trap that
 *     costs every new user an hour
 */
import { describe, it, expect } from 'vitest';

import { TOOLS, TOOL_GROUPS, snippetFor, type ToolId } from '@/lib/connect/tools';
import { PUBLIC_BASE_URL } from '@/components/docs/docs-data';

const ALIASES = ['fast', 'smart', 'frontier', 'fable'];
const KEY = 'zn-testkey1234567890';
const ANTHROPIC_BASE = PUBLIC_BASE_URL.replace(/\/v1\/?$/, '');

describe('tool catalogue', () => {
  it('covers every tool the roadmap promised', () => {
    const ids = TOOLS.map((t) => t.id);
    for (const required of [
      'claude-code',
      'codex',
      'cursor',
      'zed',
      'continue',
      'aider',
      'openai-python',
      'openai-node',
      'anthropic-python',
      'langchain',
      'llamaindex',
      'n8n',
      'open-webui',
      'curl',
    ] as ToolId[]) {
      expect(ids).toContain(required);
    }
  });

  it('gives every tool a blurb and a known group', () => {
    for (const t of TOOLS) {
      expect(t.blurb.length).toBeGreaterThan(10);
      expect(TOOL_GROUPS).toContain(t.group);
    }
  });

  it('has unique ids', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
  });
});

describe('every snippet for every tool', () => {
  const cases = TOOLS.flatMap((t) => ALIASES.map((a) => [t.id, a] as const));

  it('produces a code block and a test command', () => {
    for (const [tool, alias] of cases) {
      const s = snippetFor(tool, alias, KEY);
      expect(s.code.length, `${tool}/${alias} code`).toBeGreaterThan(20);
      expect(s.test.length, `${tool}/${alias} test`).toBeGreaterThan(20);
      expect(s.filename.length).toBeGreaterThan(0);
    }
  });

  it('never names an upstream model', () => {
    for (const [tool, alias] of cases) {
      const s = snippetFor(tool, alias, KEY);
      const blob = `${s.code}\n${s.also?.code ?? ''}\n${s.test}`.toLowerCase();
      for (const vendor of ['haiku-5.5', 'sonnet-5.5', 'opus-5.5', 'gpt-6', 'gpt-4']) {
        expect(blob, `${tool}/${alias} leaks ${vendor}`).not.toContain(vendor);
      }
    }
  });

  it('always calls the alias it was asked for', () => {
    for (const [tool, alias] of cases) {
      const s = snippetFor(tool, alias, KEY);
      const blob = `${s.code}\n${s.also?.code ?? ''}\n${s.test}`;
      expect(blob, `${tool}/${alias} is missing ${alias}`).toContain(alias);
    }
  });

  it('never hard-codes a base URL we do not serve', () => {
    for (const [tool, alias] of cases) {
      const s = snippetFor(tool, alias, KEY);
      const blob = `${s.code}\n${s.also?.code ?? ''}\n${s.test}`;
      // Every http(s) URL in any block must be the Zaino edge (or a docs
      // link inside a comment, which we do not emit).
      const urls = blob.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
      for (const u of urls) {
        expect(
          u.startsWith(PUBLIC_BASE_URL) || u.startsWith(ANTHROPIC_BASE),
          `${tool}/${alias} points at ${u}`,
        ).toBe(true);
      }
    }
  });

  it('never embeds a placeholder that cannot be pasted as-is', () => {
    for (const [tool, alias] of cases) {
      const s = snippetFor(tool, alias, KEY);
      const blob = `${s.code}\n${s.also?.code ?? ''}\n${s.test}`;
      // With a real key supplied, nothing may still say zn-… .
      expect(blob, `${tool}/${alias} still has a placeholder`).not.toContain('zn-…');
      expect(blob).toContain(KEY);
    }
  });

  it('falls back to a visible placeholder when no key is given', () => {
    for (const [tool] of cases) {
      const s = snippetFor(tool, 'smart', '');
      const blob = `${s.code}\n${s.also?.code ?? ''}\n${s.test}`;
      expect(blob).toContain('zn-…');
    }
  });
});

describe('wire-format correctness', () => {
  it('Anthropic-format tools omit the /v1 suffix from the base URL', () => {
    // The edge serves /v1/messages at the ORIGIN, not under /v1. Pointing
    // the Anthropic SDK at .../v1 produces .../v1/v1/messages → 404.
    const s = snippetFor('anthropic-python', 'smart', KEY);
    expect(s.code).toContain(`base_url="${ANTHROPIC_BASE}"`);
    expect(s.code).not.toContain(`${PUBLIC_BASE_URL}"`);
  });

  it('Claude Code gets the ANTHROPIC_API_KEY="" trap, with an explanation', () => {
    const s = snippetFor('claude-code', 'fast', KEY);
    expect(s.code).toContain('ANTHROPIC_API_KEY=""');
    expect(s.trap?.toLowerCase()).toContain('401');
  });

  it('Codex declares the Responses wire format', () => {
    const s = snippetFor('codex', 'smart', KEY);
    expect(s.code).toContain('wire_api = "responses"');
    expect(s.also?.code).toContain('model_provider=zaino');
  });

  it('OpenAI-format tools use the /v1 base URL', () => {
    for (const tool of ['openai-python', 'openai-node', 'curl'] as ToolId[]) {
      const s = snippetFor(tool, 'smart', KEY);
      const blob = `${s.code}\n${s.test}`;
      expect(blob).toContain(PUBLIC_BASE_URL);
    }
  });
});

describe('the pasteable test command', () => {
  it('targets the right endpoint and auth header for its wire format', () => {
    // Anthropic-format tools are tested on /v1/messages with x-api-key —
    // that is the format their snippet configures, so proving it on
    // chat/completions would test a code path the user never runs.
    const ANTHROPIC_FORMAT = new Set<ToolId>(['claude-code', 'anthropic-python']);

    for (const tool of TOOLS.map((t) => t.id)) {
      const s = snippetFor(tool, 'smart', KEY);
      if (ANTHROPIC_FORMAT.has(tool)) {
        expect(s.test, `${tool} should test /messages`).toContain('/messages');
        expect(s.test).toContain('x-api-key');
        expect(s.test).toContain('anthropic-version');
      } else {
        expect(s.test, `${tool} should test chat/completions`).toContain('/chat/completions');
        expect(s.test).toContain('Authorization: Bearer');
      }
      expect(s.test).toContain('max_tokens');
    }
  });

  it('asks for a tiny, deterministic reply so 200 is unambiguous', () => {
    const s = snippetFor('curl', 'fast', KEY);
    expect(s.test).toContain('reply with: ok');
  });
});
