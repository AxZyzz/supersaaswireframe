/**
 * Grant / revoke / list A2B operators (cross-tenant console access).
 * Deliberately CLI-only: there is no API to make someone an operator.
 *
 *   npm run operator -w apps/api -- grant someone@a2b.ai
 *   npm run operator -w apps/api -- revoke someone@a2b.ai
 *   npm run operator -w apps/api -- list
 */
import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: ['.env', '../../.env'] });

async function main() {
  const [cmd, email] = process.argv.slice(2);
  const client = new Client({
    connectionString:
      process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    if (cmd === 'list') {
      const r = await client.query<{ email: string; name: string }>(
        `SELECT email, name FROM users WHERE is_operator ORDER BY email`,
      );
      console.table(r.rows);
      return;
    }
    if ((cmd !== 'grant' && cmd !== 'revoke') || !email) {
      console.error('usage: operator <grant|revoke> <email> | list');
      process.exitCode = 1;
      return;
    }
    const r = await client.query(
      `UPDATE users SET is_operator = $2 WHERE lower(email) = lower($1)`,
      [email, cmd === 'grant'],
    );
    if (!r.rowCount) {
      console.error(`No user with email ${email}`);
      process.exitCode = 1;
    } else {
      console.log(`${cmd === 'grant' ? 'Granted' : 'Revoked'} operator: ${email}`);
    }
  } finally {
    await client.end();
  }
}

void main();
