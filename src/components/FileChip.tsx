import type { ReactNode } from 'react';
import './FileChip.css';

/**
 * One non-image file as a chip: a kind badge, the name, and a sub line
 * (kind and size, or the reason Panda does not send it). The composer adds
 * a remove button as `children`; a sent message shows the chip alone.
 */
export function FileChip({ name, badge, sub, refused = false, children }: {
  name: string;
  badge: string;
  sub: string;
  refused?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`file-chip ${refused ? 'file-chip--error' : ''} ${children ? 'file-chip--removable' : ''}`}
      title={name}
    >
      <span className="file-chip-badge" aria-hidden="true">{badge}</span>
      <span className="file-chip-meta">
        <span className="file-chip-name">{name}</span>
        <span className="file-chip-sub">{sub}</span>
      </span>
      {children}
    </div>
  );
}
