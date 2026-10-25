import { api, apiOrigin } from '../api';
import { Session } from '../types';
import { Button } from './ui';

export type SlackStatus = { connected: boolean; team: string | null };

export default function Header({
  user,
  slack,
  onLogout,
}: {
  user: Session['user'];
  slack: SlackStatus | null;
  onLogout: () => void;
}) {
  const connectSlack = async () => {
    // Backend redirects us through Slack's OAuth authorize + callback.
    const { url } = await api<{ url: string }>('/api/slack/install');
    window.location.href = url;
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent font-mono text-sm text-white">
            R
          </span>
          <span className="text-sm font-semibold tracking-tight">ReachInbox</span>
          <span className="hidden font-mono text-xs text-muted sm:inline">/ scheduler</span>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`${apiOrigin}/admin/queues`}
            target="_blank"
            rel="noreferrer"
            className="hidden text-sm text-muted transition-colors hover:text-ink sm:inline"
          >
            Queue dashboard
          </a>
          <Button variant="secondary" size="sm" onClick={connectSlack}>
            {slack?.connected ? `Slack ✓ ${slack.team ?? ''}`.trim() : 'Connect Slack'}
          </Button>

          <div className="flex items-center gap-2 border-l border-line pl-3">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="h-7 w-7 rounded-full" />
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-xs text-white">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="hidden leading-tight sm:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="font-mono text-xs text-muted">{user.email}</p>
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={onLogout}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
