import type { ReactNode } from 'react';
import { isExternalHref, isIosStandaloneWebApp, isTauriDesktopShell } from '../externalLinks';

/**
 * The anchor Panda renders for links it did not author: markdown links in the
 * message stream (the shared `markdownComponents` override) and the
 * onboarding doc links.
 *
 * An external http(s) link opens in a new tab. In an iOS home-screen web app
 * it remains an ordinary, out-of-scope anchor so the manifest scope can hand
 * it to iOS instead of creating a browsing context inside Panda. The Tauri
 * desktop shell also keeps its ordinary anchors because it has no new-window
 * handler. Panda's own routes and non-http schemes (`mailto:`, `tel:`) stay
 * plain anchors: the browser default is already right for them.
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
  if (isIosStandaloneWebApp() || isTauriDesktopShell()) {
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
    >
      {children}
    </a>
  );
}
