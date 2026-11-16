import { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp } from 'lucide-react';
import type { AgentProfile } from '../profiles';
import { useI18n } from '../i18n/context';
import { familyGlyph } from '../navLayout';
import { usePopoverDismiss } from './usePopoverDismiss';
import './FamilyPicker.css';

/**
 * The family chip in the composer's bottom-left slot. In a new chat it
 * opens a menu of the saved families; the pick decides where the first send
 * creates the session. An existing chat keeps its family, so there the chip
 * is a plain label with no menu.
 *
 * Keyboard follows ModePicker (APG menu): opening focuses the current
 * family, ArrowUp/Down roam, Escape returns focus to the chip.
 */
export function FamilyPicker({ families, currentId, onPick }: {
  families: AgentProfile[];
  currentId: string;
  onPick(familyId: string): void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = usePopoverDismiss(open, () => setOpen(false));
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const names = families.map((family) => family.name);
  const current = families.find((family) => family.id === currentId);

  useEffect(() => {
    if (!open) return;
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('.family-picker-option') ?? []);
    (options.find((option) => option.getAttribute('aria-checked') === 'true') ?? options[0])?.focus();
  }, [open]);

  if (!current) return null;

  return (
    <div className="family-picker" ref={rootRef}>
      <button
        type="button"
        ref={chipRef}
        className="family-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('family.pickTooltip')}
        onClick={() => setOpen((value) => !value)}
      >
        <FamilyBadge name={current.name} allNames={names} />
        <span className="truncate">{current.name}</span>
        <ChevronUp size={12} className={`family-chip-chevron ${open ? 'family-chip-chevron--open' : ''}`} />
      </button>
      {open && (
        <div
          className="family-picker-menu"
          role="menu"
          aria-label={t('family.menu')}
          ref={menuRef}
          onKeyDown={(event) => {
            const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('.family-picker-option') ?? []);
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              options[(index + delta + options.length) % options.length]?.focus();
            } else if (event.key === 'Escape') {
              setOpen(false);
              chipRef.current?.focus();
            } else if (event.key === 'Tab') {
              setOpen(false);
            }
          }}
        >
          <div className="family-picker-head">{t('family.menu')}</div>
          {families.map((family) => {
            const isCurrent = family.id === currentId;
            return (
              <button
                key={family.id}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                tabIndex={-1}
                className="family-picker-option"
                onClick={() => {
                  setOpen(false);
                  chipRef.current?.focus();
                  if (!isCurrent) onPick(family.id);
                }}
              >
                <FamilyBadge name={family.name} allNames={names} />
                <span className="truncate family-picker-name">{family.name}</span>
                <Check size={14} className={`family-picker-check ${isCurrent ? '' : 'family-picker-check--hidden'}`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The locked chip of an existing chat: its family, no menu. */
export function FamilyLabel({ family, families }: { family: AgentProfile; families: AgentProfile[] }) {
  const { t } = useI18n();
  return (
    <span className="family-chip family-chip--locked" title={t('family.lockedTooltip', { name: family.name })}>
      <FamilyBadge name={family.name} allNames={families.map((entry) => entry.name)} />
      <span className="truncate">{family.name}</span>
    </span>
  );
}

/** The family badge (principal → P, code → Co): the shortest unique prefix. */
export function FamilyBadge({ name, allNames }: { name: string; allNames: readonly string[] }) {
  const glyph = familyGlyph(name, allNames);
  return (
    <span className={`family-badge family-badge--${familyTone(name, allNames)}`} aria-hidden="true">
      {glyph}
    </span>
  );
}

/** A stable tint per family: the family's position in the saved list picks
 * one of four tones, so any number of families stays readable. */
function familyTone(name: string, allNames: readonly string[]): number {
  const index = allNames.indexOf(name);
  return (index < 0 ? 0 : index) % 4;
}
