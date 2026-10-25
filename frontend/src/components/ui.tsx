import {
  ButtonHTMLAttributes,
  ReactNode,
  useEffect,
} from 'react';
import { EmailStatus } from '../types';

export const formatTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 outline-none focus:border-accent';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  const styles = {
    primary: 'bg-accent text-white hover:bg-accent-dark disabled:bg-line disabled:text-muted',
    secondary: 'border border-line bg-surface text-ink hover:border-ink/30',
    ghost: 'text-muted hover:text-ink',
  }[variant];
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }[size];
  return (
    <button
      className={`rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${sizes} ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-muted">
        {label}
        {hint ? <span className="font-mono">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

const STATUS_STYLES: Record<EmailStatus, string> = {
  scheduled: 'bg-amber-100 text-amber-800',
  sending: 'bg-sky-100 text-sky-800',
  sent: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
};

export function StatusPill({ status, title }: { status: EmailStatus; title?: string | null }) {
  return (
    <span
      title={title ?? undefined}
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ink/40 p-4 sm:p-10"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="mx-auto w-full max-w-2xl rounded-xl border border-line bg-surface shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toast({
  message,
  tone,
  onDismiss,
}: {
  message: string;
  tone: 'success' | 'error';
  onDismiss: () => void;
}) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
        tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-rose-200 bg-rose-50 text-rose-900'
      }`}
    >
      {message}
      <button onClick={onDismiss} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
