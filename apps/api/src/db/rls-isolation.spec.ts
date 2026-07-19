import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { withOrgContext } from './tenant-context';

/**
 * RLS tenant-isolation proof. Runs against a real Postgres (docker compose /
 * CI service) with migrations applied. If org A can ever see or write org B's
 * rows, these tests fail — this suite is the security gate for the whole
 * multi-tenant design.
 */
describe('RLS tenant isolation', () => {
  let pool: Pool;
  const orgA = randomUUID();
  const orgB = randomUUID();
  let userId: string;

  beforeAll(async () => {
    // Must be the restricted app role — the superuser bypasses RLS and would
    // make every assertion here meaningless.
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://supersaas_app:supersaas_app@localhost:5432/supersaas',
    });
    // Global (non-RLS) user both orgs can reference.
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'x', 'RLS Test User') RETURNING id`,
      [`rls-test-${randomUUID()}@test.local`],
    );
    userId = res.rows[0].id;

    // Each org is created inside its own context (signup flow pattern:
    // app generates the org id, sets the context, then inserts).
    for (const [orgId, slug] of [
      [orgA, `rls-a-${orgA.slice(0, 8)}`],
      [orgB, `rls-b-${orgB.slice(0, 8)}`],
    ] as const) {
      await withOrgContext(pool, orgId, async (c) => {
        await c.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)`, [
          orgId,
          `RLS Test ${slug}`,
          slug,
        ]);
        await c.query(
          `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`,
          [orgId, userId],
        );
      });
    }
  });

  afterAll(async () => {
    for (const orgId of [orgA, orgB]) {
      await withOrgContext(pool, orgId, async (c) => {
        await c.query(`DELETE FROM orgs WHERE id = $1`, [orgId]);
      });
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await pool.end();
  });

  it('org A context sees only org A rows', async () => {
    const { orgRows, memberRows } = await withOrgContext(
      pool,
      orgA,
      async (c) => ({
        orgRows: (await c.query<{ id: string }>(`SELECT id FROM orgs`)).rows,
        memberRows: (
          await c.query<{ org_id: string }>(`SELECT org_id FROM memberships`)
        ).rows,
      }),
    );
    expect(orgRows).toHaveLength(1);
    expect(orgRows[0].id).toBe(orgA);
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].org_id).toBe(orgA);
  });

  it('org B context cannot read org A rows even by explicit id', async () => {
    const rows = await withOrgContext(
      pool,
      orgB,
      async (c) =>
        (
          await c.query<{ id: string }>(`SELECT id FROM orgs WHERE id = $1`, [
            orgA,
          ])
        ).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('org A context cannot insert a membership into org B (WITH CHECK)', async () => {
    await expect(
      withOrgContext(pool, orgA, (c) =>
        c.query(
          `INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'agent')`,
          [orgB, userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('org A context cannot update or delete org B rows (0 rows affected)', async () => {
    const { updated, deleted } = await withOrgContext(
      pool,
      orgA,
      async (c) => ({
        updated: (
          await c.query(`UPDATE orgs SET name = 'hacked' WHERE id = $1`, [orgB])
        ).rowCount,
        deleted: (await c.query(`DELETE FROM orgs WHERE id = $1`, [orgB]))
          .rowCount,
      }),
    );
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
  });

  it('no org context = zero visibility (fail closed)', async () => {
    const client = await pool.connect();
    try {
      const orgRows = (await client.query(`SELECT id FROM orgs`)).rows;
      const memberRows = (await client.query(`SELECT id FROM memberships`))
        .rows;
      expect(orgRows).toHaveLength(0);
      expect(memberRows).toHaveLength(0);
    } finally {
      client.release();
    }
  });
});
