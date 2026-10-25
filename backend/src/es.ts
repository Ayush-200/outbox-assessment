import { Client } from '@elastic/elasticsearch';
import { config } from './config';
import { EmailRow } from './types';

const INDEX = 'emails';
const es = new Client({ node: config.elasticUrl });

export type IndexedEmail = {
  id: string;
  user_id: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
};

export const toIndexed = (row: EmailRow): IndexedEmail => ({
  id: row.id,
  user_id: row.user_id,
  recipient: row.recipient,
  subject: row.subject,
  body: row.body,
  status: row.status,
  scheduled_at: new Date(row.scheduled_at).toISOString(),
  sent_at: row.sent_at ? new Date(row.sent_at).toISOString() : null,
});

export async function ensureIndex() {
  const exists = await es.indices.exists({ index: INDEX });
  if (!exists) await es.indices.create({ index: INDEX });
}

// Bulk-index when a batch is scheduled, re-index (upsert by id) on status change.
export async function indexEmails(rows: EmailRow[]) {
  if (rows.length === 0) return;
  const operations = rows.flatMap((row) => [
    { index: { _index: INDEX, _id: row.id } },
    toIndexed(row),
  ]);
  await es.bulk({ operations });
}

export async function searchEmails(userId: string, statuses: string[], search: string) {
  const exists = await es.indices.exists({ index: INDEX });
  if (!exists) return [];

  const result = await es.search({
    index: INDEX,
    size: 100,
    query: {
      bool: {
        must: search
          ? [{ multi_match: { query: search, fields: ['recipient', 'subject', 'body'] } }]
          : [],
        filter: [{ term: { user_id: userId } }, { terms: { status: statuses } }],
      },
    },
    sort: [{ scheduled_at: 'desc' }],
  });

  return result.hits.hits.map((hit) => hit._source as IndexedEmail);
}
