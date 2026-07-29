/**
 * Idempotent dev seed: demo user + workspace.
 *   npm run db:seed -w apps/api
 * Login: demo@supersaas.local / demo-password-123
 * Extends with sample leads/campaigns as those tables land (E2+).
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { seedDefaultTags } from '../leads/default-tags';
import { withOrgContext } from './tenant-context';

const DEMO_EMAIL = 'demo@supersaas.local';
const DEMO_PASSWORD = 'demo-password-123';
const DEMO_ORG = 'Demo Workspace';

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://supersaas_app:supersaas_app@localhost:5432/supersaas',
  });

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [DEMO_EMAIL],
  );
  if ((existing.rowCount ?? 0) > 0) {
    console.log(`Seed: ${DEMO_EMAIL} already exists — nothing to do.`);
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const userRes = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, 'Demo User') RETURNING id`,
    [DEMO_EMAIL, passwordHash],
  );
  const userId = userRes.rows[0].id;

  const orgId = randomUUID();
  await withOrgContext(pool, orgId, async (c) => {
    await c.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)`, [
      orgId,
      DEMO_ORG,
      `demo-workspace-${orgId.slice(0, 8)}`,
    ]);
    await c.query(
      `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [orgId, userId],
    );
    await seedDefaultTags(c, orgId);
  });

  console.log(
    `Seed: created ${DEMO_EMAIL} / ${DEMO_PASSWORD} in "${DEMO_ORG}"`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
