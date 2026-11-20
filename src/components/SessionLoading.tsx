import { Spinner } from '@astryxdesign/core/Spinner';
import { Button } from '@astryxdesign/core/Button';
import { useI18n } from '../i18n/context';
import './SessionLoading.css';

/**
 * The content column while a session loads: opening another session replays
 * its history over the wire (`session/load`), and until that lands there is
 * nothing to show — the pointer still sits on the session being left, so the
 * stream would show the conversation the user just left.
 */
export function SessionLoading({ failed = false, onRetry, onNewChat }: {
  failed?: boolean;
  onRetry?: () => void;
  onNewChat?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="session-loading">
      {failed ? (
        <>
          <p className="session-loading-label" role="alert">{t('session.openFailed')}</p>
          <div className="session-loading-actions">
            <Button variant="secondary" size="sm" label={t('live.retrySwitch')} clickAction={onRetry} />
            <Button variant="ghost" size="sm" label={t('side.newChat')} clickAction={onNewChat} />
          </div>
        </>
      ) : (
        <>
          {/* The spinner's status role carries the wait; the label below says
              what is loading (the StatusBar pairs them the same way). */}
          <Spinner size="lg" aria-label={t('session.loading')} />
          <span className="session-loading-label">{t('session.loading')}</span>
        </>
      )}
    </div>
  );
}
