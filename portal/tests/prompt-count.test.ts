/**
 * Prompt counting — 1 user message = 1 prompt.
 *
 * Rule (migration 0020): prompt_count = 1 IFF route is inference
 * (chat/messages/responses) AND status_code = 200. Everything else is 0.
 * Failures never consume quota.
 */
import { describe, it, expect } from 'vitest';
import {
  isInferenceRoute,
  promptCountForRow,
  routeForCallType,
} from '@/lib/pricing/alias';

describe('isInferenceRoute', () => {
  it('accepts the three canonical inference routes', () => {
    expect(isInferenceRoute('chat')).toBe(true);
    expect(isInferenceRoute('messages')).toBe(true);
    expect(isInferenceRoute('responses')).toBe(true);
  });
  it('accepts the legacy chat_completions spelling', () => {
    expect(isInferenceRoute('chat_completions')).toBe(true);
  });
  it('rejects non-inference routes', () => {
    expect(isInferenceRoute('models')).toBe(false);
    expect(isInferenceRoute('key-info')).toBe(false);
    expect(isInferenceRoute('unknown')).toBe(false);
    expect(isInferenceRoute(null)).toBe(false);
    expect(isInferenceRoute(undefined)).toBe(false);
  });
});

describe('routeForCallType canonicalization', () => {
  it('maps the three inference call types', () => {
    expect(routeForCallType('acompletion')).toBe('chat');
    expect(routeForCallType('anthropic_messages')).toBe('messages');
    expect(routeForCallType('aresponses')).toBe('responses');
  });
  it('canonicalizes legacy chat_completions endpoint to chat', () => {
    expect(routeForCallType(undefined, 'chat_completions')).toBe('chat');
    expect(routeForCallType('chat_completions')).toBe('chat');
  });
  it('still labels non-inference calls truthfully', () => {
    expect(routeForCallType('/v1/models')).toBe('models');
    expect(routeForCallType('/key/info')).toBe('key-info');
  });
});

describe('promptCountForRow — the single rule', () => {
  it('counts 1 for a successful inference request', () => {
    expect(promptCountForRow('chat', 200)).toBe(1);
    expect(promptCountForRow('messages', 200)).toBe(1);
    expect(promptCountForRow('responses', 200)).toBe(1);
    expect(promptCountForRow('chat_completions', 200)).toBe(1);
  });
  it('counts 0 for failures — failures never consume quota', () => {
    expect(promptCountForRow('chat', 429)).toBe(0);
    expect(promptCountForRow('chat', 400)).toBe(0);
    expect(promptCountForRow('chat', 500)).toBe(0);
    expect(promptCountForRow('chat', null)).toBe(0);
    expect(promptCountForRow('chat', undefined)).toBe(0);
    expect(promptCountForRow('responses', 429)).toBe(0);
  });
  it('counts 0 for non-inference routes even on 200', () => {
    expect(promptCountForRow('models', 200)).toBe(0);
    expect(promptCountForRow('unknown', 200)).toBe(0);
    expect(promptCountForRow(null, 200)).toBe(0);
  });
  it('counts 1 user message = 1 prompt regardless of conversation length', () => {
    // A chat client resends its whole history every turn, but that is still
    // one gateway request, so still 1 prompt. No per-key memory, no diffing.
    expect(promptCountForRow('chat', 200)).toBe(1);
  });
});
