import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import ComposeModal from '../components/ComposeModal';
import EmailTable from '../components/EmailTable';
import Header, { SlackStatus } from '../components/Header';
import { Button, Toast, inputClass } from '../components/ui';
import { Email, ScheduleInput, Sender, Session, Tab } from '../types';

const TABS: { key: Tab; label: string }[] = [
  { key: 'scheduled', label: 'Scheduled Emails' },
  { key: 'sent', label: 'Sent Emails' },
];

export default function Dashboard({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>('scheduled');
  const [search, setSearch] = useState('');
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [senders, setSenders] = useState<Sender[]>([]);
  const [slack, setSlack] = useState<SlackStatus | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const notify = (message: string, tone: 'success' | 'error' = 'success') =>
    setToast({ message, tone });

  // The active tab: PG for the lists, Elasticsearch as soon as there is a query.
  const load = useCallback(async () => {
    const path = search.trim()
      ? `/api/emails/search?status=${tab}&q=${encodeURIComponent(search.trim())}`
      : `/api/emails?status=${tab}`;
    try {
      setEmails(await api<Email[]>(path));
      setLoadError('');
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  // Refresh every 5 seconds so sends show up live.
  useEffect(() => {
    setLoading(true);
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    api<Sender[]>('/api/senders').then(setSenders).catch(() => undefined);
    api<SlackStatus>('/api/slack/status').then(setSlack).catch(() => undefined);

    const params = new URLSearchParams(window.location.search);
    const result = params.get('slack');
    if (result === 'connected') notify('Slack connected — rate-limit alerts are on.');
    if (result === 'error') notify('Slack authorization failed, please try again.', 'error');
    if (result) window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleScheduled = (input: ScheduleInput, scheduled: number) => {
    notify(
      scheduled > 0
        ? `Scheduled ${scheduled} email${scheduled === 1 ? '' : 's'} from ${input.senderEmail}.`
        : 'Nothing new to schedule — those emails are already queued.',
    );
    load();
  };

  return (
    <div className="min-h-screen">
      <Header user={session.user} slack={slack} onLogout={onLogout} />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Email campaigns</h1>
            <p className="mt-1 text-sm text-muted">
              Scheduled through BullMQ delayed jobs — no cron involved.
            </p>
          </div>
          <Button onClick={() => setComposeOpen(true)}>Compose New Email</Button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-line bg-surface p-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  tab === key ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search recipient, subject or body…"
            className={`${inputClass} max-w-72`}
          />
        </div>

        {loadError ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
            {loadError}
          </p>
        ) : null}

        <div className="mt-4">
          <EmailTable tab={tab} rows={emails} loading={loading} />
        </div>

        <p className="mt-3 font-mono text-xs text-muted">
          auto-refresh · 5s · {emails.length} shown
        </p>
      </main>

      {composeOpen ? (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          senders={senders}
          defaultSender={session.user.email}
          onScheduled={handleScheduled}
        />
      ) : null}

      {toast ? <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
