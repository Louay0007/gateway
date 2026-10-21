import { describe, expect, it } from 'vitest';
import { countPrompts, userMessagesOf } from '@/lib/jobs/prompt-count';

/**
 * How many prompts a request adds.
 *
 * The gateway's only customer-facing limit is the prompt count, so this
 * number decides when a customer is cut off. It has to count what the
 * customer EXPERIENCED: one prompt per message they sent.
 *
 * The trap it exists to catch: a chat client resends its whole conversation
 * on every turn, so the request body carries one user message per turn so
 * far. Counting the messages in the body charges a 3-turn session 1+2+3 = 6
 * prompts for 3 prompts sent — the customer's allowance would drain three
 * times too fast, and the app would cut them off while they still had
 * budget left.
 */
describe('countPrompts', () => {
  const messages = (count: number) => count;

  it('counts the prompts a request ADDS, not the ones it carries', () => {
    const seen = new Map<string, number>();
    // First turn: one user message, nothing seen before.
    expect(countPrompts({ messages: messages(1) }, 'key-1', seen)).toBe(1);
    // Second turn: the body carries both turns, but only one is new.
    expect(countPrompts({ messages: messages(2) }, 'key-1', seen)).toBe(1);
    // Third turn: same again.
    expect(countPrompts({ messages: messages(3) }, 'key-1', seen)).toBe(1);
  });

  it('charges a three-turn session three prompts, not six', () => {
    const seen = new Map<string, number>();
    const total = [1, 2, 3].reduce(
      (sum, count) => sum + countPrompts({ messages: messages(count) }, 'key-1', seen),
      0,
    );
    expect(total).toBe(3);
  });

  it('tracks each key separately', () => {
    const seen = new Map<string, number>();
    expect(countPrompts({ messages: messages(3) }, 'key-a', seen)).toBe(3);
    // A different key starts from zero: its history is its own.
    expect(countPrompts({ messages: messages(1) }, 'key-b', seen)).toBe(1);
    expect(countPrompts({ messages: messages(4) }, 'key-b', seen)).toBe(3);
  });

  it('counts at least one prompt for a request that adds no user message', () => {
    // A tool-result continuation carries no new user message but still
    // consumed a model turn, and the model was paid for it.
    const seen = new Map<string, number>();
    // Establish the baseline: this turn carried two user messages.
    expect(countPrompts({ messages: messages(2) }, 'key-1', seen)).toBe(2);
    // The continuation carries the same two, and adds none.
    expect(countPrompts({ messages: messages(2) }, 'key-1', seen)).toBe(1);
  });

  it('falls back to one prompt when the request does not expose its messages', () => {
    const seen = new Map<string, number>();
    expect(countPrompts({ messages: null }, 'key-1', seen)).toBe(1);
    expect(countPrompts({ messages: null }, 'key-1', seen)).toBe(1);
  });

  it('never charges less than one prompt', () => {
    const seen = new Map<string, number>();
    expect(countPrompts({ messages: messages(1) }, 'key-1', seen)).toBe(1);
    expect(countPrompts({ messages: messages(1) }, 'key-1', seen)).toBe(1);
  });
});
