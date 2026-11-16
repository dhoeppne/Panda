import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExternalLink } from './ExternalLink';

describe('ExternalLink', () => {
  it('opens an external link in a new tab', () => {
    const html = renderToStaticMarkup(
      createElement(ExternalLink, { href: 'https://github.com/la-creche/Panda' }, 'docs'),
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('leaves the app’s own routes and non-http schemes to the browser', () => {
    expect(renderToStaticMarkup(createElement(ExternalLink, { href: '#/settings' }, 'settings'))).toBe(
      '<a href="#/settings">settings</a>',
    );
    expect(
      renderToStaticMarkup(createElement(ExternalLink, { href: 'mailto:tech@example.com' }, 'mail')),
    ).toBe('<a href="mailto:tech@example.com">mail</a>');
  });

});
