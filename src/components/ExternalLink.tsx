import type { ReactNode } from 'react';
import { isExternalHref, isIosStandaloneWebApp, openExternal } from '../externalLinks';

/**
 * The anchor Panda renders for links it did not author: markdown links in the
 * message stream (the shared `markdownComponents` override) and the
 * onboarding doc links.
 *
 * An external http(s) link opens in a new tab. The target attribute stays on
 * the element, so the platform keeps offering its own actions on it — copy
 * link address, open in background, middle click. In an iOS home-screen web
 * app a new tab would replace Panda itself, so the click goes to
 * `openExternal` instead. Panda's own routes and non-http schemes
 * (`mailto:`, `tel:`) render as plain anchors: the browser default is
 * already right for them.
 */
export function ExternalLink({ href, title, children }: {
  href?: string;
  title?: string;
  children?: ReactNode;
}) {
  if (href === undefined || !isExternalHref(href)) {
    return (
      <a href={href} title={title}>
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        // Everywhere else the target attribute is already the right answer,
        // and leaving the event alone keeps copy-link and middle click working.
        if (!isIosStandaloneWebApp()) return;
        event.preventDefault();
        openExternal(href);
      }}
    >
      {children}
    </a>
  );
}
