/* eslint-disable @typescript-eslint/no-require-imports */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Learning Loop T07: the guard rails around what leaves Postgres for BigQuery.
 * infra/bigquery/replication-set.json is the ONLY list of tables + columns that
 * is replicated; postgres-setup.sql and datastream-include.json are generated
 * from it. These tests make "no lead PII in BigQuery" something CI enforces.
 */
const DIR = join(__dirname, '..', '..', '..', '..', 'infra', 'bigquery');
const read = (...p: string[]) => readFileSync(join(DIR, ...p), 'utf8');
const SET = JSON.parse(read('replication-set.json')) as {
  tables: Record<string, string[]>;
  neverReplicate: {
    columns: string[];
    tables: string[];
    columnsByTable: Record<string, string[]>;
  };
};
const { render } = require(join(DIR, 'generate.js')) as {
  render: (s: unknown) => { sql: string; include: string };
};
// CRLF checkouts must not make the "is it up to date" comparison fail
const lf = (s: string) => s.replace(/\r\n/g, '\n');

describe('replication set (T07): no lead PII reaches BigQuery', () => {
  it('lists no table that holds lead, user or message data', () => {
    for (const t of SET.neverReplicate.tables) {
      expect(Object.keys(SET.tables)).not.toContain(t);
    }
  });

  it('lists no column that looks like PII, message content, free text or a secret', () => {
    const banned = new Set(SET.neverReplicate.columns);
    const offenders: string[] = [];
    for (const [table, cols] of Object.entries(SET.tables)) {
      for (const c of cols) {
        // templates.subject and experiment_variants.subject are subject TEMPLATES (no recipient data);
        // offers.name is the offer's own title ("Website redesign for dentists"), not a person
        const allowed =
          (c === 'subject' &&
            (table === 'templates' || table === 'experiment_variants')) ||
          (c === 'name' && table === 'offers');
        if (banned.has(c) && !allowed) offenders.push(`${table}.${c}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never lists the per-table columns that carry PII (sent_emails.to_email and subject, email_events.data, prospects.emails, ...)', () => {
    const offenders: string[] = [];
    for (const [table, cols] of Object.entries(
      SET.neverReplicate.columnsByTable,
    )) {
      for (const c of cols) {
        if (SET.tables[table]?.includes(c)) offenders.push(`${table}.${c}`);
      }
    }
    expect(offenders).toEqual([]);
    // the two the brief singles out
    expect(SET.tables.sent_emails).not.toContain('to_email');
    expect(SET.tables.sent_emails).not.toContain('subject');
    expect(SET.tables.email_events).not.toContain('data');
    expect(SET.tables.outcome_events).not.toContain('reason');
    expect(SET.tables.reviews).not.toContain('explanation');
    expect(SET.tables.prospects).not.toContain('emails');
    expect(SET.tables.prospects).not.toContain('evidence');
  });

  it('every table has an id, and every workspace table has org_id (the tenant column)', () => {
    for (const [table, cols] of Object.entries(SET.tables)) {
      expect({ table, id: cols.includes('id') }).toEqual({ table, id: true });
      if (table !== 'orgs') {
        expect({ table, org: cols.includes('org_id') }).toEqual({
          table,
          org: true,
        });
      }
    }
  });

  it('postgres-setup.sql and datastream-include.json are generated from the set (run: node infra/bigquery/generate.js)', () => {
    const { sql, include } = render(SET);
    expect(lf(read('postgres-setup.sql'))).toBe(sql);
    expect(lf(read('datastream-include.json'))).toBe(include);
  });

  it('the generated SQL grants columns (never a whole table) and bypasses RLS only for the reader role', () => {
    // statements only: the header comment explains what is NOT copied, so it names columns
    const sql = lf(read('postgres-setup.sql'))
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n');
    expect(sql).toContain('REPLICATION BYPASSRLS');
    expect(sql).not.toMatch(/GRANT SELECT ON /); // only GRANT SELECT (col, ...)
    expect(sql).not.toMatch(/GRANT ALL/i);
    expect(sql).not.toMatch(/FOR ALL TABLES/i);
    expect(sql).not.toContain('to_email');
    expect(sql).toContain('ALTER PUBLICATION expelly_bq SET TABLE');
  });

  it('every BigQuery view only reads replicated tables', () => {
    const files = readdirSync(join(DIR, 'views')).filter((f) =>
      f.endsWith('.sql'),
    );
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const f of files) {
      const text = read('views', f);
      for (const m of text.matchAll(/\$\{RAW\}\.public_(\w+)/g)) {
        expect({ file: f, table: m[1], ok: m[1] in SET.tables }).toEqual({
          file: f,
          table: m[1],
          ok: true,
        });
      }
    }
  });

  it('no view reads the raw JSON snapshot or trigger quotes into a column (only whitelisted keys)', () => {
    for (const f of readdirSync(join(DIR, 'views'))) {
      const text = read('views', f);
      expect(text).not.toMatch(/\.quote|\$\.triggers\b|\$\.url/);
      // the snapshot column itself is never selected; only JSON_VALUE(cl.snapshot, '$.<key>')
      expect(text).not.toMatch(/(?<!JSON_VALUE\()\bcl\.snapshot\b/);
    }
  });

  it('every view filters or exposes org_id so the app can wall tenants off', () => {
    for (const f of readdirSync(join(DIR, 'views'))) {
      if (f.startsWith('00_')) continue; // the helper function
      expect(read('views', f)).toMatch(/\borg_id OPTIONS/);
    }
  });
});
