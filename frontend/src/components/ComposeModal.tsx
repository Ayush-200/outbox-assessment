import { FormEvent, useState } from 'react';
import { api, errorMessage } from '../api';
import { ScheduleInput, Sender } from '../types';
import { Button, Field, Modal, inputClass } from './ui';

const pad = (value: number) => String(value).padStart(2, '0');

// datetime-local wants a local "YYYY-MM-DDTHH:mm" value, not an ISO string.
const localValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export default function ComposeModal({
  onClose,
  senders,
  defaultSender,
  onScheduled,
}: {
  onClose: () => void;
  senders: Sender[];
  defaultSender: string;
  onScheduled: (input: ScheduleInput, scheduled: number) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [start, setStart] = useState(localValue(new Date(Date.now() + 5 * 60_000)));
  const [delay, setDelay] = useState('2');
  const [limit, setLimit] = useState('200');
  const [senderEmail, setSenderEmail] = useState(senders[0]?.email ?? defaultSender);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const found = text.match(EMAIL_RE) ?? [];
    setFileName(file.name);
    setRecipients([...new Set(found)]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!subject.trim()) return setError('Subject is required');
    if (recipients.length === 0) return setError('Upload a file with at least one email address');

    const input: ScheduleInput = {
      subject: subject.trim(),
      body,
      startTime: new Date(start).toISOString(),
      delaySeconds: Number(delay) || 0,
      hourlyLimit: Number(limit) || 0,
      senderEmail: senderEmail.trim(),
      emails: recipients,
    };

    setBusy(true);
    setError('');
    try {
      const result = await api<{ scheduled: number; skipped: number }>(
        '/api/emails/schedule',
        { method: 'POST', body: JSON.stringify(input) },
      );
      onScheduled(input, result.scheduled);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Compose New Email" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Sender email">
          <input
            className={inputClass}
            value={senderEmail}
            onChange={(event) => setSenderEmail(event.target.value)}
            placeholder="you@company.com"
            list="known-senders"
            required
          />
          <datalist id="known-senders">
            {senders.map((sender) => (
              <option key={sender.id} value={sender.email} />
            ))}
          </datalist>
        </Field>

        <Field label="Subject">
          <input
            className={inputClass}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Quick question about your pipeline"
            required
          />
        </Field>

        <Field label="Body">
          <textarea
            className={`${inputClass} min-h-32 resize-y`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Hi {{name}}, …"
          />
        </Field>

        <Field label="Leads file (CSV / TXT)" hint={`${recipients.length} addresses`}>
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={(event) => pickFile(event.target.files?.[0])}
            className="block w-full cursor-pointer rounded-lg border border-dashed border-line bg-surface px-3 py-2.5 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-paper file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
          />
          <span className="mt-1 block text-xs text-muted">
            {fileName ? `Parsed ${fileName}` : 'One email address per line — we detect them automatically.'}
          </span>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start time">
            <input
              type="datetime-local"
              className={inputClass}
              value={start}
              onChange={(event) => setStart(event.target.value)}
              required
            />
          </Field>
          <Field label="Delay (seconds)">
            <input
              type="number"
              min={0}
              className={inputClass}
              value={delay}
              onChange={(event) => setDelay(event.target.value)}
            />
          </Field>
          <Field label="Hourly limit">
            <input
              type="number"
              min={1}
              className={inputClass}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </Field>
        </div>

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Scheduling…' : `Schedule ${recipients.length || ''} email${recipients.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
