import type { PoolClient } from 'pg';

// Starter tags seeded into every new workspace so the tag picker isn't empty
// on day one. Names are unique per org (case-insensitive), so re-seeding is a
// no-op via ON CONFLICT.
export const DEFAULT_TAGS: { name: string; color: string }[] = [
  { name: 'Hot Lead', color: '#c62a2f' },
  { name: 'Follow Up', color: '#9a6700' },
  { name: 'Customer', color: '#2a7e3b' },
  { name: 'Partner', color: '#2f6feb' },
  { name: 'Cold', color: '#6b7280' },
];

// Must run inside an org-context transaction (RLS WITH CHECK needs
// app.current_org_id set to orgId).
export async function seedDefaultTags(
  client: PoolClient,
  orgId: string,
): Promise<void> {
  for (const t of DEFAULT_TAGS) {
    await client.query(
      `INSERT INTO tags (org_id, name, color) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [orgId, t.name, t.color],
    );
  }
}
