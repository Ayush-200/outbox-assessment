import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { Session } from '../types';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    }
  }
}

export default function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [error, setError] = useState('');
  const buttonRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      if (initialized.current) {
        window.clearInterval(timer);
        return;
      }
      if (!window.google?.accounts.id) {
        if (++attempts > 100) {
          window.clearInterval(timer);
          setError('Google Sign-In failed to load — check your network and refresh.');
        }
        return;
      }

      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: async (response) => {
          try {
            onLogin(
              await api<Session>('/api/auth/google', {
                method: 'POST',
                body: JSON.stringify({ credential: response.credential }),
              }),
            );
          } catch (err) {
            setError(errorMessage(err));
          }
        },
      });
      if (buttonRef.current) {
        initialized.current = true;
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'filled_black',
          size: 'large',
          width: 280,
        });
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [onLogin]);

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex lg:w-[46%]">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-accent font-mono text-white">
            R
          </span>
          <span className="text-sm font-semibold tracking-tight">ReachInbox</span>
        </div>

        <div className="max-w-md">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">
            Email job scheduler
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">
            Cold email that lands on time, every time.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Schedule a campaign once and the queue takes over: paced sends, hourly
            provider limits, Slack alerts when a sender is throttled — and nothing
            lost when the server restarts.
          </p>
        </div>

        <p className="font-mono text-xs text-muted">
          Outbox Labs · BullMQ + Redis + Postgres + Elasticsearch
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-accent font-mono text-white lg:hidden">
            R
          </span>
          <h2 className="mt-6 text-xl font-semibold tracking-tight">Sign in to your workspace</h2>
          <p className="mt-2 text-sm text-muted">
            Continue with your Google account to reach the dashboard.
          </p>

          <div ref={buttonRef} className="mt-7 flex justify-center" />

          {error ? <p className="mt-5 text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
