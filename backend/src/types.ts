export type EmailStatus = 'scheduled' | 'sending' | 'sent' | 'failed';

export type EmailRow = {
  id: string;
  batch_id: string;
  user_id: string;
  sender_id: number;
  recipient: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: EmailStatus;
  sent_at: string | null;
  error: string | null;
};

export type User = {
  id: string;
  name: string;
  email: string;
  avatar: string;
};
