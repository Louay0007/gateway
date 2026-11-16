import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
describe('reasoning headroom', () => {
  const src = readFileSync('lib/chat/gateway.ts','utf8');
  it('adds 4000 to a customer cap and never exceeds the deployment ceiling', () => {
    expect(src).toContain('const REASONING_HEADROOM = 4000');
    expect(src).toMatch(/Math\.min\(cap \+ REASONING_HEADROOM, 65536\)/);
  });
  it('is applied wherever a customer cap is forwarded', () => {
    // Both wire paths must use it, or one endpoint silently truncates.
    // Three forwarding sites: the two JSON bodies and the Anthropic
    // /v1/messages body Claude Desktop actually uses.
    expect(src.match(/withHeadroom\(input\.maxOutputTokens\)/g)?.length).toBe(3);
    expect(src).not.toMatch(/max_tokens: input\.maxOutputTokens\b/);
  });
});
