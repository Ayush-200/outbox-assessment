export type Session = {
  token: string;
  user: { id: string; name: string; email: string; avatar: string };
};

export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed';

export type Email = {
  id: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduled_at: string;
  sent_at?: string | null;
  error?: string | null;
};

export type Sender = {
  id: number;
  email: string;
  hourly_limit: number;
};

export type ScheduleInput = {
  subject: string;
  body: string;
  startTime: string;
  delaySeconds: number;
  hourlyLimit: number;
  senderEmail: string;
  emails: string[];
};

export type Tab = 'scheduled' | 'sent';
