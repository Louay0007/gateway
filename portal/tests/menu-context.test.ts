/**
 * Base UI menu context invariants.
 *
 * WHY THIS FILE EXISTS. On production, opening the model picker on /chat
 * threw
 *
 *   Uncaught Error: Base UI error #31
 *
 * and the page fell to the error boundary — so switching from `smart` to
 * `frontier` looked like "the chat is broken", not like a broken label.
 *
 * Error #31 is `MenuGroupContext is missing. Menu group parts must be used
 * within <Menu.Group> or <Menu.RadioGroup>.` `DropdownMenuLabel` wraps
 * Base UI's `Menu.GroupLabel`, which calls `useMenuGroupRootContext()` on
 * mount. Outside a `<Menu.Group>` that throws.
 *
 * WHY THE SERVER TEST LOOKS ODD. `Menu.Portal` renders NOTHING during SSR
 * (verified: it emits an empty string), so a test that renders through
 * `DropdownMenuContent` never mounts the label and never throws — which is
 * exactly why the bug survived `next build` and every server-rendered
 * check. The tests below therefore render the primitives WITHOUT the
 * portal, where the context hooks actually run, and a separate source
 * scan pins the real components' structure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Menu } from '@base-ui/react/menu';

import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

const e = React.createElement;

describe('DropdownMenuLabel requires a Group ancestor (Base UI error #31)', () => {
  it('throws when the label has no <DropdownMenuGroup> around it', () => {
    // No portal: the label mounts, reads the missing context, and throws.
    // This is the bug that shipped in model-picker.tsx.
    expect(() =>
      renderToString(e(DropdownMenu, null, e(DropdownMenuLabel, null, 'Model tier'))),
    ).toThrow(/MenuGroupContext is missing|Menu group parts must be used within/);
  });

  it('renders when the label is wrapped in <DropdownMenuGroup>', () => {
    expect(() =>
      renderToString(
        e(DropdownMenu, null, e(DropdownMenuGroup, null, e(DropdownMenuLabel, null, 'Model tier'))),
      ),
    ).not.toThrow();
  });

  it('accepts a separator outside a group (no context requirement)', () => {
    // Separators are independent; wrapping them would be noise. Pinned so a
    // future "wrap everything" refactor does not start throwing.
    expect(() => renderToString(e(DropdownMenu, null, e(DropdownMenuSeparator, null)))).not.toThrow();
  });

  it('renders the model picker shape: group+label, separator, items', () => {
    expect(() =>
      renderToString(
        e(
          DropdownMenu,
          null,
          e(DropdownMenuGroup, null, e(DropdownMenuLabel, null, 'Model tier')),
          e(DropdownMenuSeparator, null),
          ...['fast', 'smart', 'frontier'].map((a) => e(DropdownMenuItem, { key: a }, a)),
        ),
      ),
    ).not.toThrow();
  });
});

describe('Menu.Item requires a Menu.Root ancestor (Base UI error #36)', () => {
  it('throws when an item is rendered outside a menu', () => {
    expect(() => renderToString(e(Menu.Item, null, 'orphan'))).toThrow(
      /MenuRootContext is missing|Menu parts must be placed within/,
    );
  });
});

/**
 * Static guard over the real components.
 *
 * SSR cannot see inside `Menu.Portal`, so the structural rule has to be
 * checked against the source. Every `DropdownMenuLabel` in a component must
 * have a `DropdownMenuGroup` opening before it and closing after it.
 */
describe('source guard — every DropdownMenuLabel sits inside a Group', () => {
  const root = join(__dirname, '..');
  const files = [
    'components/chat/model-picker.tsx',
    'components/chat/chat-sidebar.tsx',
    'components/dashboard/site-header.tsx',
    'components/dashboard/app-sidebar.tsx',
  ];

  for (const rel of files) {
    it(`${rel} wraps its label in a Group`, () => {
      const src = readFileSync(join(root, rel), 'utf8');
      const labelIdx = src.indexOf('<DropdownMenuLabel');
      if (labelIdx === -1) return; // no label, nothing to guard

      // The nearest preceding Group open must come BEFORE the label, and
      // the matching close must come after it.
      const groupOpen = src.lastIndexOf('<DropdownMenuGroup', labelIdx);
      const groupClose = src.indexOf('</DropdownMenuGroup>', groupOpen);
      expect(groupOpen, `no <DropdownMenuGroup> before the label in ${rel}`).toBeGreaterThan(-1);
      expect(groupClose, `<DropdownMenuGroup> is not closed after the label in ${rel}`).toBeGreaterThan(
        labelIdx,
      );
    });
  }
});
