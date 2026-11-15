import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalLink } from './ExternalLink';

describe('ExternalLink', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens an external link in a new tab', () => {
    const html = renderToStaticMarkup(
      createElement(ExternalLink, { href: 'https://github.com/la-creche/Panda' }, 'docs'),
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('leaves the app’s own routes and non-http schemes to the browser', () => {
    expect(renderToStaticMarkup(createElement(ExternalLink, { href: '#/demo' }, 'demo'))).toBe(
      '<a href="#/demo">demo</a>',
    );
    expect(
      renderToStaticMarkup(createElement(ExternalLink, { href: 'mailto:tech@example.com' }, 'mail')),
    ).toBe('<a href="mailto:tech@example.com">mail</a>');
  });

  it('leaves external links as ordinary anchors in the Tauri webview', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(renderToStaticMarkup(createElement(ExternalLink, { href: 'https://example.com' }, 'docs'))).toBe(
      '<a href="https://example.com">docs</a>',
    );
  });
});
