import { useState } from 'react';
import { api } from './api';
import { t } from './i18n';
import type { AgentEvent } from './types';
const labels: Record<string, string> = {
  temporary: 'Allow for this request',
  permanent: 'Always allow for this agent',
  decline: 'Decline',
  save: 'Save for this agent',
};
export default function ApprovalCard({
  request,
  onError,
}: {
  request: AgentEvent;
  onError?: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const decide = async (choice: boolean | 'temporary' | 'permanent' | 'decline' | 'save') => {
    if (busy || !request.id) return;
    setBusy(true);
    setError('');
    try {
      await api.approve(request.id, choice);
    } catch (e) {
      setError((e as Error).message);
      onError?.((e as Error).message);
      setBusy(false);
    }
  };
  const choices = request.action?.choices;
  return (
    <section
      className={'approval' + (choices ? ' scoped-approval' : '')}
      aria-label={t('Approval request')}
    >
      <b>
        {request.action?.kind === 'access' ? (
          <>
            {t('Allow')} {request.action.agent}{' '}
            {t(request.action.permission === 'edit' ? 'to edit' : 'to read')}{' '}
            {request.action.resource}?
          </>
        ) : request.action?.kind === 'creation' ? (
          <>
            {t('Create')} {request.action.resource} · {request.action.agent}?
          </>
        ) : request.action?.kind === 'configuration' ? (
          <>
            {t('Save configuration for')} {request.action.agent}?
          </>
        ) : (
          t(request.summary || 'Approval request')
        )}
      </b>
      {choices ? (
        <>
          {request.action?.reason && (
            <p>
              <strong>{t('Why')}:</strong> {request.action.reason}
            </p>
          )}
          <p>
            {t(
              request.action?.kind === 'creation'
                ? 'The collection and its contents stay saved. Temporary access ends with this request; permanent access stays enabled for this agent until revoked.'
                : request.action?.kind === 'access'
                  ? 'Request access lasts only for this user request. Permanent access applies only to the named agent and exact scope, until revoked.'
                  : 'These exact changes are saved for this agent and apply to future requests.',
            )}
          </p>
          {request.action?.changes && (
            <dl className="configuration-diff">
              {Object.entries(request.action.changes).map(([key, change]) => (
                <div key={key}>
                  <dt>
                    {t(
                      (
                        {
                          title: 'Agent name',
                          personality: 'Assistance style',
                          provider: 'Provider',
                          model: 'Model',
                        } as Record<string, string>
                      )[key] || key,
                    )}
                  </dt>
                  <dd>
                    <span>
                      {t('Current')}: {change.before || t('Not set')}
                    </span>
                    <strong>
                      {t('Proposed')}: {change.after || t('Not set')}
                    </strong>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {request.action?.changes &&
            (request.action.changes.provider || request.action.changes.model) && (
              <p>
                {t(
                  'Changing models applies to future requests. A cloud provider receives the messages and authorized context you send. This request does not test the proposed model.',
                )}
              </p>
            )}
          <details>
            <summary>{t('Scope & details')}</summary>
            <pre>{request.details}</pre>
          </details>
        </>
      ) : (
        <pre>{request.details}</pre>
      )}
      <div className={choices ? 'grant-actions' : ''}>
        {choices ? (
          choices.map((choice) => (
            <button
              key={choice}
              disabled={busy}
              className={choice === 'temporary' || choice === 'save' ? 'primary' : ''}
              onClick={() => void decide(choice as 'temporary' | 'permanent' | 'decline' | 'save')}
            >
              {t(
                request.action?.kind === 'creation' && choice !== 'decline'
                  ? choice === 'temporary'
                    ? 'Create & allow for this request'
                    : 'Create & always allow for this agent'
                  : labels[choice] || choice,
              )}
            </button>
          ))
        ) : (
          <>
            <button disabled={busy} onClick={() => void decide(false)}>
              {t('Decline')}
            </button>
            <button disabled={busy} className="primary" onClick={() => void decide(true)}>
              {t('Approve action')}
            </button>
          </>
        )}
      </div>
      {error && <p role="alert">{t(error)}</p>}
    </section>
  );
}
