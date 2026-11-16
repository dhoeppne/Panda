import { memo } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Check, ChevronDown, Layers } from 'lucide-react';
import type { PermissionOptionKind, ToolCallState } from '../protocol/types';
import type { BlockFlatItem } from '../projector/messageStream';
import { useI18n } from '../i18n/context';
import { settledToolTitle } from './tool-title';
import { ToolCallCard } from './ToolCallCard';
import './disclosure.css';
import './ToolCallGroup.css';

const isLive = (call: ToolCallState) => call.status === 'pending' || call.status === 'in_progress';

/**
 * A run of tool calls folded into one row (see projectGroupedStream):
 * `N tool calls · <title>`, where the title is the first live call's, else
 * the last call's. Collapsed by default, also while calls run; opening it
 * shows the ordinary cards on the indented rail. Calls that need the user
 * (pending approval, failure) are never members — they render outside.
 * The open state lives in MessageStream, keyed on the group's key, so it
 * survives the virtualizer unmounting the row.
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  groupKey,
  members,
  open,
  onToggle,
  onResolvePermission,
  prevIsTool,
  nextIsTool,
}: {
  groupKey: string;
  members: BlockFlatItem[];
  open: boolean;
  onToggle: (groupKey: string) => void;
  onResolvePermission: (toolCallId: string, kind: PermissionOptionKind) => void;
  prevIsTool: boolean;
  nextIsTool: boolean;
}) {
  const { t } = useI18n();
  const calls = members.flatMap((member) => (member.block.kind === 'tool_call' ? [member.block.call] : []));
  const live = calls.find(isLive);
  const head = live ?? calls.at(-1);
  const headTitle = !head
    ? ''
    : head.kind === 'think'
      ? (isLive(head) ? t('tool.thinking') : t('tool.thought'))
      : settledToolTitle(head.title, head.status);

  return (
    <div
      className={[
        'tool-card',
        'tool-group',
        prevIsTool && 'tool-card--after-tool',
        nextIsTool && 'tool-card--before-tool',
      ].filter(Boolean).join(' ')}
    >
      <button onClick={() => onToggle(groupKey)} className="disclosure-toggle" aria-expanded={open}>
        <Layers size={16} className="disclosure-icon" />
        <span className="tool-group-count">{t('tool.group.count', { n: String(calls.length) })}</span>
        <span className="disclosure-label tool-group-title">· {headTitle}</span>
        <span className="tool-group-status">
          {live ? (
            <Badge variant="neutral" icon={<Spinner size="sm" />} label={t('tool.running')} />
          ) : (
            <Check size={14} className="tool-status-icon tool-status-icon--ok" />
          )}
        </span>
        <ChevronDown size={13} className={`disclosure-chevron ${open ? 'disclosure-chevron--open' : ''}`} />
      </button>
      {open && (
        <div className="disclosure-body tool-group-body">
          {members.map((member, i) =>
            member.block.kind === 'tool_call' ? (
              <ToolCallCard
                key={member.key}
                call={member.block.call}
                permission={member.permission}
                prevIsTool={i > 0}
                nextIsTool={i < members.length - 1}
                onResolvePermission={(kind) => onResolvePermission(member.permission?.request.toolCallId ?? '', kind)}
              />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
});
