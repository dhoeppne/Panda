import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/context';
import { SessionLoading } from './SessionLoading';

describe('SessionLoading', () => {
  it('announces the wait and names what is loading', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SessionLoading)),
    );
    // The spinner's status role is what a screen reader hears while the
    // session replays.
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading session…');
  });
});
