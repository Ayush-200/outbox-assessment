import { ReactNode } from 'react';
import { Email, Tab } from '../types';
import { Spinner, StatusPill, formatTime } from './ui';

type Column<T> = { key: string; header: string; cell: (row: T) => ReactNode };

const recipientCell = (row: Email) => (
  <span className="font-mono text-[13px]">{row.recipient}</span>
);

const statusCell = (row: Email) => (
  <span className="flex flex-col gap-1">
    <StatusPill status={row.status} title={row.error} />
    {row.status === 'failed' && row.error ? (
      <span className="max-w-64 text-xs text-muted">{row.error}</span>
    ) : null}
  </span>
);

const columns: Record<Tab, Column<Email>[]> = {
  scheduled: [
    { key: 'recipient', header: 'Email', cell: recipientCell },
    { key: 'subject', header: 'Subject', cell: (row) => row.subject },
    { key: 'time', header: 'Scheduled time', cell: (row) => <span className="font-mono text-[13px]">{formatTime(row.scheduled_at)}</span> },
    { key: 'status', header: 'Status', cell: statusCell },
  ],
  sent: [
    { key: 'recipient', header: 'Email', cell: recipientCell },
    { key: 'subject', header: 'Subject', cell: (row) => row.subject },
    { key: 'time', header: 'Sent time', cell: (row) => <span className="font-mono text-[13px]">{formatTime(row.sent_at)}</span> },
    { key: 'status', header: 'Status', cell: statusCell },
  ],
};

const empty: Record<Tab, { title: string; hint: string }> = {
  scheduled: {
    title: 'No scheduled emails',
    hint: 'Compose a campaign to see it queued here.',
  },
  sent: {
    title: 'No sent emails yet',
    hint: 'Emails appear here once the worker delivers them.',
  },
};

export default function EmailTable({
  tab,
  rows,
  loading,
}: {
  tab: Tab;
  rows: Email[];
  loading: boolean;
}) {
  if (loading && rows.length === 0) return <Spinner />;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface py-16 text-center">
        <p className="text-sm font-medium">{empty[tab].title}</p>
        <p className="mt-1 text-sm text-muted">{empty[tab].hint}</p>
      </div>
    );
  }

  const active = columns[tab];
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {active.map((column) => (
              <th key={column.key} className="px-4 py-3 font-medium">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line transition-colors last:border-0 hover:bg-paper">
              {active.map((column) => (
                <td key={column.key} className="px-4 py-3 align-top">
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
