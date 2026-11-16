import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./Composer.css', import.meta.url), 'utf8');

describe('composer mobile typography (issue #251)', () => {
  it('keeps coarse-pointer input text at the iOS no-zoom threshold or larger', () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.composer-grow::after,\s*\.composer-input\s*\{[^}]*font-size:\s*max\(16px,\s*var\(--panda-size-content\)\)/,
    );
  });
});

describe('composer text field grows with its text', () => {
  /** The declarations of the first rule whose selector list is exactly `selector`. */
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&').replace(/,\s*/g, ',\\s*');
    // A selector at the start of a line, not the tail of a longer list.
    const match = css.match(new RegExp(`(?<!,\\s*)^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (match?.[1] === undefined) throw new Error(`no rule for ${selector}`);
    return match[1];
  }

  it('puts the textarea and its invisible replica in one grid cell', () => {
    expect(rule('.composer-grow')).toMatch(/display:\s*grid/);
    expect(rule('.composer-grow::after, .composer-input')).toMatch(/grid-area:\s*1 \/ 1/);
  });

  it('gives the replica every property that moves a line break', () => {
    const shared = rule('.composer-grow::after, .composer-input');
    for (const property of [
      'padding',
      'border',
      'font-family',
      'font-size',
      'line-height',
      'letter-spacing',
      'white-space: pre-wrap',
      'overflow-wrap: break-word',
    ]) {
      expect(shared).toContain(property);
    }
  });

  it('caps both at the viewport-driven maximum, then scrolls the textarea', () => {
    expect(rule('.composer-grow::after, .composer-input')).toMatch(
      /max-height:\s*var\(--composer-input-max,\s*40dvh\)/,
    );
    expect(rule('.composer-input')).toMatch(/overflow-y:\s*auto/);
  });

  it('builds the replica from the text plus one space, so a trailing newline counts', () => {
    expect(rule('.composer-grow::after')).toMatch(/content:\s*attr\(data-value\) ' '/);
    expect(rule('.composer-grow::after')).toMatch(/visibility:\s*hidden/);
  });
});
